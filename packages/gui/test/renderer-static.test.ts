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
    // §12 R05 (core): the GUI core-entry surface lives in the Timer view, NOT the Entries
    // toolbar — the form + its disclosure are hosted inside <section data-view="timer">.
    const timerView = html.match(
      /<section class="view" data-view="timer"[\s\S]*?<\/section>\s*\n\s*<!-- §12 R3: the Entries view/,
    )?.[0];
    expect(timerView, 'index.html must declare the Timer view section').toBeTruthy();
    expect(timerView!).toMatch(/id="start-form"/);
    expect(timerView!).toMatch(/id="start-toggle"/);
    const entriesView = html.match(
      /<section class="view" data-view="entries">[\s\S]*?<!-- §07\/§12: the Clients view/,
    )?.[0];
    expect(entriesView, 'index.html must declare the Entries view section').toBeTruthy();
    expect(entriesView!).not.toMatch(/id="start-form"/);
    expect(entriesView!).not.toMatch(/id="start-toggle"/);
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

  it('the start surface is the Timer-view core-entry form and flips to Switch while running (§12 R5)', () => {
    const html = read('index.html');
    const app = read('app.js');
    // §12 R05 (core): the inline Start form exposes every attribute control (the
    // start-immediately surface) and is hosted in the Timer view — the GUI core-entry
    // surface relocated from the Entries toolbar (the form + disclosure + #toggle/#switch
    // primary live inside <section data-view="timer">, not the Entries section).
    const timerView = html.match(
      /<section class="view" data-view="timer"[\s\S]*?<\/section>\s*\n\s*<!-- §12 R3: the Entries view/,
    )?.[0];
    expect(timerView, 'index.html must declare the Timer view section').toBeTruthy();
    expect(timerView!).toMatch(/id="start-form"/);
    expect(timerView!).toMatch(/id="start-toggle"/);
    expect(timerView!).toMatch(/id="toggle"/);
    expect(timerView!).toMatch(/id="switch"/);
    for (const id of ['start-desc', 'start-client', 'start-project', 'start-tags', 'start-bill']) {
      expect(timerView!, `the Timer view must expose #${id}`).toMatch(new RegExp(`id="${id}"`));
    }
    // The Entries view no longer hosts the start surface (the relocation guarantee).
    const entriesView = html.match(
      /<section class="view" data-view="entries">[\s\S]*?<!-- §07\/§12: the Clients view/,
    )?.[0];
    expect(entriesView, 'index.html must declare the Entries view section').toBeTruthy();
    expect(entriesView!).not.toMatch(/id="start-form"/);
    expect(entriesView!).not.toMatch(/id="start-toggle"/);
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
    // §05 R05 / §12 R15 (G9): each from/to field also offers a calendar-icon trigger that
    // opens the shared visual time-range picker — tied to its field via aria-controls and
    // an aria-label, carrying the neutral .range-pick-btn background (§15 R-clickability).
    // Text entry stays authoritative; this only adds the picker affordance.
    expect(html).toMatch(
      /id="add-from-pick"[^>]*class="range-pick-btn"[\s\S]*?aria-controls="add-from"[\s\S]*?aria-label="[^"]+"/,
    );
    expect(html).toMatch(
      /id="add-to-pick"[^>]*class="range-pick-btn"[\s\S]*?aria-controls="add-to"[\s\S]*?aria-label="[^"]+"/,
    );
    // …and app.js sends a payload carrying fromLocal/toLocal over window.stint.add
    // (catching a regression that drops the from/to or never reaches core's add). The
    // picker write-back lands in the SAME fields, so the IPC payload shape is unchanged.
    const app = read('app.js');
    expect(app).toMatch(/window\.stint\.add\(payload\)/);
    expect(app).toMatch(/fromLocal:/);
    expect(app).toMatch(/toLocal:/);
    expect(app).toMatch(/window\.stint\.listClients\(\)/);
    // The trigger opens the shared picker (the §12 R15 component, window.STP) bound to the
    // two add inputs and writes the chosen start/stop back into #add-from/#add-to — it does
    // not author a second picker.
    expect(app).toMatch(/add-from-pick'\)\.addEventListener/);
    expect(app).toMatch(/add-to-pick'\)\.addEventListener/);
    expect(app).toMatch(/window\.STP\.open\(/);
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

  it('the FULL Active-Timer card lives in the Timer view and Entries keeps a compact strip (§12 R04)', () => {
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

    // §12 R04 PLACEMENT: the full #timer-card is hosted in the Timer view section, NOT in the
    // Entries section. Slice each top-level view section and assert where the card lives.
    const timerView = html.match(
      /<section class="view" data-view="timer"[\s\S]*?<\/section>\s*\n\s*<!-- §12 R3: the Entries view/,
    )?.[0];
    expect(timerView, 'index.html must declare the Timer view section').toBeTruthy();
    expect(timerView!).toMatch(/id="timer-card"/);
    expect(timerView!).toMatch(/id="timer-stop"/);
    expect(timerView!).toMatch(/id="timer-switch"/);
    // The Entries section runs from its comment to the start of the Clients view; the full card
    // must NOT live there — only the compact strip does.
    const entriesView = html.match(
      /<section class="view" data-view="entries">[\s\S]*?<!-- §07\/§12: the Clients view/,
    )?.[0];
    expect(entriesView, 'index.html must declare the Entries view section').toBeTruthy();
    expect(entriesView!).not.toMatch(/id="timer-card"/);
    expect(entriesView!).not.toMatch(/id="timer-stop"/);
    expect(entriesView!).not.toMatch(/id="timer-switch"/);
    // The Entries view ships the COMPACT STRIP — the live count-up, running/idle state, the
    // running description, plus a route-to-Timer affordance (the strip is itself a button).
    expect(entriesView!).toMatch(/id="timer-strip"/);
    expect(entriesView!).toMatch(/id="strip-clock"/);
    expect(entriesView!).toMatch(/id="strip-state"/);
    expect(entriesView!).toMatch(/id="strip-desc"/);
    expect(entriesView!).toMatch(/<button[^>]*class="timer-strip[^"]*"[^>]*id="timer-strip"|id="timer-strip"[^>]*class="timer-strip/);

    // app.js paints the FULL card (renderTimerCard) from the running entry and reveals/hides the
    // actions by state, AND paints the COMPACT strip (renderTimerStrip) on the Entries path…
    expect(app).toMatch(/function renderTimerCard\(running\)/);
    expect(app).toMatch(/renderTimerCard\(/);
    expect(app).toMatch(/card\.classList\.toggle\('running'/);
    expect(app).toMatch(/function renderTimerStrip\(running\)/);
    expect(app).toMatch(/renderTimerStrip\(running\)/);
    expect(app).toMatch(/strip\.classList\.toggle\('running'/);
    // …render() (Entries path) paints the strip, route('timer') paints the full card…
    expect(app).toMatch(/renderTimerCard\(state && state\.status\.running/);
    // …the strip routes to the Timer view (presentation only, no IPC)…
    expect(app).toMatch(/timerStrip\.addEventListener\('click',\s*\(\)\s*=>\s*route\('timer'\)\)/);
    // …the Stop reuses the existing toggle write and Switch reuses the start IPC (no new
    // channel — store.start is the atomic stop-then-start, §05 R8)…
    expect(app).toMatch(/\$\('timer-stop'\)\.addEventListener[\s\S]*?window\.stint\.toggle\(/);
    expect(app).toMatch(/\$\('timer-switch'\)\.addEventListener[\s\S]*?window\.stint\.start\(/);
    // …and the per-second count-up advances BOTH the card clock and the strip clock on the tick
    // path (independent of data changes), derived from elapsed(now − start), never stored.
    expect(app).toMatch(/function tick\(\)/);
    expect(app).toMatch(/\$\('timer-clock'\)/);
    expect(app).toMatch(/\$\('strip-clock'\)/);
    expect(app).toMatch(/clock\.textContent\s*=\s*fmtDur\(elapsed\(/);
    expect(app).toMatch(/stripClock\.textContent\s*=\s*fmtDur\(elapsed\(/);
    // The card's accent stays on the running clock/state only, always via var(--accent) — and
    // the strip mirrors it (`.timer-strip.running .clock`). No hardcoded seed hex (the §15
    // accent-discipline guard above also covers the file).
    expect(css).toMatch(/\.timer-card\.running\s+\.clock\s*\{[^}]*var\(--accent\)/s);
    expect(css).toMatch(/\.timer-strip\.running\s+\.clock\s*\{[^}]*var\(--accent\)/s);
    const withoutRootVar = css.replace(/--accent:[^;]+;/g, '');
    expect(withoutRootVar).not.toMatch(/\.timer-card[^{]*\{[^}]*#2f6fed/s);
    expect(withoutRootVar).not.toMatch(/\.timer-strip[^{]*\{[^}]*#2f6fed/s);
  });

  it('the window shell ships a persistent left nav routing the five views (§12 R3)', () => {
    const html = read('index.html');
    const app = read('app.js');
    const css = read('styles.css');
    // The shell wraps a persistent nav rail and the routed views…
    expect(html).toMatch(/class="shell"/);
    expect(html).toMatch(/class="views"/);
    // §12 R3 (G7): the rail is a FIXED width on resize — `.shell .nav` declares flex-none
    // (no grow/shrink) and a fixed 168px width, and `.views` is the sole grow/shrink target
    // (`flex: 1; min-width: 0`) so resize lands on the content, never the rail. This is a cheap
    // per-commit guard that the fixed-width rule is not accidentally removed; the behavioural
    // proof (byte-identical 168 across viewports) stays in JUDGE NAV_SHELL FIXED_WIDTH_ON_RESIZE.
    const navRule = css.match(/\.shell \.nav\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(navRule).toMatch(/flex:\s*none|flex-shrink:\s*0/);
    expect(navRule).toMatch(/width:\s*168px/);
    const viewsRule = css.match(/\.views\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(viewsRule).toMatch(/flex:\s*1/);
    expect(viewsRule).toMatch(/min-width:\s*0/);
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

  it('the nav rail labels each item with a line-icon from the one sprite — never an emoji (design-system)', () => {
    const html = read('index.html');
    // Each nav item carries the line-icon convention: an <svg class="ic"> pulling a #i-… symbol
    // from the single sprite, paired with its .nav-label. The five items map to the five view
    // icons (clock / list / users / chart / settings) in the Timer→Settings order.
    const navIcons = [...html.matchAll(/class="nav-item[^"]*"\s+data-view="[^"]+"[^>]*>\s*<svg class="ic"[^>]*><use href="(#i-[^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(navIcons).toEqual(['#i-clock', '#i-list', '#i-users', '#i-chart', '#i-settings']);
    // …and the shell carries NO emoji glyph anywhere (the restyle replaces every emoji/symbol
    // pictograph with the line-icon sprite). Scan the whole document for any pictographic glyph
    // (the prior nav used ◷ ▤ ◎ ▥ ⚙, the pickers ▦, the chevrons ▲▼) — none may remain. The
    // ranges cover Miscellaneous Technical, Geometric Shapes, Misc Symbols/Dingbats, the
    // supplemental arrows/shapes, and emoji — but spare the em-dash, ellipsis and § still in use.
    expect(html).not.toMatch(
      /[⌀-⏿■-◿☀-➿⬀-⯿←-⇿\u{1F000}-\u{1FAFF}]/u,
    );
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

  it('the Reports view is in the window shell, not a standalone page (§12 R08 / G7)', () => {
    const html = read('index.html');
    // The retired standalone report.html page is gone; the Reports view is a routed .view
    // section INSIDE the shell (so the sidebar is present, §12 R03). reports.js drives it,
    // loaded after app.js. No code references the deleted standalone page anymore.
    expect(() => read('report.html')).toThrow();
    expect(() => read('report.js')).toThrow();
    expect(html).toMatch(/<section class="view reports-view" data-view="reports"/);
    expect(html).toMatch(/src="reports\.js"/);
    // app.js's "This week" button routes to the in-shell Reports view (no window.location to
    // the deleted page); routing is the shell router, not a navigation.
    const app = read('app.js');
    expect(app).toMatch(/report-btn/);
    expect(app).toMatch(/route\('reports'\)/);
    expect(app).not.toMatch(/['"`]report\.html['"`]/);
  });

  it('the Reports view lists saved definitions with Run/Edit/kebab over listReports (§09 R08 / §12 R08)', () => {
    const html = read('index.html');
    const js = read('reports.js');
    // The saved-defs list + empty state are present (the primary saved-reports surface).
    expect(html).toMatch(/id="rep-defs"/);
    expect(html).toMatch(/id="rep-defs-empty"/);
    // reports.js lists the saved definitions over the SAME listReports IPC tt's `report ls`
    // drives, and paints one card (name + spec summary) per def with Run/Edit/kebab acts…
    expect(js).toMatch(/window\.stint\.listReports\(\)/);
    expect(js).toMatch(/class="def-run"/);
    expect(js).toMatch(/class="def-edit"/);
    expect(js).toMatch(/class="def-kebab"/);
    // …Run resolves+runs through core (runReport), Edit opens the builder, the kebab routes
    // to rename/delete (renameReport / removeReport, parity with tt report rename/rm)…
    expect(js).toMatch(/window\.stint\.runReport\(\{\s*ref/);
    expect(js).toMatch(/window\.stint\.renameReport\(/);
    expect(js).toMatch(/window\.stint\.removeReport\(/);
    // …and the destructive delete is confirmed in-window (§12 R13).
    expect(js).toMatch(/window\.confirm\(/);
  });

  it('the only accent affordance in the Reports view is the single + New report primary action (§15 / G10)', () => {
    const html = read('index.html');
    const css = read('styles.css');
    // The New report action is the view's single primary action — a line-icon (i-plus) + label,
    // no leading "+" glyph (the icon carries the add affordance, §design-system line icons only)…
    expect(html).toMatch(/id="rep-new" class="primary"/);
    expect(html).toMatch(/id="rep-new"[^>]*>[\s\S]*?<use href="#i-plus"[\s\S]*?New report/);
    expect(html).not.toMatch(/\+ New report/);
    // …it carries the accent (the one sanctioned use here)…
    expect(css).toMatch(/#rep-new\s*\{[^}]*var\(--accent\)/s);
    // …and the saved-definition cards + the builder + the run-output stay monochrome — none
    // of the card affordances or the builder outline carry the accent (§15 discipline).
    const withoutRootVar = css.replace(/--accent:[^;]+;/g, '');
    expect(withoutRootVar).not.toMatch(/\.def[^{]*\{[^}]*var\(--accent\)/s);
    expect(withoutRootVar).not.toMatch(/\.builder[^{]*\{[^}]*var\(--accent\)/s);
  });

  it('the Reports builder creates/edits a saved definition (range/group-by/filters/rounding) over save/editReport (§09 R08)', () => {
    const html = read('index.html');
    const js = read('reports.js');
    // The inline builder carries: a name input, the range seg (incl Custom), the group-by
    // seg, client/project/tag filters, the billable seg, the rounding toggle + increment.
    expect(html).toMatch(/id="rep-builder"/);
    expect(html).toMatch(/id="rep-name"/);
    expect(html).toMatch(/id="rep-preset-seg"/);
    expect(html).toMatch(/data-preset="custom"/);
    expect(html).toMatch(/id="rep-custom-range"/);
    expect(html).toMatch(/id="rep-by-seg"/);
    const byValues = [...html.matchAll(/data-by="([^"]*)"/g)].map((m) => m[1]);
    expect([...new Set(byValues)].sort()).toEqual(['client', 'day', 'project', 'tag']);
    for (const id of ['rep-client', 'rep-project', 'rep-tag', 'rep-billable-seg']) {
      expect(html, `index.html must expose #${id}`).toMatch(new RegExp(`id="${id}"`));
    }
    expect(html).toMatch(/id="rep-rounding"/);
    expect(html).toMatch(/id="rep-rounding-increment"/);
    // The five named presets + Custom are offered…
    for (const p of ['today', 'week', 'last-week', 'month', 'last-month']) {
      expect(html, `index.html must offer the ${p} preset`).toMatch(new RegExp(`data-preset="${p}"`));
    }
    // …and the increment picker offers exactly the four core increments (default nearest 15).
    const incrementValues = [...html.matchAll(/id="rep-rounding-increment"[\s\S]*?<\/select>/g)].join('').match(/value="(\d+)"/g) ?? [];
    for (const v of ['6', '10', '15', '30']) {
      expect(incrementValues.join(','), `must offer the ${v}-min increment`).toMatch(new RegExp(`"${v}"`));
    }
    // reports.js: Save creates a NEW def (saveReport) or amends the edited one (editReport),
    // both at parity with tt report save / tt report edit. The renderer sends client/project
    // IDS (never names): the client filter sends an id, an unset filter is omitted…
    expect(js).toMatch(/window\.stint\.saveReport\(/);
    expect(js).toMatch(/window\.stint\.editReport\(/);
    expect(js).toMatch(/window\.stint\.showReport\(/);
    expect(js).toMatch(/draft\.clientId\s*=\s*v === ''\s*\?\s*null\s*:\s*Number\(v\)/);
    expect(js).toMatch(/window\.stint\.listProjects\(\{\s*clientId:\s*draft\.clientId\s*\}\)/);
    expect(js).toMatch(/window\.stint\.listClients\(\)/);
    // …the range-spec is a relative preset OR an absolute custom window (kind preset/absolute)…
    expect(js).toMatch(/kind:\s*'preset'/);
    expect(js).toMatch(/kind:\s*'absolute'/);
    // …rounding rides the saved DEFINITION (no setSetting from the builder — it is per-def)…
    expect(js).not.toMatch(/setSetting/);
    // …and the renderer re-derives no preset date math (core owns resolveRange).
    expect(js).not.toMatch(/setHours\(0, 0, 0, 0\)/);
    expect(js).not.toMatch(/thisWeekRange/);
  });

  it('the Reports run-output paints grouped totals with flags in context + Export CSV/JSON from the saved report (§09 R09 / R06)', () => {
    const html = read('index.html');
    const js = read('reports.js');
    const css = read('styles.css');
    // The run-output panel reuses the report-summary/table chrome, plus a resolved-range
    // header and the two Export buttons (the §09 R06 export surface over the saved range).
    expect(html).toMatch(/id="rep-run"/);
    expect(html).toMatch(/id="rep-run-rows"/);
    expect(html).toMatch(/id="rep-run-range"/);
    expect(html).toMatch(/id="rep-export-csv"/);
    expect(html).toMatch(/id="rep-export-json"/);
    expect(html).toMatch(/Export CSV/);
    expect(html).toMatch(/Export JSON/);
    // reports.js paints the core Report runReport returned (lines + grand total), with flags
    // IN CONTEXT on the affected rows via the pure window.SU.lineFlags over the Report's
    // overlapped / unreviewed-sleep id sets — no separate flag list, no renderer flag math…
    expect(js).toMatch(/function paintRun\(/);
    expect(js).toMatch(/lineFlags\(line,\s*report\.overlappedEntryIds,\s*report\.unreviewedSleepEntryIds\)/);
    expect(js).toMatch(/class="report-flag"/);
    // …the displayed line picks the rounded total when the def rounds, the exact total
    // otherwise (the renderer chooses which core-owned seconds to show — no rounding math)…
    expect(js).toMatch(/rounding\s*\?\s*line\.roundedSeconds\s*:\s*line\.totalSeconds/);
    expect(js).toMatch(/report\.options\.rounding/);
    expect(js).not.toMatch(/roundSeconds/);
    // …the run-output Export buttons export FROM the saved report, carrying its ref so main
    // exports the definition's range (byte-identical to `tt report run <name> --csv|--json`).
    expect(js).toMatch(/window\.stint\.exportEntries\(\{\s*format,\s*savedReportRef/);
    expect(js).toMatch(/\$\('rep-export-csv'\)\.addEventListener/);
    expect(js).toMatch(/\$\('rep-export-json'\)\.addEventListener/);
    // The flag chip uses the --flag tokens, never the accent; the export buttons are
    // monochrome too (no accent fill/var on either) — §15 accent discipline.
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
    // settings.js exposes a control for every one of the seven §14 settings (by its
    // setSetting key) — a regression that drops a control is caught cheaply per commit.
    for (const key of [
      'rounding',
      'roundingIncrementMin',
      'weekStart',
      'firstCheckinMin',
      'checkinIntervalMin',
      'globalHotkey',
      'dateFormat',
    ]) {
      expect(settings, `settings.js must expose the ${key} control`).toMatch(new RegExp(`'${key}'`));
    }
    // …and each control persists its value over the SAME setSetting channel tt config set
    // uses (no new channel — parity-covered), keyed/valued from the changed control.
    expect(settings).toMatch(/window\.stint\.setSetting\(\{\s*key,\s*value\s*\}\)/);
    // …the renderer honours the date-format mode through the pure util helper (it derives no
    // date logic of its own beyond choosing the mode).
    expect(settings).toMatch(/applyDateFormat\(/);
  });

  it('the Settings view shows a read-only Software Update → Current version off the shared appVersion (§19 R06)', () => {
    const settings = read('settings.js');
    // The Software Update group + the Current version row are rendered, matching the mockup's
    // `.ver` span, and printed from state.appVersion (the shared @stint/core APP_VERSION the
    // getState snapshot carries — the SAME value `tt --version` prints, parity by construction).
    expect(settings).toMatch(/Software Update/);
    expect(settings).toMatch(/Current version/);
    expect(settings).toMatch(/class="ver"/);
    expect(settings).toMatch(/state\.appVersion/);
    // …rendered as a read-only display: the version row carries no setSetting-wired control
    // (the check/download flow is §19 R03/R04, out of scope). softwareUpdateHtml is appended
    // to the panel off the snapshot, never persisting a value.
    expect(settings).toMatch(/function softwareUpdateHtml\(/);
  });

  it('the Settings view ships a Software Update → Check-for-updates action over the update bridge (§19 R03)', () => {
    const html = read('index.html');
    const settings = read('settings.js');
    const css = read('styles.css');
    // The dedicated Software Update host element lives in the page (after the settings panel),
    // and index.html still loads settings.js (which renders into it).
    expect(html).toMatch(/id="software-update"/);
    expect(html).toMatch(/src="settings\.js"/);
    // settings.js renders the Check-for-updates row + button and reads the version + runs the
    // check over the GUI-ONLY window.stint.update bridge (NOT a parity channel — no tt twin,
    // like the tray / global hotkey). The button and the result line are present.
    expect(settings).toMatch(/Check for updates/);
    expect(settings).toMatch(/id="update-check"/);
    expect(settings).toMatch(/window\.stint\.update/);
    expect(settings).toMatch(/bridge\.getVersion\(\)/);
    expect(settings).toMatch(/bridge\.check\(\)/);
    // …it paints the three verdicts: up-to-date, "update available · <version>" (a link to the
    // release), and a graceful error message — never crashing on a failed check.
    expect(settings).toMatch(/status === 'up-to-date'/);
    expect(settings).toMatch(/status === 'update-available'/);
    expect(settings).toMatch(/update available · /);
    expect(settings).toMatch(/result\.releaseUrl/);
    expect(settings).toMatch(/result\.message/);
    // …the release link opens in the browser (target=_blank + rel=noopener), never an
    // in-window navigation.
    expect(settings).toMatch(/data-update-link/);
    expect(settings).toMatch(/setAttribute\('target',\s*'_blank'\)/);
    // …and the Check-now button + the update pill stay monochrome — neutral background, the
    // --flag tokens for the notice, never the accent (§15 accent discipline / R-clickability).
    expect(css).toMatch(/\.set-update-btn\s*\{/);
    const withoutRootVar = css.replace(/--accent:[^;]+;/g, '');
    expect(withoutRootVar).not.toMatch(/\.set-update-btn[^{]*\{[^}]*var\(--accent\)/s);
    expect(withoutRootVar).not.toMatch(/\.update-result[^{]*\{[^}]*var\(--accent\)/s);
    expect(withoutRootVar).not.toMatch(/\.pill\.new[^{]*\{[^}]*var\(--accent\)/s);
  });

  it('the Settings view ships a Software Update → download + guided install over the update bridge (§19 R04)', () => {
    const settings = read('settings.js');
    const css = read('styles.css');
    // When an update is available, the guided-install panel renders: a "Download & install"
    // primary action wired to the GUI-ONLY window.stint.update.download() bridge (R04), a live
    // progress bar fed by onUpdateProgress, and the numbered guided steps. After the artifact is
    // on disk the action flips to "Reveal installer" (window.stint.update.reveal()).
    expect(settings).toMatch(/function guidedInstallHtml\(/);
    expect(settings).toMatch(/id="update-download"/);
    expect(settings).toMatch(/id="update-reveal"/);
    expect(settings).toMatch(/Download &amp; install/);
    expect(settings).toMatch(/Reveal installer/);
    expect(settings).toMatch(/bridge\.download\(\)/);
    expect(settings).toMatch(/bridge\.reveal\(\)/);
    // …progress (the live bar + numbered steps) arrives over the dedicated update-progress
    // broadcast via the preload onUpdateProgress subscription — same shape as onChange.
    expect(settings).toMatch(/onUpdateProgress/);
    expect(settings).toMatch(/lastUpdateProgress/);
    // …the three download phases each paint: downloading (a bar), ready (reveal), error (a
    // graceful message) — never crashing on a failed download.
    expect(settings).toMatch(/phase === 'downloading'/);
    expect(settings).toMatch(/phase === 'ready'/);
    expect(settings).toMatch(/phase === 'error'/);
    // …the guided steps include the macOS one-time Gatekeeper beat — NO Developer ID /
    // notarization (decision G3) — and the replace-the-app-in-/Applications step.
    expect(settings).toMatch(/Gatekeeper/);
    expect(settings).toMatch(/no Developer ID/);
    expect(settings).toMatch(/\/Applications/);
    // …and the panel reassures the user the database is never touched (the artifact lands in a
    // temp folder, never beside the data — §19 R04 / §16 update-mid-timer).
    expect(settings).toMatch(/never touch the database/);
    // The Download & install action is this section's SINGLE accent action (button.primary);
    // the guided panel chrome itself stays the monochrome --flag notice — never the accent
    // beyond the one primary (§15 accent discipline / R-clickability).
    expect(css).toMatch(/\.update\s*\{/);
    expect(css).toMatch(/\.step\s+\.bar\s*\{/);
    const withoutRootVar = css.replace(/--accent:[^;]+;/g, '');
    expect(withoutRootVar).not.toMatch(/\.update[^-][^{]*\{[^}]*var\(--accent\)/s);
    expect(withoutRootVar).not.toMatch(/\.step[^{]*\{[^}]*var\(--accent\)/s);
  });

  it('the Settings view ships a Backups group (restore list + retention + recovery banner) over the backup IPC (§20 R04/R05)', () => {
    const html = read('index.html');
    const settings = read('settings.js');
    const css = read('styles.css');
    // The dedicated Backups host element lives in the page (after the Software Update host),
    // and index.html loads settings.js which renders into it.
    expect(html).toMatch(/id="backups-panel"/);
    expect(html).toMatch(/src="settings\.js"/);
    // settings.js renders the Backups group off the getState snapshot: the "Last backup" status
    // (R04) off state.lastBackupUtc, the restore list painted from window.stint.listBackups()
    // (parity with `tt backup ls`), and the recovery banner (R05) off state.recoveryNotice.
    expect(settings).toMatch(/function renderBackups\(/);
    expect(settings).toMatch(/Last backup/);
    expect(settings).toMatch(/window\.stint\.listBackups\(\)/);
    expect(settings).toMatch(/state\.lastBackupUtc/);
    expect(settings).toMatch(/recoveryNotice/);
    expect(settings).toMatch(/recoveredFrom/);
    expect(settings).toMatch(/quarantinedTo/);
    // …the retention picker (backupRetention) persists over the SAME setSetting channel
    // `tt config set` uses (no new channel — parity-covered), keyed/valued from the control…
    expect(settings).toMatch(/'backupRetention'/);
    // …and a Restore is destructive, so it goes through app.js's generic confirm gate (§12 R13):
    // restoreBackup is reachable ONLY from inside an onConfirm callback (never a stray click).
    expect(settings).toMatch(/confirmInline/);
    expect(settings).toMatch(/kind:\s*'restore'/);
    expect(settings).toMatch(/onConfirm:\s*async\s*\(\)\s*=>\s*\{\s*await window\.stint\.restoreBackup\(/);
    // …the Backups chrome is monochrome — the verified pill uses the calm run tokens, the
    // restore list / retention / recovery banner carry NO accent (§15 accent discipline).
    expect(css).toMatch(/\.backup-list\s*\{/);
    expect(css).toMatch(/\.ok\s*\{/);
    expect(css).toMatch(/\.banner\.recovery\s*\{/);
    const withoutRootVar = css.replace(/--accent:[^;]+;/g, '');
    expect(withoutRootVar).not.toMatch(/\.backup-[a-z]+[^{]*\{[^}]*var\(--accent\)/s);
    expect(withoutRootVar).not.toMatch(/\.ok\b[^{]*\{[^}]*var\(--accent\)/s);
    expect(withoutRootVar).not.toMatch(/\.banner\.recovery[^{]*\{[^}]*var\(--accent\)/s);
  });

  it('the Timer view ships a favorites rail wired to the favorite IPC (§05 R09)', () => {
    const html = read('index.html');
    const app = read('app.js');
    const css = read('styles.css');
    // The favorites rail + its Pin control live in the Timer view…
    expect(html).toMatch(/data-view="timer"/);
    expect(html).toMatch(/id="fav-rail"/);
    expect(html).toMatch(/id="fav-pin"/);
    expect(html).toMatch(/id="fav-empty"/);
    // …app.js renders the rail from the same listFavorites IPC tt's `fav ls` drives, and the
    // kebab opens Rename / Unpin over the rename/unpin mutators (no DB in the page)…
    expect(app).toMatch(/function renderFavorites\(\)/);
    expect(app).toMatch(/window\.stint\.listFavorites\(\)/);
    expect(app).toMatch(/window\.stint\.pinFavorite\(/);
    expect(app).toMatch(/window\.stint\.renameFavorite\(\{\s*ref/);
    expect(app).toMatch(/window\.stint\.unpinFavorite\(\{\s*ref/);
    // …Pin captures the running timer's template (fromEntryId) or the Start form's attributes…
    expect(app).toMatch(/fromEntryId:\s*'open'/);
    // …the rail repaints on route('timer') and over the change broadcast (§12 R14: a tt write
    // on the Timer view reloads the state — repainting the card + live-edit strip — AND repaints
    // the rail, so the in-window timer surface tracks the other surface)…
    expect(app).toMatch(/view === 'timer'\)\s*void renderFavorites/);
    expect(app).toMatch(/activeView === 'timer'\)\s*void load\(\)\.then\(\(\) => renderFavorites\(\)\)/);
    // …and the rail chrome is monochrome — the Pin/kebab/menu carry no accent (§15 discipline).
    expect(css).toMatch(/\.fav-pin\s*\{/);
    expect(css).toMatch(/\.fav-rail\s*\{/);
    const withoutRootVar = css.replace(/--accent:[^;]+;/g, '');
    expect(withoutRootVar).not.toMatch(/\.fav-(pin|kebab|card|menu)[^{]*\{[^}]*var\(--accent\)/s);
  });

  it('the Timer view ships a live-edit-running strip whose edit never carries endUtc (§12 R14)', () => {
    const html = read('index.html');
    const app = read('app.js');
    const css = read('styles.css');
    // The live-edit-running strip lives in the Timer view, with the no-stop pill + the
    // "End time not editable while running" note that make the no-close contract explicit…
    const timerView = html.match(
      /<section class="view" data-view="timer"[\s\S]*?<\/section>\s*\n\s*<!-- §12 R3: the Entries view/,
    )?.[0];
    expect(timerView, 'index.html must declare the Timer view section').toBeTruthy();
    expect(timerView!).toMatch(/id="live-edit"/);
    expect(timerView!).toMatch(/id="le-desc"/);
    expect(timerView!).toMatch(/id="le-start"/);
    expect(timerView!).toMatch(/id="le-bill"/);
    expect(timerView!).toMatch(/no stop/i);
    expect(timerView!).toMatch(/End time (is )?not editable while running/i);
    // …the strip carries NO End-time input (editing the open row must not close it)…
    const strip = timerView!.match(/<section class="liveedit"[\s\S]*?<\/section>/)?.[0];
    expect(strip, 'the live-edit strip must be present').toBeTruthy();
    expect(strip!).not.toMatch(/id="le-end"/);
    // …app.js builds the patch from only changed fields and never writes an endUtc onto it,
    // committing through window.stint.edit({ id, patch }) so the open row stays open…
    expect(app).toMatch(/function liveEditPatch\(strip\)/);
    expect(app).toMatch(/window\.stint\.edit\(\{\s*id,\s*patch\s*\}\)/);
    const patchBody = app.match(/function liveEditPatch\(strip\)\s*\{[\s\S]*?\n\}/)?.[0];
    expect(patchBody, 'liveEditPatch body must be present').toBeTruthy();
    expect(patchBody!).not.toMatch(/endUtc/);
    expect(patchBody!).toMatch(/patch\.startUtc/);
    expect(patchBody!).toMatch(/patch\.description/);
    expect(patchBody!).toMatch(/patch\.billable/);
    // …and the strip's chrome is monochrome — its controls carry no accent fill (§15: the
    // accent stays on the running clock/state + the single primary Stop; the strip's dashed
    // accent border is the sanctioned running-context use, not on any control).
    const leControls = css.match(/\.liveedit \.le-field input[\s\S]*?\}/)?.[0];
    expect(leControls, 'the live-edit inputs must be styled').toBeTruthy();
    expect(leControls!).not.toMatch(/var\(--accent\)/);
  });

  it('the renderer never imports Node or touches the DB directly (parity via IPC)', () => {
    for (const f of ['app.js', 'editor.js', 'timepicker.js', 'popover.js', 'util.js', 'reports.js', 'settings.js']) {
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
    for (const f of ['app.js', 'editor.js', 'timepicker.js', 'popover.js', 'util.js', 'reports.js', 'settings.js']) {
      const src = read(f);
      for (const re of forbidden) expect(src, `${f} must not use ${re}`).not.toMatch(re);
    }
  });

  it('the visual time-range picker is a pure renderer component (window.STP) wired on every R15 surface (§12 R15)', () => {
    const stp = read('timepicker.js');
    const app = read('app.js');
    const html = read('index.html');
    const css = read('styles.css');
    // timepicker.js exposes the window.STP module with STP.open + the pure geometry/snap
    // helpers (snapTo5 / minutesToY / yToMinutes) so the guard + JUDGE can drive the math
    // deterministically. It is a classic script (no ES module export, loads over file://).
    expect(stp).toMatch(/window\.STP\s*=/);
    expect(stp).toMatch(/function open\(/);
    for (const fn of ['snapTo5', 'minutesToY', 'yToMinutes']) {
      expect(stp, `timepicker.js must define the pure helper ${fn}`).toMatch(new RegExp(`function ${fn}\\b`));
    }
    expect(stp).toMatch(/snapTo5,\s*minutesToY,\s*yToMinutes/); // exported on window.STP
    // The picker NEVER resolves anything itself — it only writes localInputValue strings back
    // into the bound text inputs and fires input/change so the existing add/edit paths see it
    // (text stays authoritative). No new IPC channel: it never calls window.stint.*.
    expect(stp).toMatch(/function localInputValue\(/);
    expect(stp).toMatch(/dispatchEvent\(new Event\('input'/);
    expect(stp).not.toMatch(/window\.stint\./);
    // The me-rectangle is dragged: BODY drag moves start+stop together; the BOTTOM resize
    // grip moves only the stop. Both go through snapTo5 (the 5-min grid).
    expect(stp).toMatch(/stp-block me/);
    expect(stp).toMatch(/stp-resize/);
    expect(stp).toMatch(/pointerdown/);
    // Other entries render gray and overlaps render yellow (warn-only).
    expect(stp).toMatch(/stp-block other/);
    expect(stp).toMatch(/stp-overlap/);
    // index.html loads timepicker.js BEFORE app.js (the triggers depend on window.STP)…
    expect(html).toMatch(/src="timepicker\.js"[\s\S]*src="app\.js"/);
    // …and the running-edit Start field carries its own calendar trigger (#le-start-pick).
    expect(html).toMatch(/id="le-start-pick"[^>]*class="range-pick-btn"[\s\S]*?aria-controls="le-start"/);
    // app.js wires the picker on EVERY R15 surface: the add form (#add-from/#add-to), the
    // inline closed-entry edit form (.edit-pick over .edit-start/.edit-end), and the
    // running-entry start (#le-start-pick → start-only, endInput null so no stop is written).
    expect(app).toMatch(/window\.STP\.open\(/);
    expect(app).toMatch(/le-start-pick'\)/);
    expect(app).toMatch(/\.edit-pick/);
    // The running-start case opens start-only (endInput: null) so editing the open row can
    // never write a stop (§05 R6) — the picker only writes #le-start.
    expect(app).toMatch(/endInput:\s*null/);
    // The closed-entry inline form binds both inputs; the open row's editEndInput is null.
    expect(app).toMatch(/const editEndInput = running \? null : form\.querySelector\('\.edit-end'\)/);
    // Accent discipline (§15): only the picker's primary Apply button + the "me" rectangle
    // (and the selected calendar day) carry the accent; the rest of the chrome is monochrome.
    expect(css).toMatch(/\.stp-block\.me\s*\{[^}]*var\(--accent\)/s);
    expect(css).toMatch(/\.stp-apply\.primary\s*\{[^}]*var\(--accent\)/s);
    // The non-primary picker controls (Cancel / nav / day cells / track / others) never
    // fill with the accent — scan the rule bodies (ignoring the :root token definition).
    const withoutRootVar = css.replace(/--accent:[^;]+;/g, '');
    expect(withoutRootVar).not.toMatch(/\.stp-cancel[^{]*\{[^}]*var\(--accent\)/s);
    expect(withoutRootVar).not.toMatch(/\.stp-block\.other[^{]*\{[^}]*var\(--accent\)/s);
  });
});
