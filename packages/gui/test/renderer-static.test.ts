/**
 * Fast static guards for the renderer contract (PRD §12, §15). The full visual
 * judgement is the JUDGE harness (packages/gui/judge); these cheap checks catch a
 * regression in the empty-state copy or accent discipline on every commit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../renderer/${rel}`, import.meta.url)), 'utf8');

describe('renderer static contract', () => {
  it('the empty state instructs a concrete next action (§12 R5)', () => {
    const app = read('app.js');
    expect(app).toMatch(/No entries yet/);
    expect(app).toMatch(/tt start/);
    expect(app).toMatch(/friendlyHotkey/); // shows the actual configured hotkey
  });

  it('accent is applied only via the --accent variable (§15)', () => {
    const css = read('styles.css');
    // The primary action and running state use the accent variable…
    expect(css).toMatch(/button\.primary\s*\{[^}]*var\(--accent\)/s);
    // …and no rule hardcodes the seed accent hex outside the :root variable.
    const withoutRootVar = css.replace(/--accent:[^;]+;/g, '');
    expect(withoutRootVar).not.toMatch(/#2f6fed/);
  });

  it('the renderer ships a keyboard/focus pass: a :focus-visible ring, accent-disciplined, with announced toggle state (§12 R14)', () => {
    const css = read('styles.css');
    const html = read('index.html');
    const pop = read('popover.html');
    const app = read('app.js');
    const popJs = read('popover.js');
    // The focus pass exists: at least one :focus-visible rule defines the keyboard ring
    // (scoped to :focus-visible, not :focus, so a mouse click paints no ring — quiet feel)…
    expect(css).toMatch(/:focus-visible/);
    // …an ordinary button takes a NEUTRAL ring on a system gray, never the accent (§15 accent
    // discipline — accent stays on the primary action / running state)…
    expect(css).toMatch(/button:focus-visible\s*\{[^}]*outline:[^}]*var\(--rule-strong\)/s);
    // …only the primary action's ring may carry the accent (the one sanctioned accent ring)…
    expect(css).toMatch(/button\.primary:focus-visible\s*\{[^}]*var\(--accent\)/s);
    // …and no focus rule reintroduces a hardcoded accent hex outside the :root variable
    // (the existing accent guard pattern, reused here so the ring can't smuggle the hex in).
    const withoutRootVar = css.replace(/--accent:[^;]+;/g, '');
    expect(withoutRootVar).not.toMatch(/#2f6fed/);

    // The focus pass is NOT buttons-only: the text/select controls (the #search box, the
    // #el-client / #el-tag report filters, the inline edit + editor + settings fields) must
    // ALSO paint a keyboard ring. A single :focus-visible rule covers input/select/textarea
    // with the same NEUTRAL --rule-strong ring (never the accent — §15). Without it the JUDGE
    // KEYBOARD_FOCUS Tab-walk records ring misses on those controls.
    expect(css).toMatch(
      /input:focus-visible[\s\S]*?\{[^}]*outline:[^}]*var\(--rule-strong\)/,
    );
    expect(css).toMatch(/select:focus-visible/);
    // …and the quiet ringless `:focus` rules that suppress the outline must scope themselves to
    // `:focus:not(:focus-visible)` (mouse/typing only) so they never re-suppress the keyboard
    // ring. Guard: no `outline: none` rule may match a bare `:focus` (a keyboard focus too).
    const outlineNoneFocus = css.match(/[^\n]*:focus[^\n]*outline:\s*none/g) ?? [];
    for (const rule of outlineNoneFocus) {
      expect(rule).toMatch(/:focus:not\(:focus-visible\)/);
    }

    // The toggle exposes the aria hooks the JUDGE accessibility-tree walk + a screen reader
    // read: an aria-label and an aria-pressed state, in both windows, kept current by render().
    expect(html).toMatch(/id="toggle"[^>]*aria-pressed=/);
    expect(html).toMatch(/id="toggle"[^>]*aria-label=/);
    expect(pop).toMatch(/id="toggle"[^>]*aria-pressed=/);
    expect(pop).toMatch(/id="toggle"[^>]*aria-label=/);
    // …and both renderers reflect the live running/idle state onto aria-pressed on (re)render.
    expect(app).toMatch(/toggle\.setAttribute\('aria-pressed',\s*String\(!!running\)\)/);
    expect(popJs).toMatch(/toggle\.setAttribute\('aria-pressed',\s*String\(!!running\)\)/);
  });

  it('the Start form exposes the attribute fields and sends them over IPC (§05/§12 R1)', () => {
    const html = read('index.html');
    // The collapsed attributed-start form and its optional fields are present…
    expect(html).toMatch(/id="start-form"/);
    for (const id of ['start-desc', 'start-client', 'start-project', 'start-tags', 'start-bill']) {
      expect(html, `index.html must expose #${id}`).toMatch(new RegExp(`id="${id}"`));
    }
    // …and app.js builds a payload and calls window.stint.start with it (catching a
    // regression to a parameterless Start that silently drops attributes).
    const app = read('app.js');
    expect(app).toMatch(/window\.stint\.start\(\s*payload\s*\)/);
    expect(app).toMatch(/payload\.description/);
    expect(app).toMatch(/payload\.client/);
    expect(app).toMatch(/payload\.project/);
    expect(app).toMatch(/payload\.tags/);
    expect(app).toMatch(/billable:/);
  });

  it('the start surface offers the inline attribute form and flips to Switch while running (§12 R5)', () => {
    const html = read('index.html');
    const app = read('app.js');
    // The inline Start form exposes every attribute control (the start-immediately surface)…
    expect(html).toMatch(/id="start-form"/);
    for (const id of ['start-desc', 'start-client', 'start-project', 'start-tags', 'start-bill']) {
      expect(html, `index.html must expose #${id}`).toMatch(new RegExp(`id="${id}"`));
    }
    // …app.js builds the payload (resolving client/project + splitting tags) and starts
    // immediately over the same start IPC tt uses, defaulting the billable from the form…
    expect(app).toMatch(/window\.stint\.start\(\s*payload\s*\)/);
    expect(app).toMatch(/billable:\s*\$\('start-bill'\)\.checked/);
    expect(app).toMatch(/payload\.tags/);
    // …and the start surface presents the dedicated Switch affordance only while running:
    // the #switch button is shown by `running` and reads 'Switch', the one-tap atomic
    // stop-then-start (§05 R8) — the surface's label flips Start↔Switch by run state.
    expect(html).toMatch(/id="switch"[^>]*>Switch<|>Switch<\/button>/);
    expect(app).toMatch(/\$\('switch'\)\.hidden\s*=\s*!running/);
    expect(app).toMatch(/\$\('switch'\)\.addEventListener[\s\S]*?window\.stint\.start\(/);
  });

  it('the Add (backfill) form exposes explicit from/to + attributes and calls add over IPC (§05 R5)', () => {
    const html = read('index.html');
    // The collapsed backfill form and its fields are present — explicit from/to are the
    // defining shape of a backfill (a completed entry, not a running one)…
    expect(html).toMatch(/id="add-form"/);
    for (const id of ['add-desc', 'add-client', 'add-project', 'add-from', 'add-to', 'add-bill', 'add-tags']) {
      expect(html, `index.html must expose #${id}`).toMatch(new RegExp(`id="${id}"`));
    }
    expect(html).toMatch(/id="add-from"[^>]*type="datetime-local"/);
    expect(html).toMatch(/id="add-to"[^>]*type="datetime-local"/);
    // …and app.js sends a payload carrying fromLocal/toLocal over window.stint.add
    // (catching a regression that drops the from/to or never reaches core's add).
    const app = read('app.js');
    expect(app).toMatch(/window\.stint\.add\(payload\)/);
    expect(app).toMatch(/fromLocal:/);
    expect(app).toMatch(/toLocal:/);
    expect(app).toMatch(/window\.stint\.listClients\(\)/);
  });

  it('Switch is a dedicated affordance shown only while running, over the start IPC (§05 R8)', () => {
    const html = read('index.html');
    const pop = read('popover.html');
    // Both surfaces expose a #switch control…
    expect(html).toMatch(/id="switch"/);
    expect(pop).toMatch(/id="switch"/);
    const app = read('app.js');
    const popJs = read('popover.js');
    // …toggled by `running` (hidden when idle — Switch only makes sense mid-timer)…
    expect(app).toMatch(/\$\('switch'\)\.hidden\s*=\s*!running/);
    expect(popJs).toMatch(/\$\('switch'\)\.hidden\s*=\s*!running/);
    // …and clicking it calls window.stint.start (the atomic stop+start), then reloads.
    expect(app).toMatch(/\$\('switch'\)\.addEventListener[\s\S]*?window\.stint\.start\(/);
    expect(popJs).toMatch(/\$\('switch'\)\.addEventListener[\s\S]*?window\.stint\.start\(/);
  });

  it('every entry is editable inline in-context and any field is editable (§06 R1, §05 R6)', () => {
    const app = read('app.js');
    // Every row (including the open one) exposes an inline Edit affordance…
    expect(app).toMatch(/data-act="edit"/);
    // …handled into an inline edit form (not a separate page) that calls
    // window.stint.edit with {id, patch}…
    expect(app).toMatch(/openEditForm/);
    expect(app).toMatch(/window\.stint\.edit\(\{\s*id:\s*e\.id,\s*patch\s*\}\)/);
    // …the form seeds every field from the entry: description, start, end, billable,
    // and a client select populated from the same source tt uses (§06 R1: any field).
    expect(app).toMatch(/edit-desc/);
    expect(app).toMatch(/edit-start/);
    expect(app).toMatch(/edit-end/);
    expect(app).toMatch(/edit-bill-box/);
    expect(app).toMatch(/edit-client/);
    expect(app).toMatch(/window\.stint\.listClients\(\)/);
    // …and editing the RUNNING entry never sends endUtc — the End field is omitted for
    // the open row and the endUtc patch is gated behind `!running`, so the open entry
    // stays open (the §05 R6 guarantee, mirrored in the renderer affordance).
    expect(app).toMatch(/if\s*\(!running\s*&&\s*endLocal\)/);
    expect(app).toMatch(/const endField = running\s*\?\s*''/);
  });

  it('a closed entry exposes a Split affordance that calls the split capability (§06 R2)', () => {
    const app = read('app.js');
    // The Split control is rendered (gated to closed entries) and routes into an inline
    // split picker, not straight to a destructive action…
    expect(app).toMatch(/data-act="split"/);
    expect(app).toMatch(/openSplitForm/);
    // …only emitted for a CLOSED entry (the open/running row has no end, so no Split)…
    expect(app).toMatch(/if\s*\(e\.endUtc\s*!==\s*null\)\s*actions\.push\([^)]*data-act="split"/);
    // …and the confirm control sends an in-span instant over window.stint.split as a UTC
    // ISO (catching a regression that drops the split call or stops reaching core).
    expect(app).toMatch(/window\.stint\.split\(\{\s*id:\s*e\.id,\s*atUtc\s*\}\)/);
    expect(app).toMatch(/\.toISOString\(\)/);
  });

  it('Delete is destructive, so it goes through a confirm step (§06 R1)', () => {
    const app = read('app.js');
    // The Delete button only arms a confirm affordance on first click — it does not
    // remove immediately…
    expect(app).toMatch(/data-act="delete"/);
    expect(app).toMatch(/armDelete/);
    // …and only the explicit confirm control calls window.stint.remove. The confirm hook is
    // built by the generic confirm gate as `confirm-${kind}` (kind='delete'), so the runtime
    // data-act is "confirm-delete" via interpolation — assert the templated hook.
    expect(app).toMatch(/data-act="confirm-\$\{kind\}"/);
    expect(app).toMatch(/kind:\s*'delete'/);
    expect(app).toMatch(/window\.stint\.remove\(\{\s*id:\s*e\.id\s*\}\)/);
    // The first-click delete handler must route to armDelete, never straight to remove
    // (catch a regression to an immediate, unconfirmed delete).
    expect(app).toMatch(/act === 'delete'\)\s*return armDelete/);
  });

  it('a destructive action goes through a generic in-window confirm gate, never a stray click (§12 R13)', () => {
    const app = read('app.js');
    const css = read('styles.css');
    // The delete click handler routes to armDelete (no direct remove on the first click)…
    expect(app).toMatch(/act === 'delete'\)\s*return armDelete/);
    // …armDelete delegates to the GENERIC confirm gate (reused by the future archive-when-
    // referenced confirm, R10) rather than inlining its own bespoke two-step…
    expect(app).toMatch(/function confirmInline\(btn,/);
    expect(app).toMatch(/function armDelete\(btn, e\)\s*\{[\s\S]*?confirmInline\(btn,/);
    // …the gate carries stable hooks JUDGE + this guard assert: a confirm-<kind> + a
    // cancel-<kind> control and the .confirm class…
    expect(app).toMatch(/data-act="confirm-\$\{kind\}"/);
    expect(app).toMatch(/data-act="cancel-\$\{kind\}"/);
    expect(app).toMatch(/className = `confirm confirm-\$\{kind\}`/);
    // …and window.stint.remove is reachable ONLY through the confirm gate's callback, never
    // from the bare delete click. There must be exactly ONE remove() call site in app.js,
    // and it must sit inside armDelete's onConfirm (the confirm path) — catching a regression
    // to an immediate, unconfirmed delete on every commit.
    const removeSites = [...app.matchAll(/window\.stint\.remove\(/g)];
    expect(removeSites.length).toBe(1);
    const armDeleteBody = app.slice(app.indexOf('function armDelete(btn, e)'));
    expect(armDeleteBody).toMatch(/onConfirm:\s*async \(\)\s*=>\s*\{[\s\S]*?window\.stint\.remove\(\{\s*id:\s*e\.id\s*\}\)/);
    // The danger/confirm chrome is monochrome — the .danger button and the .confirm gate
    // never paint the accent (§15 accent discipline; the JUDGE ACCENT_DISCIPLINE scan also
    // walks this chrome). The danger button uses neutral/danger tokens, not var(--accent).
    expect(css).toMatch(/button\.danger\s*\{/);
    const withoutRootVar = css.replace(/--accent:[^;]+;/g, '');
    expect(withoutRootVar).not.toMatch(/button\.danger\s*\{[^}]*var\(--accent\)/s);
    expect(withoutRootVar).not.toMatch(/\.confirm\b[^{]*\{[^}]*var\(--accent\)/s);
  });

  it('destructive actions confirm and search/filter/group reflect live in the list AND the report total (§17 R11)', () => {
    const html = read('index.html');
    const app = read('app.js');
    const util = read('util.js');
    // (a) The destructive Delete is gated behind a confirm step — the first click only arms
    // the confirm gate, and window.stint.remove is reachable ONLY from inside it (no destroy
    // on a stray click). The single-remove-site invariant is asserted in the §12 R13 test
    // above; here we re-assert the routing so the §17 R11 confirm half has its own guard.
    expect(app).toMatch(/act === 'delete'\)\s*return armDelete/);
    expect(app).toMatch(/function armDelete\(btn, e\)\s*\{[\s\S]*?confirmInline\(btn,/);

    // (b) The Entries control bar (the search / filter / group selections) is present in the
    // page: the search box, the client/billable filters, and the group-by toggle.
    expect(html).toMatch(/id="search"/);
    expect(html).toMatch(/id="el-client"/);
    expect(html).toMatch(/id="el-billable-seg"/);
    expect(html).toMatch(/id="el-by-seg"/);

    // (c) The live view is DERIVED FROM THE SNAPSHOT — the pure deriveView (util.js mirror of
    // src/liveview.ts) recomputes the list + the report totals with no IPC reload. The filter
    // handlers repaint the report total off the snapshot, never re-fetching getState.
    expect(util).toMatch(/function deriveView\(state, sel\)/);
    expect(app).toMatch(/deriveView/);
    // The report total tracks the selection: render() picks the snapshot-derived report sum
    // when the control bar is active, and updateLiveTotal repaints #week-total off the
    // snapshot synchronously on each control change — neither path calls getState.
    expect(app).toMatch(/function updateLiveTotal\(\)/);
    expect(app).toMatch(/entryCtrlActive\s*\?\s*deriveView\(state,\s*liveSelection\(\)\)\.reportTotalSeconds/);
    // render() sets #week-total to the snapshot-derived report sum when the bar is active.
    expect(app).toMatch(/\$\('week-total'\)\.textContent\s*=\s*fmtHours\(\s*\n?\s*entryCtrlActive\s*\?\s*deriveView\(state,\s*liveSelection\(\)\)\.reportTotalSeconds/);
    // updateLiveTotal derives from the snapshot only — it must NOT reach for getState.
    const liveBody = app.slice(app.indexOf('function updateLiveTotal()'), app.indexOf('async function applyEntryQuery'));
    expect(liveBody).toMatch(/deriveView\(state,/);
    expect(liveBody).not.toMatch(/getState/);
  });

  it('a contiguous multi-select exposes a Merge action with a conflict prompt (§06 R3)', () => {
    const html = read('index.html');
    const app = read('app.js');
    // The Merge action bar and button are present in the page…
    expect(html).toMatch(/id="merge-bar"/);
    expect(html).toMatch(/id="merge-go"/);
    // …rows carry a selection affordance wired to a select handler that toggles the set…
    expect(app).toMatch(/data-act="select"/);
    expect(app).toMatch(/toggleSelect/);
    expect(app).toMatch(/const selected = new Set\(\)/);
    // …the Merge action is hidden until at least two entries are selected…
    expect(app).toMatch(/bar\.hidden = n < 2/);
    // …clicking Merge routes through mergeSelected, which calls window.stint.merge…
    expect(app).toMatch(/mergeSelected/);
    expect(app).toMatch(/window\.stint\.merge\(/);
    // …and disagreeing selections raise a conflict prompt asking which value to keep,
    // sending the winning entry's id (winnerId) + the chosen billable, never resolving
    // names in the renderer.
    expect(app).toMatch(/openConflictPrompt/);
    expect(app).toMatch(/which .* keep/i);
    expect(app).toMatch(/winnerId/);
  });

  it('a write that creates an overlap raises an at-write-time inline banner (§06 R4)', () => {
    const html = read('index.html');
    const app = read('app.js');
    const css = read('styles.css');
    // The banner host is present, announced (role=status / aria-live) for accessibility…
    expect(html).toMatch(/id="overlap-banner"/);
    expect(html).toMatch(/id="overlap-banner"[^>]*role="status"/);
    expect(html).toMatch(/id="overlap-banner"[^>]*aria-live/);
    // …app.js reads the WriteAck's warnings and shows the banner only on an overlap, with
    // allowed-but-flagged wording, and auto-clears it on every (re)load…
    expect(app).toMatch(/showOverlapBanner/);
    expect(app).toMatch(/applyAck/);
    expect(app).toMatch(/clearOverlapBanner\(\)/);
    expect(app).toMatch(/w\.kind === 'overlap'/);
    expect(app).toMatch(/allowed, but flagged/);
    // …the toggle/edit/merge write paths route their ack through applyAck (catching a
    // regression that drops the warnings the way the handlers used to)…
    expect(app).toMatch(/const ack = await window\.stint\.toggle\(\)/);
    expect(app).toMatch(/const ack = await window\.stint\.edit\(/);
    expect(app).toMatch(/applyAck\(ack\)/);
    // …and the banner uses the --flag tokens, never the accent (§15 accent discipline).
    expect(css).toMatch(/\.banner\s*\{[^}]*var\(--flag\)/s);
    expect(css).not.toMatch(/\.banner\s*\{[^}]*var\(--accent\)/s);
  });

  it('an overlapped row shows the detailed overlap banner and a slept-trimmed row strikes the raw duration (§12 R9)', () => {
    const app = read('app.js');
    const css = read('styles.css');
    // The affected row paints a detailed banner spelling out the overlapping amount + which
    // neighbour (previous/next), not only the compact "overlap" badge…
    expect(app).toMatch(/function overlapBannerHtml\(e\)/);
    expect(app).toMatch(/Overlap:\s*\$\{minutes\}m with \$\{which\} entry/);
    expect(app).toMatch(/overlapBannerHtml\(e\)/);
    // …driven by the core-owned overlapMinutes + previous/next relation off the row…
    expect(app).toMatch(/e\.overlapMinutes/);
    expect(app).toMatch(/e\.overlapRelation/);
    // …and a slept entry whose billable was trimmed renders the raw duration struck through
    // beside the live, trimmed billable duration (the trimmed value is what bills).
    expect(app).toMatch(/function durHtml\(e\)/);
    expect(app).toMatch(/<s class="struck">/);
    expect(app).toMatch(/e\.sleptThrough && \(e\.excludedSeconds \?\? 0\) > 0/);
    // CSS defines the .banner (overlap) and .struck rules, and neither hardcodes the accent
    // hex (monochrome --flag / --faint tokens only, §15 accent discipline).
    expect(css).toMatch(/\.banner\b/);
    expect(css).toMatch(/\.struck\b/);
    expect(css).toMatch(/\.struck[^{]*\{[^}]*line-through/s);
    const withoutRootVar = css.replace(/--accent:[^;]+;/g, '');
    expect(withoutRootVar).not.toMatch(/\.banner[^{]*\{[^}]*#2f6fed/s);
    expect(withoutRootVar).not.toMatch(/\.struck[^{]*\{[^}]*#2f6fed/s);
    // The detailed overlap banner is flag-coloured, never accented.
    expect(withoutRootVar).not.toMatch(/\.banner\.overlap[^{]*\{[^}]*var\(--accent\)/s);
  });

  it('tags show as chips in-context and an inline editor edits them over the edit IPC (§07)', () => {
    const app = read('app.js');
    const css = read('styles.css');
    // Every row's tags render as monochrome chips, off an entry tags accessor…
    expect(app).toMatch(/function tagsHtml\(e\)/);
    expect(app).toMatch(/e\.tags/);
    expect(app).toMatch(/class="chip"/);
    // …shown on the entry row and on the running summary line…
    expect(app).toMatch(/tagsHtml\(e\)/);
    expect(app).toMatch(/tagsHtml\(running\)/);
    // …with an in-context edit-tags affordance (not the full edit form)…
    expect(app).toMatch(/data-act="tags"/);
    expect(app).toMatch(/openTagEditor/);
    // …whose commit diffs the edited chip set via the pure window.SU.tagDiff and sends the
    // minimal { addTags, removeTags } over the same edit IPC tt uses (no tag logic in the
    // renderer beyond gathering the chips).
    expect(app).toMatch(/tagDiff\(original,\s*next\)/);
    expect(app).toMatch(/window\.stint\.edit\(\{\s*id:\s*e\.id,\s*patch:\s*\{\s*addTags,\s*removeTags\s*\}\s*\}\)/);
    // The chip text is always escaped (tags are user-controlled)…
    expect(app).toMatch(/escapeHtml\(t\)/);
    // …and .chip is monochrome — defined in CSS with no hardcoded accent hex (§15).
    expect(css).toMatch(/\.chip\s*\{/);
    const withoutRootVar = css.replace(/--accent:[^;]+;/g, '');
    // No chip rule pulls in the accent variable or the seed hex.
    expect(withoutRootVar).not.toMatch(/\.chip[^{]*\{[^}]*var\(--accent\)/s);
  });

  it('the main window ships an in-window Active-Timer card mirroring tt status (§12 R4)', () => {
    const html = read('index.html');
    const app = read('app.js');
    const css = read('styles.css');
    // The card region and its parts are present in the page: a live clock, a running/idle
    // state indicator, the description + client/project context, and the attribute flags…
    expect(html).toMatch(/id="timer-card"/);
    expect(html).toMatch(/id="timer-clock"/);
    expect(html).toMatch(/id="timer-state"/);
    expect(html).toMatch(/id="timer-desc"/);
    expect(html).toMatch(/id="timer-meta"/);
    expect(html).toMatch(/id="timer-flags"/);
    // …with both the primary Stop and the Switch controls (Stop carries the accent, Switch
    // is a plain button — accent discipline keeps a single fill).
    expect(html).toMatch(/id="timer-stop"[^>]*class="primary"|class="primary"[^>]*id="timer-stop"/);
    expect(html).toMatch(/id="timer-switch"/);
    // app.js paints the card from the running entry and reveals/hides the actions by state…
    expect(app).toMatch(/function renderTimerCard\(running\)/);
    expect(app).toMatch(/renderTimerCard\(running\)/);
    expect(app).toMatch(/card\.classList\.toggle\('running'/);
    // …the Stop reuses the existing toggle write and Switch reuses the start IPC (no new
    // channel — store.start is the atomic stop-then-start, §05 R8)…
    expect(app).toMatch(/\$\('timer-stop'\)\.addEventListener[\s\S]*?window\.stint\.toggle\(/);
    expect(app).toMatch(/\$\('timer-switch'\)\.addEventListener[\s\S]*?window\.stint\.start\(/);
    // …and the per-second count-up advances the card clock on the tick path (independent of
    // data changes), derived from elapsed(now − start), never stored.
    expect(app).toMatch(/function tick\(\)/);
    expect(app).toMatch(/\$\('timer-clock'\)/);
    expect(app).toMatch(/clock\.textContent\s*=\s*fmtDur\(elapsed\(/);
    // The card's accent stays on the running clock/state only, always via var(--accent) —
    // no hardcoded seed hex (the §15 accent-discipline guard above also covers the file).
    expect(css).toMatch(/\.timer-card\.running\s+\.clock\s*\{[^}]*var\(--accent\)/s);
    const withoutRootVar = css.replace(/--accent:[^;]+;/g, '');
    expect(withoutRootVar).not.toMatch(/\.timer-card[^{]*\{[^}]*#2f6fed/s);
  });

  it('the window shell ships a persistent left nav routing the five views (§12 R3)', () => {
    const html = read('index.html');
    const app = read('app.js');
    // The shell wraps a persistent nav rail and the routed views…
    expect(html).toMatch(/class="shell"/);
    expect(html).toMatch(/class="views"/);
    // …with exactly the five nav items, in the Timer/Entries/Clients/Reports/Settings order
    // (a regression to a missing/re-ordered item is caught here, cheaply, per commit).
    const navViews = [...html.matchAll(/class="nav-item[^"]*"\s+data-view="([^"]+)"/g)].map((m) => m[1]);
    expect(navViews).toEqual(['timer', 'entries', 'clients', 'reports', 'settings']);
    // …each routing to a matching <section class="view" data-view="…"> container…
    for (const view of ['timer', 'entries', 'clients', 'reports', 'settings']) {
      expect(html, `index.html must declare the ${view} view section`).toMatch(
        new RegExp(`class="view[^"]*"\\s+data-view="${view}"|data-view="${view}"[^>]*class="view`),
      );
    }
    // …Entries is the default active item (it carries `active` + aria-current on load)…
    expect(html).toMatch(/class="nav-item active"\s+data-view="entries"/);
    // …and app.js wires the client-side router: each nav-item's click calls route(view),
    // which toggles the section `hidden` by data-view and the `active` class on the items.
    expect(app).toMatch(/function route\(view\)/);
    expect(app).toMatch(/document\.querySelectorAll\('\.nav-item'\)/);
    expect(app).toMatch(/section\.hidden = section\.dataset\.view !== view/);
    expect(app).toMatch(/item\.classList\.toggle\('active'/);
    expect(app).toMatch(/item\.addEventListener\('click',\s*\(\)\s*=>\s*route\(item\.dataset\.view\)\)/);
  });

  it('the renderer ships a Clients nav view wired to the client/project IPC (§07, §12)', () => {
    const html = read('index.html');
    const app = read('app.js');
    // The nav shell and the Clients section are present in the page…
    expect(html).toMatch(/class="nav"/);
    expect(html).toMatch(/data-view="clients"/);
    expect(html).toMatch(/id="clients"/);
    expect(html).toMatch(/id="add-client"/);
    // …nav switching routes to the Clients view and renders it on demand…
    expect(app).toMatch(/route\(/);
    expect(app).toMatch(/renderClients/);
    // …the view reads the active clients and their projects from the same IPC tt uses…
    expect(app).toMatch(/window\.stint\.listClients\(\)/);
    expect(app).toMatch(/window\.stint\.listProjects\(\{\s*clientId/);
    // …and offers create/rename/archive in place over the client/project mutators
    // (archived items are excluded by listClients/listProjects' default — archive hides
    // from the active list but keeps history).
    expect(app).toMatch(/window\.stint\.addClient\(/);
    expect(app).toMatch(/window\.stint\.addProject\(/);
    expect(app).toMatch(/window\.stint\.renameClient\(/);
    expect(app).toMatch(/window\.stint\.archiveClient\(/);
    expect(app).toMatch(/window\.stint\.renameProject\(/);
    expect(app).toMatch(/window\.stint\.archiveProject\(/);
  });

  it('the Clients view ships a tag-management strip wired to the tag IPC (§12 R10)', () => {
    const html = read('index.html');
    const app = read('app.js');
    // The Tags strip and its add control live in the Clients view…
    expect(html).toMatch(/id="tags-list"/);
    expect(html).toMatch(/id="add-tag"/);
    // …the view renders the active tags from the same IPC tt uses (renderClients also
    // renders the tag strip; renderTags reads listTags)…
    expect(app).toMatch(/renderTags/);
    expect(app).toMatch(/window\.stint\.listTags\(\)/);
    // …and offers create/rename/archive in place over the tag mutators only — never the DB
    // directly — at parity with `tt tag add/rename/archive` (archived tags drop out of
    // listTags' default, hiding them from the active list while keeping history).
    expect(app).toMatch(/window\.stint\.addTag\(/);
    expect(app).toMatch(/window\.stint\.renameTag\(/);
    expect(app).toMatch(/window\.stint\.archiveTag\(/);
  });

  it('the report builder offers the §08 R3 three-way Billable toggle wired to report() (§08 R3, §12 R8)', () => {
    const html = read('report.html');
    // The report view exists, shares index.html's CSP, and loads util.js then report.js.
    expect(html).toMatch(/Content-Security-Policy/);
    expect(html).toMatch(/default-src 'none'/);
    expect(html).toMatch(/src="util\.js"/);
    expect(html).toMatch(/src="report\.js"/);
    // The Billable control is a single segmented control offering all three filters…
    expect(html).toMatch(/id="billable-seg"/);
    expect(html).toMatch(/data-billable="billable"/);
    expect(html).toMatch(/data-billable="all"/);
    expect(html).toMatch(/data-billable="non-billable"/);
    expect(html).toMatch(/Billable only/);
    expect(html).toMatch(/Non-billable/);
    // …with the billable-only segment active by default (reports default billable-only).
    expect(html).toMatch(/data-billable="billable"[^>]*class="seg-btn on"|class="seg-btn on"[^>]*data-billable="billable"/);

    const js = read('report.js');
    // report.js drives the view entirely through window.stint.report — no arithmetic here.
    expect(js).toMatch(/window\.stint\.report\(/);
    expect(js).toMatch(/billableFilter/);
    // The default filter is billable-only, and clicking a segment sets billableFilter and
    // re-runs the report (catching a regression to a static or all-filter default).
    expect(js).toMatch(/billableFilter:\s*'billable'/);
    expect(js).toMatch(/opts\.billableFilter\s*=\s*btn\.dataset\.billable/);
    // app.js's report button navigates to the report view (no new window-open IPC channel).
    const app = read('app.js');
    expect(app).toMatch(/report-btn/);
    expect(app).toMatch(/report\.html/);
  });

  it('the report view offers a date-range preset/custom picker resolved through core (§09 R1)', () => {
    const html = read('report.html');
    // The five named presets render as labelled chips, plus a Custom escape hatch…
    expect(html).toMatch(/data-preset="today"/);
    expect(html).toMatch(/data-preset="week"/);
    expect(html).toMatch(/data-preset="last-week"/);
    expect(html).toMatch(/data-preset="month"/);
    expect(html).toMatch(/data-preset="last-month"/);
    expect(html).toMatch(/data-preset="custom"/);
    for (const label of ['Today', 'This week', 'Last week', 'This month', 'Last month']) {
      expect(html, `report.html must label the ${label} preset`).toMatch(new RegExp(label));
    }
    // …with This week active by default (the at-a-glance figure)…
    expect(html).toMatch(/data-preset="week"[^>]*class="preset on"|class="preset on"[^>]*data-preset="week"/);
    // …the custom from/to inputs are present (revealed only for Custom)…
    expect(html).toMatch(/id="range-from"/);
    expect(html).toMatch(/id="range-to"/);
    // …and a resolved-range header is painted so the chosen window is visible.
    expect(html).toMatch(/id="report-range"/);

    const js = read('report.js');
    // The preset chips send the preset NAME over window.stint.report — core resolves the
    // bounds — and the custom path passes the user's explicit from/to straight through…
    expect(js).toMatch(/preset:\s*range\.preset/);
    expect(js).toMatch(/fromUtc:\s*range\.fromUtc/);
    expect(js).toMatch(/toUtc:\s*range\.toUtc/);
    // …the default selection is This week…
    expect(js).toMatch(/preset:\s*'week'/);
    // …the resolved range header is painted off the Report core returned (not re-derived)…
    expect(js).toMatch(/report\.rangeFromUtc/);
    expect(js).toMatch(/report\.rangeToUtc/);
    // …and the renderer re-derives NO preset date math: no setHours/getDay/setDate week
    // arithmetic survives (the old renderer-side thisWeekRange is gone — core owns it).
    expect(js).not.toMatch(/setHours\(0, 0, 0, 0\)/);
    expect(js).not.toMatch(/thisWeekRange/);
  });

  it('the report view offers a Group-by control over the four groupings wired to report() (§09 R2)', () => {
    const html = read('report.html');
    // The Group-by segmented control exists with EXACTLY the four core groupings as its
    // data-by values — client / project / day / tag (the §09 grouping the GUI control drives).
    expect(html).toMatch(/id="by-seg"/);
    const byValues = [...html.matchAll(/data-by="([^"]*)"/g)].map((m) => m[1]);
    expect(byValues.sort()).toEqual(['client', 'day', 'project', 'tag']);
    // Group-by labels mirror the mockup's segment (Client / Project / Day / Tag).
    for (const label of ['Client', 'Project', 'Day', 'Tag']) {
      expect(html, `report.html must label the ${label} grouping`).toMatch(new RegExp(`>${label}<`));
    }
    // Exactly one segment is active by default (Client — the default grouping).
    expect(html).toMatch(/data-by="client"[^>]*class="seg-btn on"|class="seg-btn on"[^>]*data-by="client"/);

    const js = read('report.js');
    // report.js drives the grouping entirely through window.stint.report — no arithmetic
    // here — sending a `by` field taken straight from the control's dataset…
    expect(js).toMatch(/window\.stint\.report\(/);
    expect(js).toMatch(/by:\s*opts\.by/);
    // …the default grouping is client, and clicking a segment sets opts.by from the clicked
    // button's data-by and re-runs the report (catching a regression to a static grouping).
    expect(js).toMatch(/by:\s*'client'/);
    expect(js).toMatch(/opts\.by\s*=\s*btn\.dataset\.by/);
    expect(js).toMatch(/\$\('by-seg'\)\.addEventListener/);
    // The grouping never re-derives keys/totals in the renderer: lines are painted straight
    // off the Report core returns (line.key + the core-owned seconds), so the §09 R4 rule
    // (rounding/grouping owned by core) holds — no renderer-side bucketing.
    expect(js).toMatch(/line\.key/);
    expect(js).not.toMatch(/reduce\(/); // no renderer-side summation of the grouped lines
  });

  it('the report view offers client/project/tag filter controls wired to report() (§09 R3, §12 R8)', () => {
    const html = read('report.html');
    // All four filter controls are present and discoverable: the client/project selects,
    // the tag input, and the billable segment (the three-way control covered above).
    for (const id of ['f-client', 'f-project', 'f-tag', 'billable-seg']) {
      expect(html, `report.html must expose #${id}`).toMatch(new RegExp(`id="${id}"`));
    }
    // The client/project filters default to an "All …" (no-filter) option…
    expect(html).toMatch(/id="f-client"[\s\S]*?All clients/);
    expect(html).toMatch(/id="f-project"[\s\S]*?All projects/);

    const js = read('report.js');
    // report.js folds the chosen client/project/tag into the report request — an unset
    // client/project is omitted (no filter), the chosen entity id is sent (the renderer
    // resolves no names), and the request spreads the filter params alongside the range…
    expect(js).toMatch(/req\.clientId\s*=\s*filter\.clientId/);
    expect(js).toMatch(/req\.projectId\s*=\s*filter\.projectId/);
    expect(js).toMatch(/req\.tag\s*=\s*filter\.tag/);
    expect(js).toMatch(/\.\.\.filterReq\(\)/);
    // …the client filter sends an id (not a name), repopulating the project options from
    // the same source tt uses, and the controls re-run the report on change…
    expect(js).toMatch(/filter\.clientId\s*=\s*v === ''\s*\?\s*null\s*:\s*Number\(v\)/);
    expect(js).toMatch(/window\.stint\.listProjects\(\{\s*clientId:\s*filter\.clientId\s*\}\)/);
    expect(js).toMatch(/window\.stint\.listClients\(\)/);
    expect(js).toMatch(/\$\('f-client'\)\.addEventListener/);
    expect(js).toMatch(/\$\('f-tag'\)\.addEventListener/);
  });

  it('the report view offers a rounding toggle + 6/10/15/30 increment picker persisted via setSetting (§09 R4, §12 R8)', () => {
    const html = read('report.html');
    // The rounding control group exists: an Off/On toggle and an increment picker…
    expect(html).toMatch(/id="rounding"/);
    expect(html).toMatch(/id="rounding-increment"/);
    // …the picker offers exactly the four core increments (6 / 10 / 15 / 30 min)…
    const incrementValues = [...html.matchAll(/<option value="(\d+)"/g)].map((m) => m[1]);
    for (const v of ['6', '10', '15', '30']) {
      expect(incrementValues, `report.html must offer the ${v}-min increment`).toContain(v);
    }
    // …with nearest-15 the default (PRD §09: default nearest 15).
    expect(html).toMatch(/<option value="15"[^>]*>[^<]*nearest 15/);

    const js = read('report.js');
    // The toggle and the increment picker BOTH persist the choice over the same setSetting
    // channel tt config set uses (parity-covered — no new channel), then re-run the report…
    expect(js).toMatch(/window\.stint\.setSetting\(\{\s*key:\s*'rounding',\s*value:\s*opts\.rounding\s*\}\)/);
    expect(js).toMatch(/window\.stint\.setSetting\(\{\s*key:\s*'roundingIncrementMin',\s*value:\s*opts\.roundingIncrementMin\s*\}\)/);
    // …the displayed line picks the rounded total when rounding is on and the exact total
    // when off — core owns the rounding, the renderer only chooses which seconds to show…
    expect(js).toMatch(/opts\.rounding\s*\?\s*line\.roundedSeconds\s*:\s*line\.totalSeconds/);
    expect(js).toMatch(/opts\.rounding\s*\?\s*report\.grandRoundedSeconds\s*:\s*report\.grandTotalSeconds/);
    // …and the increment picker is disabled/de-emphasized when rounding is off (a secondary
    // choice once the Off/On decision is made), so the renderer re-derives no rounding.
    expect(js).toMatch(/function reflectRounding\(\)/);
    expect(js).toMatch(/inc\.disabled\s*=\s*!opts\.rounding/);
    // The renderer adds no rounding arithmetic of its own (no Math.round/roundSeconds here).
    expect(js).not.toMatch(/roundSeconds/);
  });

  it('the report view offers Export CSV/JSON over the exportEntries IPC and an on-screen summary with flags in context (§09 R6, §12 R8)', () => {
    const html = read('report.html');
    const js = read('report.js');
    const css = read('styles.css');
    // The on-screen grouped summary container + the two Export buttons are present and
    // discoverable in the report view (the §09 R6 export surface over the same range).
    expect(html).toMatch(/id="report-summary"|class="report-summary"/);
    expect(html).toMatch(/id="report-rows"/);
    expect(html).toMatch(/id="export-csv"/);
    expect(html).toMatch(/id="export-json"/);
    expect(html).toMatch(/Export CSV/);
    expect(html).toMatch(/Export JSON/);
    // report.js drives the export over a dedicated exportEntries IPC channel (the renderer
    // cannot touch fs — main writes the file), carrying the chosen format + the shown range,
    // and never renders or builds the bytes itself…
    expect(js).toMatch(/window\.stint\.exportEntries\(\{\s*format[\s\S]*?\.\.\.rangeReq\(\)\s*\}\)/);
    expect(js).toMatch(/exportEntries\('csv'\)/);
    expect(js).toMatch(/exportEntries\('json'\)/);
    expect(js).toMatch(/\$\('export-csv'\)\.addEventListener/);
    expect(js).toMatch(/\$\('export-json'\)\.addEventListener/);
    // …the summary surfaces flags IN CONTEXT on the affected rows via the pure window.SU
    // .lineFlags over the core Report's overlapped / unreviewed-sleep id sets — no separate
    // flag list and no renderer-side flag derivation beyond the set membership…
    expect(js).toMatch(/lineFlags\(line,\s*report\.overlappedEntryIds,\s*report\.unreviewedSleepEntryIds\)/);
    expect(js).toMatch(/class="report-flag"/);
    // …and the flag chip uses the --flag tokens, never the accent (§15 accent discipline);
    // the export buttons are likewise monochrome (no accent fill/var on either).
    expect(css).toMatch(/\.report-flag\s*\{[^}]*var\(--flag\)/s);
    expect(css).not.toMatch(/\.report-flag\s*\{[^}]*var\(--accent\)/s);
    expect(css).not.toMatch(/\.report-export-btn\s*\{[^}]*var\(--accent\)/s);
  });

  it('the consolidated entry editor is a pure renderer module exposing openEditor + split/merge (§12 R6)', () => {
    const editor = read('editor.js');
    const app = read('app.js');
    const html = read('index.html');
    // editor.js exposes the window.SE module with the consolidated editor + the merge flow…
    expect(editor).toMatch(/window\.SE\s*=/);
    expect(editor).toMatch(/function openEditor\(/);
    expect(editor).toMatch(/mergeSelected/);
    // …the editor surfaces every tt-editable field (description / client / project / start /
    // end / tags / billable) and a Split affordance, sending its writes over the same
    // edit/split/merge/remove IPC tt uses (no name resolution, no new channel)…
    for (const cls of ['ed-desc', 'ed-client', 'ed-project', 'ed-start', 'ed-end', 'ed-bill-box', 'ed-chips']) {
      expect(editor, `editor.js must build the .${cls} field`).toMatch(new RegExp(cls));
    }
    expect(editor).toMatch(/ed-split-btn/);
    expect(editor).toMatch(/window\.stint\.edit\(\{\s*id:\s*entry\.id,\s*patch\s*\}\)/);
    expect(editor).toMatch(/window\.stint\.split\(\{\s*id:\s*entry\.id,\s*atUtc\s*\}\)/);
    expect(editor).toMatch(/window\.stint\.merge\(/);
    expect(editor).toMatch(/window\.stint\.remove\(\{\s*id:\s*entry\.id\s*\}\)/);
    // …editing the RUNNING entry omits End and never sends endUtc (the open row stays open)…
    expect(editor).toMatch(/const running = entry\.endUtc === null/);
    expect(editor).toMatch(/if\s*\(!running\s*&&\s*endLocal\)/);
    // …it resolves no names: the Client select carries the entity id, and the tag delta goes
    // through the pure window.SU.tagDiff (not bespoke tag logic in the editor)…
    expect(editor).toMatch(/window\.SU\.tagDiff\(originalTags,\s*nextTags\)/);
    // …and the disagreeing merge selection raises a conflict prompt asking which to keep,
    // sending the winning entry's id (winnerId) + the chosen billable, never a resolved name.
    expect(editor).toMatch(/winnerId/);
    expect(editor).toMatch(/which .* keep/i);

    // app.js wires the per-row kebab (⋯) to open the consolidated editor, loads the client
    // list once for it, and exposes a toolbar Merge-selected control over window.SE…
    expect(app).toMatch(/data-act="menu"/);
    expect(app).toMatch(/act === 'menu'\)\s*return window\.SE\.openEditor/);
    expect(app).toMatch(/window\.stint\.listClients\(\)/);
    expect(app).toMatch(/window\.SE\.mergeSelected/);
    expect(html).toMatch(/id="merge-selected"/);
    // …and index.html loads editor.js before app.js (the kebab handler depends on window.SE).
    expect(html).toMatch(/src="editor\.js"[\s\S]*src="app\.js"/);
  });

  it('the Settings view ships editable controls for every §14 setting wired to setSetting (§12 R11)', () => {
    const html = read('index.html');
    const settings = read('settings.js');
    // The Settings view section + its panel host live in the page, and index.html loads
    // settings.js after app.js (the panel renders off app.js's getState/onChange).
    expect(html).toMatch(/data-view="settings"/);
    expect(html).toMatch(/id="settings-panel"/);
    expect(html).toMatch(/src="settings\.js"/);
    // settings.js exposes a control for every one of the eight §14 settings (by its
    // setSetting key) — a regression that drops a control is caught cheaply per commit.
    for (const key of [
      'rounding',
      'roundingIncrementMin',
      'weekStart',
      'firstCheckinMin',
      'checkinIntervalMin',
      'globalHotkey',
      'accent',
      'dateFormat',
    ]) {
      expect(settings, `settings.js must expose the ${key} control`).toMatch(new RegExp(`'${key}'`));
    }
    // …and each control persists its value over the SAME setSetting channel tt config set
    // uses (no new channel — parity-covered), keyed/valued from the changed control.
    expect(settings).toMatch(/window\.stint\.setSetting\(\{\s*key,\s*value\s*\}\)/);
    // …the renderer honours the new accent-usage / date-format modes through the pure util
    // helpers (it derives no accent/date logic of its own beyond choosing the mode).
    expect(settings).toMatch(/applyAccentMode\(/);
    expect(settings).toMatch(/applyDateFormat\(/);
  });

  it('the renderer never imports Node or touches the DB directly (parity via IPC)', () => {
    for (const f of ['app.js', 'editor.js', 'popover.js', 'util.js', 'report.js', 'settings.js']) {
      const src = read(f);
      expect(src).not.toMatch(/require\(['"]node:/);
      expect(src).not.toMatch(/@stint\/core/);
    }
  });

  it('the renderer opens no outbound connection (§17 R9)', () => {
    // The renderer is shipped UI code that could reach the network straight from the
    // page; assert it uses none of the browser request APIs. (The no-network backstop
    // now also walks this directory; this keeps the guard close to the renderer.)
    const forbidden = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bEventSource\b/, /sendBeacon/];
    for (const f of ['app.js', 'editor.js', 'popover.js', 'util.js', 'report.js', 'settings.js']) {
      const src = read(f);
      for (const re of forbidden) expect(src, `${f} must not use ${re}`).not.toMatch(re);
    }
  });
});
