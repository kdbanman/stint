/**
 * The ONE renderer↔main IPC handler map (PRD §12, §15) — extracted from main.ts so it is
 * pure, dependency-injected, and Electron-free. Three things fall out of that shape
 * (issues #87, #165):
 *
 *   1. The map is typed `IpcHandlers` (ipc.ts) against the per-channel IpcContract, so a
 *      reshaped payload or a CHANNELS entry without a handler stops compiling — no more
 *      `Record<string, unknown>`, per-handler `as` casts, or non-null bind.
 *   2. It is importable without a running main process, so test/ipc-handlers.test.ts binds
 *      its key set to CHANNELS both directions.
 *   3. The QA discovery driver (qa/driver.mjs) bridges its Chromium page with THIS map
 *      rather than a hand-written port of it (#165), so a sweep can only ever repro against
 *      the logic the app runs. Keep every handler Electron-free for that reason.
 *
 * Only the three genuinely OS-bound bits are injected (`deps`): the window refresh, the
 * native Save dialog, and the live global-hotkey rebind. Everything else — the shared core
 * and the sibling Electron-free helpers — is imported directly, since this runs in the main
 * process (not the sandboxed page).
 */
import { writeFileSync } from 'node:fs';
import {
  toUtc,
  resolveRange,
  buildEntryList,
  describeOverlaps,
  type Store,
} from '@stint/core';
import type { IpcHandlers, ListEntriesQuery, EntryListView } from './ipc.js';
import { buildUiState } from './uistate.js';
import { toEntryRowView } from './entryrow.js';
import { toggleTimer } from './toggle.js';
import { startWithAttributes } from './start.js';
import {
  buildReportView,
  resolveDateRange,
  resolveExportDefinition,
  exportPayload,
  exportFileName,
  savedReportToView,
  savedReportInputFromView,
  savedReportPatchFromView,
} from './reportview.js';
import { pinFavoriteFromView, listFavoriteViews, favoriteToView } from './favorites.js';
import { listBackupViews } from './backupview.js';
import { parseLocalInput } from './localtime.js';

/** The OS-bound seam main.ts supplies; everything else the handlers need is imported above. */
export interface IpcHandlerDeps {
  store: Store;
  /** Repaint every open window after a write (main.ts: updateTray + broadcast('changed')). */
  refreshAll: () => void;
  /**
   * §09 R6 — show the native Save dialog for an export and return the chosen path (undefined if
   * canceled). The dialog + its parent window are Electron; the range resolution, byte rendering,
   * and file write stay here.
   */
  showSaveDialog: (format: 'csv' | 'json', defaultPath: string) => string | undefined;
  /**
   * §12 R11 / §14 — re-bind the OS global hotkey live when the accelerator changes (drop the old,
   * bind the new). globalShortcut is Electron, so main.ts owns the mechanics.
   */
  rebindGlobalHotkey: (previous: string, next: string) => void;
}

/**
 * §12 R9: the Entries view's control bar. Read-only (no refresh): resolve the range (a preset
 * through core's resolveRange — the same rule the report picker drives — or the custom plain-date
 * pair through resolveDateRange, §09 R01: the toolbar's two date fields resolve to the inclusive-
 * end-day half-open local window here, never in the renderer), list the entries through the SAME
 * store.listEntries the CLI uses (range/client/project/tag/billable/search all narrow there), then
 * group via core's buildEntryList and project each entry to the renderer-safe row with its overlap
 * detail. Parity with `tt list … --by`.
 */
function listEntries(store: Store, q: ListEntriesQuery): EntryListView {
  const now = new Date();
  const range = q.preset
    ? resolveRange(q.preset, store.settings().weekStart, now)
    : resolveDateRange(q.fromDate!, q.toDate!);
  const filter: Parameters<Store['listEntries']>[0] = {
    fromUtc: range.fromUtc,
    toUtc: range.toUtc,
    billable: q.billable ?? 'all',
  };
  if (q.clientId !== undefined) filter.clientId = q.clientId;
  if (q.projectId !== undefined) filter.projectId = q.projectId;
  if (q.tag !== undefined && q.tag !== '') filter.tag = q.tag;
  if (q.search !== undefined && q.search !== '') filter.search = q.search;
  const entries = store.listEntries(filter);
  // §12 R9: per-entry overlap detail (worst-neighbour minutes + previous/next relation) off the one
  // core rule, so the Entries-view rows paint the same detailed banner the day-grouped getState path
  // does. `describeOverlaps` keys are exactly the overlapped ids.
  const overlaps = describeOverlaps(entries, now);
  const byId = new Map(entries.map((e) => [e.id, e]));
  // store.listEntries already applied the free-text search (via the filter, like the CLI), so
  // buildEntryList only needs to group the surviving set. Issues #55/#50: `by` is optional on
  // ListEntriesQuery — default to the Entries calendar's 'day' grouping so a payload missing `by`
  // can never reject the whole query.
  const { groups } = buildEntryList(entries, { by: q.by ?? 'day' });
  return {
    groups: groups.map((g) => ({
      key: g.key,
      billableSeconds: g.entries.reduce((s, e) => s + e.billableSeconds, 0),
      // The row projection itself is entryrow.ts's one job (issue #166) — the day-grouped
      // getState path builds its rows through the same function, so the two can never drift.
      entries: g.entries.map((e) => {
        const full = byId.get(e.id)!;
        return toEntryRowView(full, overlaps.get(full.id));
      }),
    })),
    rangeFromUtc: range.fromUtc,
    rangeToUtc: range.toUtc,
  };
}

/**
 * Build the typed, total handler map. Every channel in CHANNELS has exactly one handler here
 * (checked against IpcContract at compile time), with its payload already typed — no `as` cast
 * at the seam. main.ts binds these to ipcMain; the parity test reads their keys.
 */
export function createIpcHandlers(deps: IpcHandlerDeps): IpcHandlers {
  const { store, refreshAll } = deps;

  const handlers: IpcHandlers = {
    getState: () => buildUiState(store),
    // §09 R7: free-text search over the day-grouped history list. The query rides inside the
    // payload and narrows the listed entries through core (parity with `tt list --search`); the
    // returned UiState is painted exactly as getState's is.
    search: (payload) => buildUiState(store, { search: payload?.query }),
    listEntries: (payload) => listEntries(store, payload),
    // Write channels come in three result shapes, and which one a channel takes is decided, not
    // free: a channel that writes an entry's SPAN returns a WriteAck, because only a span write
    // can land on an overlap (PRD §06 R4 allows it but flags it) and the renderer raises an
    // inline banner from that ack at the moment of the write. Every other mutator returns `void`
    // and lets refreshAll repaint — except where the renderer cannot re-derive the record just
    // written (a saved report, a favorite, a client/project/tag, a restore), which returns that
    // record's renderer-safe view. Reads return their view.
    // PRD §12 R2 — the same toggle the tray click and the global hotkey fire (toggle.ts owns
    // the decision and the write); main.ts binds those two to it directly.
    toggle: () => toggleTimer(store, refreshAll),
    start: (payload) => {
      // The renderer's Start form supplies optional attributes (description, client, project,
      // tags, billable); resolve and forward them all (PRD §05 R1, §12 R1). A start can land on an
      // instant that overlaps an existing entry — warned, not blocked.
      const res = startWithAttributes(store, payload ?? {});
      refreshAll();
      return { warnings: res.warnings };
    },
    stop: () => {
      const res = store.stop({});
      refreshAll();
      return { warnings: res.warnings };
    },
    resume: () => {
      const res = store.resume();
      refreshAll();
      return { warnings: res.warnings };
    },
    add: (payload) => {
      // §12 R7 / §05 R5: backfill a completed entry from explicit from/to times. Mirror `tt add`
      // exactly — the two local datetime strings convert to UTC, client/project names resolve
      // through core's single rule, tags/billable ride along. A backfill can overlap an existing
      // entry — warned, not blocked (§06 R4) — so we return the uniform WriteAck carrying the
      // overlap warning. Core validation errors (`stop time must be after start time`) propagate
      // as the IPC rejection, which the renderer unwraps to its kernel (SU.errMessage, issue 138).
      const { clientId, projectId } = store.resolveClientProjectByName({
        client: payload.client,
        project: payload.project,
      });
      const res = store.add({
        description: payload.description ?? null,
        // The two strings are the add form's raw Start/Stop fields, so they are read back by
        // the ONE inverse of the format those fields render (localtime.ts, issue #159) — either
        // separator accepted, never an engine-locale guess. An unreadable value stays an Invalid
        // Date, so toUtc throws exactly as before and the renderer surfaces it (§12 R21).
        fromUtc: toUtc(parseLocalInput(payload.fromLocal)),
        toUtc: toUtc(parseLocalInput(payload.toLocal)),
        clientId,
        projectId,
        tags: payload.tags ?? [],
        ...(payload.billable !== undefined ? { billable: payload.billable } : {}),
      });
      refreshAll();
      return { warnings: res.warnings };
    },
    edit: (payload) => {
      // Editing a start/end can move an entry onto an instant that overlaps another (PRD §06 R4);
      // core warns-not-blocks, and we return that warning so the renderer raises the inline overlap
      // banner at the moment of the edit.
      const res = store.edit(payload.id, payload.patch);
      refreshAll();
      return { warnings: res.warnings };
    },
    split: (payload) => {
      // split returns the two new entries (not a WriteResult); cutting a span in place cannot
      // create a NEW overlap, so the ack is always empty — split keeps the WriteAck shape because
      // it is a span write, not because it has anything to report.
      store.split(payload.id, payload.atUtc);
      refreshAll();
      return { warnings: [] };
    },
    merge: (payload) => {
      // Fold a contiguous selection into one entry (PRD §06 R3). Core concatenates descriptions and
      // unions tags unconditionally; client/project and billable can disagree. The renderer cannot
      // resolve names, so when the conflict prompt picks a winner it sends that entry's id as
      // `winnerId` — we look it up here and pass its clientId/projectId as MergeOptions overrides,
      // plus the chosen billable flag. With no winnerId/billable core keeps the first entry's
      // attributes, exactly as `tt merge` does.
      const opts: Parameters<Store['merge']>[1] = {};
      if (payload.winnerId !== undefined) {
        const winner = store.getEntry(payload.winnerId);
        if (winner) {
          opts.clientId = winner.clientId;
          opts.projectId = winner.projectId;
        }
      }
      if (payload.billable !== undefined) opts.billable = payload.billable;
      // §06 R3: a non-contiguous selection is refused by core unless acknowledged. The renderer
      // sets allowGap only after the user confirms the gapped-span gate (§12 R13).
      if (payload.allowGap) opts.allowGap = true;
      const res = store.merge(payload.ids, opts);
      refreshAll();
      // A merge folds adjacent spans into one; the folded span can still overlap a third entry
      // outside the selection (PRD §06 R4), so return any overlap warning.
      return { warnings: res.warnings };
    },
    remove: (payload) => {
      store.remove(payload.id);
      refreshAll();
    },
    subtractSleep: (payload) => {
      store.subtractSleep(payload.id);
      refreshAll();
    },
    // §09 R1: the GUI report view's date-range picker. The five presets are resolved through core's
    // resolveRange (the renderer never re-derives date math) by the pure buildReportView helper; a
    // preset, when supplied, takes precedence, else the Custom fromUtc/toUtc pass straight through.
    // The returned shape is the core Report the report view paints verbatim.
    report: (payload) => buildReportView(store, payload, new Date()),
    // §09 R08–R09: saved report definitions. Each delegates straight to @stint/core — the single
    // source of truth — at parity with `tt report save|ls|show|rename|rm|run`. The mutators refresh
    // all windows so an open Reports view repaints; the reads do not.
    saveReport: (payload) => {
      const def = store.saveReport(savedReportInputFromView(payload));
      refreshAll();
      return savedReportToView(def);
    },
    listReports: () => store.listReports().map(savedReportToView),
    showReport: (payload) => {
      const def = store.getReport(payload.name);
      return def ? savedReportToView(def) : null;
    },
    renameReport: (payload) => {
      const def = store.renameReport(payload.name, payload.newName);
      refreshAll();
      return savedReportToView(def);
    },
    editReport: (payload) => {
      const def = store.editReport(payload.name, savedReportPatchFromView(payload.patch));
      refreshAll();
      return savedReportToView(def);
    },
    removeReport: (payload) => {
      store.removeReport(payload.name);
      refreshAll();
    },
    // §09 R09: run a saved report against current data. Straight to core — store.runReport
    // resolves the stored RangeSpec through resolveReportDef and reuses the one report() path,
    // so the renderer paints the SAME core Report the ad-hoc `report` channel returns and
    // re-derives no range, grouping, rounding, or totals. Accepts a name or id ref.
    runReport: (payload) => store.runReport(payload.ref, new Date()),
    // §05 R09: pinned timer favorites. Each delegates to @stint/core at parity with
    // `tt fav add|ls|rename|rm`. The mutators refresh all windows so an open Timer view repaints its
    // favorites rail; listFavorites is a read, no refresh.
    pinFavorite: (payload) => {
      const view = pinFavoriteFromView(store, payload);
      refreshAll();
      return view;
    },
    listFavorites: () => listFavoriteViews(store),
    renameFavorite: (payload) => {
      const fav = store.renameFavorite(payload.ref, payload.name);
      refreshAll();
      return favoriteToView(fav);
    },
    unpinFavorite: (payload) => {
      store.unpinFavorite(payload.ref);
      refreshAll();
    },
    // §05 R10: resume from a favorite — start a FRESH timer from the favorite's template. All logic
    // is in core (store.startFromFavorite delegates to start: atomic stop-then-start, the ≤1-open
    // invariant, the overlap warning); the favorite is never mutated. Parity with `tt fav start`.
    startFavorite: (payload) => {
      const res = store.startFromFavorite(payload.name);
      refreshAll();
      return { warnings: res.warnings };
    },
    exportEntries: (payload) => {
      // §09 R06/R09: the Reports view's exports. The renderer cannot reach Node/fs, so the export
      // round-trips through main. The request's SCOPE picks the set: 'filtered' writes the rows the
      // report shows (byte-identical to `tt report run <name> --csv|--json`), 'all' writes the raw
      // entries for the resolved range (byte-identical to `tt export`). resolveExportDefinition owns
      // the split; either way the bytes come from core's toCsv/toJsonEntries and write through the
      // OS save dialog. No network.
      const now = new Date();
      const { range, entries } = resolveExportDefinition(payload, store, now);
      const bytes = exportPayload(entries, payload.format, now);
      const target = deps.showSaveDialog(payload.format, exportFileName(range.fromUtc, payload.format));
      if (!target) return { canceled: true };
      writeFileSync(target, bytes);
      return { written: entries.length, path: target };
    },
    addClient: (payload) => store.addClient(payload.name),
    addProject: (payload) => store.addProject(payload.name, payload.clientId),
    // §12 R13: includeArchived lets the Clients view's "show archived" affordance reveal the
    // hidden records its Restore buttons act on (parity with `tt client ls --archived`).
    listClients: (payload) => store.listClients(payload?.includeArchived),
    // §07 / §12 R13: the Clients view's rename/archive/restore over the same reference-data
    // capabilities tt's `client`/`project` subcommands expose. Each is a thin delegate to core and
    // refreshes all windows so an open Clients view (or the entries view, whose labels are resolved
    // not copied) repaints the new truth. Restore is the reverse of archive (archived=0).
    renameClient: (payload) => {
      store.renameClient(payload.id, payload.name);
      refreshAll();
    },
    archiveClient: (payload) => {
      store.archiveClient(payload.id);
      refreshAll();
    },
    restoreClient: (payload) => {
      store.restoreClient(payload.id);
      refreshAll();
    },
    renameProject: (payload) => {
      store.renameProject(payload.id, payload.name);
      refreshAll();
    },
    archiveProject: (payload) => {
      store.archiveProject(payload.id);
      refreshAll();
    },
    restoreProject: (payload) => {
      // Core refuses restoring a project whose owning client is still archived (StoreError → the
      // renderer surfaces it, R21); the happy path returns the project to the pickers.
      store.restoreProject(payload.id);
      refreshAll();
    },
    listProjects: (payload) => store.listProjects(payload?.clientId, payload?.includeArchived),
    // §12 R10: the Clients view's tag-management strip. Each delegates straight to core at parity
    // with `tt tag add/rename/archive/restore/ls`. The mutators refresh all windows; listTags is a read.
    listTags: (payload) => store.listTags(payload?.includeArchived),
    addTag: (payload) => {
      const t = store.addTag(payload.name);
      refreshAll();
      return t;
    },
    renameTag: (payload) => {
      store.renameTag(payload.id, payload.name);
      refreshAll();
    },
    archiveTag: (payload) => {
      store.archiveTag(payload.id);
      refreshAll();
    },
    restoreTag: (payload) => {
      store.restoreTag(payload.id);
      refreshAll();
    },
    setSetting: (payload) => {
      // §12 R11: the Settings view (and the report view's rounding controls) persist any §14 setting
      // over this one channel — parity with `tt config set`. A global-hotkey edit must take effect
      // live, so re-bind the OS shortcut here.
      const prevHotkey = store.settings().globalHotkey;
      // TS cannot correlate `key` and `value` across the SetSettingPayload union at a generic call
      // (a known limitation); the pair's shape is already typed at the seam, so apply through a
      // widened signature. This is not a payload-shape cast.
      (store.setSetting as (key: keyof ReturnType<Store['settings']>, value: unknown) => void)(
        payload.key,
        payload.value,
      );
      if (payload.key === 'globalHotkey') {
        const next = store.settings().globalHotkey;
        if (next !== prevHotkey) deps.rebindGlobalHotkey(prevHotkey, next);
      }
      refreshAll();
    },
    // §20 R04–R05 / §17 R12: automatic backups + restore — the Settings → Backups section. Each
    // delegates straight to @stint/core at parity with `tt backup ls|restore`. listBackups is a
    // read; restoreBackup quarantines the current file, re-points the store, and refreshes windows.
    listBackups: () => listBackupViews(store),
    restoreBackup: (payload) => {
      const r = store.restoreFromBackup(payload.name);
      refreshAll();
      return { recoveredFrom: r.recoveredFrom, quarantinedTo: r.quarantinedTo };
    },
  };

  return handlers;
}
