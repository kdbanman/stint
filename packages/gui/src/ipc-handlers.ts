/**
 * The shipping renderer↔main IPC handler map (PRD §12, §15) — extracted from main.ts so it
 * is pure, dependency-injected, and Electron-free, exactly like the QA-driver port it mirrors
 * (qa/driver.mjs `createHandlers`). Two things fall out of that shape (issue #87):
 *
 *   1. The map is typed `IpcHandlers` (ipc.ts) against the per-channel IpcContract, so a
 *      reshaped payload or a CHANNELS entry without a handler stops compiling — no more
 *      `Record<string, unknown>`, per-handler `as` casts, or non-null bind.
 *   2. It is importable without a running main process, so test/ipc-handlers.test.ts binds
 *      its key set to CHANNELS both directions — the guard the port already had, now on the
 *      original the port ports.
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
  joinClientProject,
  type Store,
  type EntryGroupBy,
} from '@stint/core';
import type { IpcHandlers, ListEntriesQuery, EntryListView, WriteAck } from './ipc.js';
import { buildUiState } from './uistate.js';
import { startWithAttributes } from './start.js';
import {
  buildReportView,
  buildSavedReportView,
  resolveDateRange,
  resolveExportDefinition,
  exportPayload,
  exportFileName,
  savedReportToView,
  savedReportInputFromView,
  savedReportPatchFromView,
} from './reportview.js';
import {
  pinFavorite as pinFavoriteHelper,
  listFavorites as listFavoritesHelper,
  favoriteToView,
} from './favorites.js';
import { listBackups as listBackupsHelper } from './backupview.js';

/** The OS-bound seam main.ts supplies; everything else the handlers need is imported above. */
export interface IpcHandlerDeps {
  store: Store;
  /** Repaint every open window after a write (main.ts: updateTray + broadcast('changed')). */
  refreshAll: () => void;
  /** The tray/hotkey timer toggle (PRD §12 R2); shared with main.ts's OS wiring, injected once. */
  toggleTimer: () => WriteAck;
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
  const { groups } = buildEntryList(entries, { by: (q.by as EntryGroupBy | undefined) ?? 'day' });
  return {
    groups: groups.map((g) => ({
      key: g.key,
      billableSeconds: g.entries.reduce((s, e) => s + e.billableSeconds, 0),
      entries: g.entries.map((e) => {
        const full = byId.get(e.id)!;
        const overlap = overlaps.get(full.id);
        return {
          id: full.id,
          description: full.description,
          clientLabel: joinClientProject(full.clientName, full.projectName),
          startUtc: full.startUtc,
          endUtc: full.endUtc,
          billableSeconds: full.billableSeconds,
          billable: full.billable,
          overlapped: overlap !== undefined,
          overlapMinutes: overlap ? Math.round(overlap.overlapSeconds / 60) : 0,
          overlapRelation: overlap ? overlap.relation : null,
          sleptThrough: full.sleptThrough,
          excludedSeconds: full.excludedSeconds,
          rawSeconds: full.rawSeconds,
          tags: full.tags,
        };
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
    // A write IPC channel returns a WriteAck carrying the core write's warnings (PRD §06 R4:
    // overlap is allowed but flagged) so the renderer can surface an inline banner at the moment
    // of the edit. getState/report/list-style channels stay value-returning.
    toggle: () => deps.toggleTimer(),
    start: (payload) => {
      // The renderer's Start form supplies optional attributes (description, client, project,
      // tags, billable); resolve and forward them all (PRD §05 R1, §12 R1). A start can land on an
      // instant that overlaps an existing entry — warned, not blocked.
      const res = startWithAttributes(store, payload ?? {});
      refreshAll();
      return { warnings: res.warnings ?? [] };
    },
    stop: () => {
      const res = store.stop({});
      refreshAll();
      return { warnings: res.warnings ?? [] };
    },
    resume: () => {
      const res = store.resume();
      refreshAll();
      return { warnings: res.warnings ?? [] };
    },
    add: (payload) => {
      // §12 R7 / §05 R5: backfill a completed entry from explicit from/to times. Mirror `tt add`
      // exactly — the two local datetime strings convert to UTC, client/project names resolve
      // through core's single rule, tags/billable ride along. A backfill can overlap an existing
      // entry — warned, not blocked (§06 R4) — so we return the uniform WriteAck carrying the
      // overlap warning. Core validation errors (`--to must be after --from`) propagate as the
      // IPC rejection.
      const { clientId, projectId } = store.resolveClientProjectByName({
        client: payload.client,
        project: payload.project,
      });
      const res = store.add({
        description: payload.description ?? null,
        fromUtc: toUtc(new Date(payload.fromLocal)),
        toUtc: toUtc(new Date(payload.toLocal)),
        clientId,
        projectId,
        tags: payload.tags ?? [],
        ...(payload.billable !== undefined ? { billable: payload.billable } : {}),
      });
      refreshAll();
      return { warnings: res.warnings ?? [] };
    },
    edit: (payload) => {
      // Editing a start/end can move an entry onto an instant that overlaps another (PRD §06 R4);
      // core warns-not-blocks, and we return that warning so the renderer raises the inline overlap
      // banner at the moment of the edit.
      const res = store.edit(payload.id, payload.patch);
      refreshAll();
      return { warnings: res.warnings ?? [] };
    },
    split: (payload) => {
      // split returns the two new entries (not a WriteResult); cutting a span in place cannot create
      // a NEW overlap, so there is nothing to warn about — but the channel still returns the uniform
      // WriteAck so the renderer's write path stays one shape.
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
      const res = store.merge(payload.ids, opts);
      refreshAll();
      // A merge folds adjacent spans into one; the folded span can still overlap a third entry
      // outside the selection (PRD §06 R4), so return any overlap warning.
      return { warnings: res.warnings ?? [] };
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
    // §09 R09: run a saved report against current data. buildSavedReportView is a thin pass-through
    // to store.runReport (resolving the stored RangeSpec through core), so the renderer paints the
    // SAME core Report the ad-hoc `report` channel returns. Accepts a name or id ref.
    runReport: (payload) => buildSavedReportView(store, payload.ref, new Date()),
    // §05 R09: pinned timer favorites. Each delegates to @stint/core at parity with
    // `tt fav add|ls|rename|rm`. The mutators refresh all windows so an open Timer view repaints its
    // favorites rail; listFavorites is a read, no refresh.
    pinFavorite: (payload) => {
      const view = pinFavoriteHelper(store, payload);
      refreshAll();
      return view;
    },
    listFavorites: () => listFavoritesHelper(store),
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
      return { warnings: res.warnings ?? [] };
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
    listClients: () => store.listClients(),
    // §07: the Clients view's rename/archive over the same reference-data capabilities tt's
    // `client`/`project` subcommands expose. Each is a thin delegate to core and refreshes all
    // windows so an open Clients view (or the entries view, whose labels are resolved not copied)
    // repaints the new truth.
    renameClient: (payload) => {
      store.renameClient(payload.id, payload.name);
      refreshAll();
    },
    archiveClient: (payload) => {
      store.archiveClient(payload.id);
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
    listProjects: (payload) => store.listProjects(payload?.clientId),
    // §12 R10: the Clients view's tag-management strip. Each delegates straight to core at parity
    // with `tt tag add/rename/archive/ls`. The mutators refresh all windows; listTags is a read.
    listTags: () => store.listTags(),
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
    listBackups: () => listBackupsHelper(store),
    restoreBackup: (payload) => {
      const r = store.restoreFromBackup(payload.name);
      refreshAll();
      return { recoveredFrom: r.recoveredFrom, quarantinedTo: r.quarantinedTo };
    },
  };

  return handlers;
}
