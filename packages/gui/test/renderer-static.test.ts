/**
 * Fast static guards for the renderer contract (PRD §12, §15). The full visual
 * judgement is the JUDGE harness (packages/gui/judge); these cheap checks catch a
 * regression in the empty-state copy or accent discipline on every commit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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

  it('the renderer announces toggle state for assistive tech (§12 R14)', () => {
    const html = read('index.html');
    const pop = read('popover.html');
    const app = read('app.js');
    const popJs = read('popover.js');
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
    expect(app).toMatch(/payload\.billable/);
  });

  it('the start surface is the Timer-view core-entry form, idle-only while a timer runs, with no Switch (§12 R5)', () => {
    const html = read('index.html');
    const app = read('app.js');
    // §12 R05 (core): the inline Start form exposes every attribute control (the
    // start-immediately surface) and is hosted in the Timer view — the GUI core-entry
    // surface relocated from the Entries toolbar (the form + disclosure + #toggle
    // primary live inside <section data-view="timer">, not the Entries section).
    const timerView = html.match(
      /<section class="view" data-view="timer"[\s\S]*?<\/section>\s*\n\s*<!-- §12 R3: the Entries view/,
    )?.[0];
    expect(timerView, 'index.html must declare the Timer view section').toBeTruthy();
    expect(timerView!).toMatch(/id="start-form"/);
    expect(timerView!).toMatch(/id="start-toggle"/);
    expect(timerView!).toMatch(/id="toggle"/);
    // §12 R05 / issue #34: Switch is removed entirely — the start surface carries NO #switch
    // button. There is no separate Switch affordance; core's start remains the atomic
    // stop-then-start for tt and programmatic callers (§05 R01).
    expect(timerView!).not.toMatch(/id="switch"/);
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
    // §12 R05 (issue #51): the start surface is IDLE-ONLY — while a timer runs the whole
    // start panel is hidden (renderTimerCard toggles it off the running state) and the open
    // disclosure collapses with it, so no start affordance survives while running.
    expect(app).toMatch(/startPanel\.hidden = !!running/);
    const cardBody = app.slice(
      app.indexOf('function renderTimerCard(running)'),
      app.indexOf('function renderLiveEdit(running)'),
    );
    expect(cardBody).toMatch(/startPanel\.hidden = !!running/);
    expect(cardBody).toMatch(/startForm\.hidden = true/);
    expect(cardBody).toMatch(/\$\('start-toggle'\)\.setAttribute\('aria-expanded', 'false'\)/);
    // The panel's flex display would silently defeat the [hidden] attribute — the explicit
    // display:none override must stay in styles.css (a real regression the JUDGE run caught).
    expect(read('styles.css')).toMatch(/\.start-panel\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
    // …app.js builds the payload (resolving client/project + splitting tags) and starts
    // immediately over the same start IPC tt uses, with the tri-state billable riding the
    // payload only when the user explicitly set it (§05 R07)…
    expect(app).toMatch(/window\.stint\.start\(\s*payload\s*\)/);
    expect(app).toMatch(/if \(startBillTouched\) payload\.billable = \$\('start-bill'\)\.checked/);
    expect(app).toMatch(/payload\.tags/);
    // …and NO #switch element / wiring survives anywhere in the page (issue #34): no Switch
    // button in the HTML and no $('switch') render/handler in app.js.
    expect(html).not.toMatch(/>Switch<\/button>/);
    expect(html).not.toMatch(/id="switch"/);
    expect(app).not.toMatch(/\$\('switch'\)/);
  });

  it('both start controls default billable per the client-keyed rule (§05 R07 / issue #51)', () => {
    const html = read('index.html');
    const app = read('app.js');
    // The Details form's Billable box carries NO static `checked` — a pre-checked box would
    // silently override core's client-keyed default on every attributed start.
    expect(html).toMatch(/id="start-bill"[^>]*type="checkbox"/);
    expect(html).not.toMatch(/id="start-bill"[^>]*checked/);
    // app.js mirrors the §05 R07 default onto the box live — checked iff the Client field is
    // non-empty — until the user explicitly touches it (their choice then wins)…
    expect(app).toMatch(/let startBillTouched = false/);
    expect(app).toMatch(
      /if \(!startBillTouched\) \$\('start-bill'\)\.checked = \$\('start-client'\)\.value\.trim\(\) !== ''/,
    );
    // …and submit forwards billable ONLY when touched, so an untouched box falls through to
    // core's client-keyed default (store.start: billable ?? clientId !== null) — the same
    // rule the one-tap #toggle start reaches by sending no payload at all.
    expect(app).toMatch(/if \(startBillTouched\) payload\.billable = \$\('start-bill'\)\.checked/);
    expect(app).not.toMatch(/payload = \{ billable:/);
    expect(app).toMatch(/const ack = await window\.stint\.toggle\(\)/);
    // The touched flag resets with the form so the next open defaults cleanly again.
    expect(app).toMatch(/startForm\.reset\(\);\s*\n\s*startBillTouched = false/);
  });

  it('the unified entry form (add mode) mounts the inline picker + expander and Saves over add IPC (§12 R07)', () => {
    const html = read('index.html');
    // §12 R07 (G5): the manual-add surface is the ONE unified entry form in ADD mode — a
    // two-column card (not a modal), the same shell edit mode uses.
    expect(html).toMatch(/id="add-form"[^>]*class="unified-form"/);
    expect(html).toMatch(/id="add-form"[^>]*data-mode="add"/);
    // LEFT column: a 3-line scrollable multiline description textarea (§05 R10), client + project
    // SELECTS (populated from the same source tt uses), a tag chip host, and the billable toggle.
    expect(html).toMatch(/<textarea id="add-desc"[^>]*class="desc-field"[^>]*rows="3"/);
    expect(html).toMatch(/<select id="add-client"/);
    expect(html).toMatch(/<select id="add-project"[^>]*disabled/);
    expect(html).toMatch(/id="add-tag-chips"/);
    expect(html).toMatch(/id="add-bill"[^>]*type="checkbox"/);
    // RIGHT column: the inline interval-picker MOUNT (§12 R15) over the COLLAPSED Start/Stop
    // expander (§12 R17) — a disclosure toggle over the raw exact-time text fields.
    expect(html).toMatch(/id="add-picker"/);
    expect(html).toMatch(/id="add-times-toggle"[^>]*aria-expanded="false"/);
    expect(html).toMatch(/id="add-times-body"[^>]*hidden/);
    for (const id of ['add-from', 'add-to']) {
      expect(html, `index.html must expose #${id}`).toMatch(new RegExp(`id="${id}"`));
    }
    // §12 (G1): NO native datetime-local anywhere on the add-time surface — the picker + the
    // raw text expander are the only entry-time inputs; the Start/Stop fields are plain text.
    expect(html).not.toMatch(/id="add-from"[^>]*type="datetime-local"/);
    expect(html).not.toMatch(/id="add-to"[^>]*type="datetime-local"/);
    expect(html).toMatch(/id="add-from"[^>]*type="text"/);
    expect(html).toMatch(/id="add-to"[^>]*type="text"/);
    // …and the retired standalone picker-modal triggers are gone from the add form (G1).
    expect(html).not.toMatch(/id="add-from-pick"/);
    expect(html).not.toMatch(/id="add-to-pick"/);

    const app = read('app.js');
    // Save entry is the SOLE commit: app.js sends a payload carrying fromLocal/toLocal (derived
    // from the picker/expander form state) over window.stint.add — catching a regression that
    // drops the from/to or never reaches core's add.
    expect(app).toMatch(/window\.stint\.add\(payload\)/);
    expect(app).toMatch(/fromLocal:\s*\$\('add-from'\)\.value/);
    expect(app).toMatch(/toLocal:\s*\$\('add-to'\)\.value/);
    // The client/project selects are populated from the same source tt uses.
    expect(app).toMatch(/window\.stint\.listClients\(\)/);
    expect(app).toMatch(/window\.stint\.listProjects\(/);
    // The inline picker (§12 R15's window.STP.openInline) is mounted into #add-picker, seeded from
    // and writing back the raw Start/Stop fields LIVE — the add form is the consumer, not the owner.
    expect(app).toMatch(/window\.STP\.openInline\(/);
    expect(app).toMatch(/\$\('add-picker'\)/);
    expect(app).toMatch(/startInput:\s*\$\('add-from'\)/);
    expect(app).toMatch(/endInput:\s*\$\('add-to'\)/);
    // The obsolete modal-picker wiring (openAddRangePicker + the pick-button listeners) is gone.
    expect(app).not.toMatch(/openAddRangePicker/);
    expect(app).not.toMatch(/add-from-pick'\)\.addEventListener/);
  });

  it('the popover hosts no dedicated Switch affordance — Stop/Start toggle + Open only (§12 R01)', () => {
    // Switch is removed as a distinct concept (issue #34): starting while running is the
    // atomic stop-then-start, so the compact popover offers only the toggle and Open Stint.
    const pop = read('popover.html');
    const popJs = read('popover.js');
    expect(pop).not.toMatch(/id="switch"/);
    expect(popJs).not.toMatch(/\$\('switch'\)/);
  });

  it('every entry is editable inline in-context and any field is editable (§06 R1, §05 R6)', () => {
    const app = read('app.js');
    // Every row (including the open one) exposes an inline Edit affordance…
    expect(app).toMatch(/data-act="edit"/);
    // …handled into the unified entry form in edit mode (openEntryForm), inline in the Entries
    // view (not a separate page / modal), that calls window.stint.edit with {id, patch}…
    expect(app).toMatch(/openEntryForm/);
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
    // stays open (the §05 R6 guarantee, mirrored in the renderer affordance). The time
    // patches are ALSO gated behind the seeded-text guard (§12 R15 / issue #49): a field
    // whose text is byte-identical to what the form seeded is untouched stored truth and
    // contributes nothing, so open-then-Save round-trips start/stop to the second.
    expect(app).toMatch(/if\s*\(!running\s*&&\s*endLocal\s*&&\s*endLocal !== seededEnd\)/);
    expect(app).toMatch(/if\s*\(startLocal\s*&&\s*startLocal !== seededStart\)/);
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
    // §06 R2 / G4 / G1: the split instant is a SIMPLE PLAIN-TEXT field (localInputValue format),
    // not a native datetime-local — the picker/expander are gone from every entry start/stop
    // surface. openSplitForm builds a type="text" .split-input and no datetime-local input.
    expect(app).toMatch(/<input type="text" class="split-input"/);
    expect(app).not.toMatch(/class="split-input"[^>]*type="datetime-local"/);
    expect(app).not.toMatch(/type="datetime-local" class="split-input"/);
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

    // (b) The Entries control bar (the search / filter selections) is present in the
    // page: the search box and the client/billable filters. There is no group-by toggle
    // here — grouping moved to Reports (issue #43).
    expect(html).toMatch(/id="search"/);
    expect(html).toMatch(/id="el-client"/);
    expect(html).toMatch(/id="el-billable-seg"/);

    // (c) The live view is DERIVED FROM THE SNAPSHOT — the pure deriveView (util.js mirror of
    // src/liveview.ts) recomputes the list + the report totals with no IPC reload. The filter
    // handlers repaint the report total off the snapshot, never re-fetching getState.
    expect(util).toMatch(/function deriveView\(state, sel\)/);
    expect(app).toMatch(/deriveView/);
    // The report total tracks the selection: while a toolbar query is in flight render()
    // paints the snapshot-derived report sum (deriveView) and updateLiveTotal repaints
    // #week-total off the snapshot synchronously on each control change — neither path
    // calls getState. Once the queried set is in hand (entryGroups), render() paints its
    // billable-only sum — the SELECTED RANGE's total (issue #55 Part B); idle, it paints
    // the week-bounded weekTotal.
    expect(app).toMatch(/function updateLiveTotal\(\)/);
    expect(app).toMatch(/deriveView\(state,\s*liveSelection\(\)\)\.reportTotalSeconds/);
    expect(app).toMatch(
      /\$\('week-total'\)\.textContent\s*=\s*fmtHours\(\s*\n?\s*entryCtrlActive\s*\n?\s*\?\s*entryGroups\s*\n?\s*\?\s*entryGroupsTotal\(\)\s*\n?\s*:\s*deriveView\(state,\s*liveSelection\(\)\)\.reportTotalSeconds\s*\n?\s*:\s*weekTotal\(\)/,
    );
    // updateLiveTotal derives from the snapshot only — it must NOT reach for getState.
    const liveBody = app.slice(app.indexOf('function updateLiveTotal()'), app.indexOf('async function applyEntryQuery'));
    expect(liveBody).toMatch(/deriveView\(state,/);
    expect(liveBody).not.toMatch(/getState/);
  });

  it('the Entries toolbar query always carries the required by grouping and never fails silently (§12 R9 / issue #55)', () => {
    const app = read('app.js');
    // applyEntryQuery seeds the listEntries payload with the REQUIRED grouping key
    // (ListEntriesQuery.by) — the Entries calendar's 'day' layout. Without it every
    // toolbar query used to throw in core and the calendar silently showed everything.
    const queryBody = app.slice(
      app.indexOf('async function applyEntryQuery'),
      app.indexOf('function activateEntryQuery'),
    );
    expect(queryBody).toMatch(/const q = \{ by: 'day', billable: entryQuery\.billable \}/);
    // The awaited query is guarded — a rejected listEntries logs and paints the explicit
    // no-match empty state (entryGroups = []) instead of silently leaving stale rows.
    expect(queryBody).toMatch(/try \{\s*\n\s*view = await window\.stint\.listEntries\(q\);\s*\n\s*\} catch/);
    expect(queryBody).toMatch(/catch \(err\) \{[\s\S]*?console\.error[\s\S]*?entryGroups = \[\];[\s\S]*?render\(\);/);
    // …and the ONLY listEntries call site in app.js sits inside that guarded body, so no
    // other path can regress to an unguarded / by-less query.
    expect([...app.matchAll(/window\.stint\.listEntries\(/g)].length).toBe(1);
    // Part B: the idle "This week" chip is WEEK-BOUNDED (calWeekBounds over the weekStart
    // setting, today's local day) — never the whole in-memory window's billable sum.
    const weekBody = app.slice(app.indexOf('function weekTotal()'), app.indexOf('function escapeHtml'));
    expect(weekBody).toMatch(/calWeekBounds\(localTodayDay\(\)\)/);
    expect(weekBody).toMatch(/d\.day >= ws && d\.day <= we/);
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
    // …and disagreeing selections raise the app.js-hosted conflict prompt (openMergeConflict): the
    // `.editor.conflict-prompt` modal resolving client/project + billable field-by-field,
    // sending the winning entry's id (winnerId) + the chosen billable, never resolving names
    // in the renderer.
    expect(app).toMatch(/function openMergeConflict\(/);
    expect(app).toMatch(/conflict-prompt/);
    expect(app).toMatch(/winnerId/);
  });

  it('a write that creates an overlap raises an at-write-time inline banner (§06 R4)', () => {
    const html = read('index.html');
    const app = read('app.js');
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
  });

  it('an overlapped row shows the detailed overlap banner and a slept-trimmed row strikes the raw duration (§12 R9)', () => {
    const app = read('app.js');
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
  });

  it('tags show as chips in-context and are edited in the unified form over the edit IPC (§07, §12 R06)', () => {
    const app = read('app.js');
    // Every event's tags render as monochrome chips, off an entry tags accessor…
    expect(app).toMatch(/function tagsHtml\(e\)/);
    expect(app).toMatch(/e\.tags/);
    expect(app).toMatch(/class="chip"/);
    // …shown on the entry event and on the running summary line…
    expect(app).toMatch(/tagsHtml\(e\)/);
    expect(app).toMatch(/tagsHtml\(running\)/);
    // …with NO per-row Edit-tags control (DELETED) — tags are edited inside the unified form…
    expect(app).not.toMatch(/data-act="tags"/);
    expect(app).not.toMatch(/openTagEditor/);
    // …whose in-form chip editor (removable chips + an "add a tag…" input) diffs the edited chip
    // set against the entry's original tags via the pure window.SU.tagDiff and folds the minimal
    // { addTags, removeTags } into the ONE Save patch over the same edit IPC tt uses…
    expect(app).toMatch(/ef-tag-chips/);
    expect(app).toMatch(/ef-tag-add/);
    expect(app).toMatch(/tagDiff\(originalTags,\s*nextTags\)/);
    expect(app).toMatch(/if \(addTags\.length\) patch\.addTags = addTags;/);
    expect(app).toMatch(/if \(removeTags\.length\) patch\.removeTags = removeTags;/);
    // The chip text is always escaped (tags are user-controlled)…
    expect(app).toMatch(/escapeHtml\(t\)/);
  });

  it('the FULL Active-Timer card lives in the Timer view and Entries keeps a compact strip (§12 R04)', () => {
    const html = read('index.html');
    const app = read('app.js');
    // The card region and its parts are present in the page: a live clock, a running/idle
    // state indicator, the description + client/project context, and the attribute flags…
    expect(html).toMatch(/id="timer-card"/);
    expect(html).toMatch(/id="timer-clock"/);
    expect(html).toMatch(/id="timer-state"/);
    expect(html).toMatch(/id="timer-desc"/);
    expect(html).toMatch(/id="timer-meta"/);
    expect(html).toMatch(/id="timer-flags"/);
    // …with the primary Stop control (it carries the accent). §12 R04 / issue #34: Switch is
    // removed — the running card's primary actions are Stop (+ favorite pin), no Switch button.
    expect(html).toMatch(/id="timer-stop"[^>]*class="primary"|class="primary"[^>]*id="timer-stop"/);
    expect(html).not.toMatch(/id="timer-switch"/);

    // §12 R04 PLACEMENT: the full #timer-card is hosted in the Timer view section, NOT in the
    // Entries section. Slice each top-level view section and assert where the card lives.
    const timerView = html.match(
      /<section class="view" data-view="timer"[\s\S]*?<\/section>\s*\n\s*<!-- §12 R3: the Entries view/,
    )?.[0];
    expect(timerView, 'index.html must declare the Timer view section').toBeTruthy();
    expect(timerView!).toMatch(/id="timer-card"/);
    expect(timerView!).toMatch(/id="timer-stop"/);
    expect(timerView!).not.toMatch(/id="timer-switch"/);
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
    // …the Stop reuses the existing toggle write (no new channel). §12 R04 / issue #34: Switch
    // is removed — there is NO $('timer-switch') render or handler in app.js anywhere.
    expect(app).toMatch(/\$\('timer-stop'\)\.addEventListener[\s\S]*?window\.stint\.toggle\(/);
    expect(app).not.toMatch(/\$\('timer-switch'\)/);
    // …and the per-second count-up advances BOTH the card clock and the strip clock on the tick
    // path (independent of data changes), derived from elapsed(now − start), never stored.
    expect(app).toMatch(/function tick\(\)/);
    expect(app).toMatch(/\$\('timer-clock'\)/);
    expect(app).toMatch(/\$\('strip-clock'\)/);
    expect(app).toMatch(/clock\.textContent\s*=\s*fmtDur\(elapsed\(/);
    expect(app).toMatch(/stripClock\.textContent\s*=\s*fmtDur\(elapsed\(/);
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
    expect(html).toMatch(/id="add-client-btn"/);
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

  it('every element id in index.html is unique — a duplicate dead-ends getElementById wiring (issue #48)', () => {
    // The literal issue-48 root cause: the Clients-view "+ Add client" button and the
    // Add-entry form's Client <select> both carried id="add-client", so $('add-client')
    // (getElementById → FIRST match in document order) bound the click handler to the
    // select — the button was a no-op AND opening the dropdown injected a phantom
    // .client-add row. Guard the invariant wholesale: no id may appear twice in the page.
    const html = read('index.html');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    expect(dupes, `duplicate element ids in index.html: ${dupes.join(', ')}`).toEqual([]);
    // …and the issue-48 pair specifically: the button and the select keep DISTINCT ids,
    // each resolving to its own wiring in app.js — the button to the Clients-view inline
    // add-client click handler, the select to the form's client→project cascade.
    expect(html).toMatch(/<button id="add-client-btn"/);
    expect(html).toMatch(/<select id="add-client"/);
    const app = read('app.js');
    expect(app).toMatch(/\$\('add-client-btn'\)\.addEventListener\('click'/);
    expect(app).toMatch(/\$\('add-client'\)\.addEventListener\('change'/);
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
    // …the kebab swaps into an INLINE Rename / Delete menu, the rename goes through the
    // shared inline name field (app.js's inlineRenameForm — Electron's renderer does not
    // implement window.prompt, issue #52)…
    expect(js).toMatch(/data-act="def-rename"/);
    expect(js).toMatch(/data-act="def-delete"/);
    expect(js).toMatch(/window\.inlineRenameForm\(/);
    // …and the destructive delete is confirmed in-window through app.js's generic confirm
    // gate (§12 R13) — never window.confirm, which the renderer cannot raise (issue #52):
    // removeReport is reachable ONLY from inside deleteDef, which only confirm callbacks run.
    expect(js).toMatch(/window\.confirmInline\(/);
    expect(js).toMatch(/kind:\s*'report-delete'/);
    const removeSites = [...js.matchAll(/window\.stint\.removeReport\(/g)];
    expect(removeSites.length).toBe(1);
    const deleteDefBody = js.slice(js.indexOf('async function deleteDef(name)'));
    expect(deleteDefBody).toMatch(/^\s*async function deleteDef\(name\)\s*\{\s*\n\s*await window\.stint\.removeReport\(\{\s*name\s*\}\)/);
  });

  it('the only accent affordance in the Reports view is the single + New report primary action (§15 / G10)', () => {
    const html = read('index.html');
    // The New report action is the view's single primary action — a line-icon (i-plus) + label,
    // no leading "+" glyph (the icon carries the add affordance, §design-system line icons only)…
    expect(html).toMatch(/id="rep-new" class="primary"/);
    expect(html).toMatch(/id="rep-new"[^>]*>[\s\S]*?<use href="#i-plus"[\s\S]*?New report/);
    expect(html).not.toMatch(/\+ New report/);
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
    // …the range-spec is a relative preset OR an absolute custom range (kind preset/absolute)…
    expect(js).toMatch(/kind:\s*'preset'/);
    expect(js).toMatch(/kind:\s*'absolute'/);
    // §09 R01 (G3): the custom range is a pair of PLAIN DATES — the two builder range
    // inputs are type="date" (no time component; never datetime-local)…
    expect(html).toMatch(/id="rep-range-from"[^>]*type="date"/);
    expect(html).toMatch(/id="rep-range-to"[^>]*type="date"/);
    // …the absolute arm carries the raw field strings as fromDate/toDate (never a UTC
    // instant), and reports.js constructs no Date and derives no window — the plain-date →
    // window rule lives once in gui/src (resolveDateRange), main-process side.
    expect(js).toMatch(/fromDate:\s*draft\.fromDate/);
    expect(js).toMatch(/toDate:\s*draft\.toDate/);
    expect(js).not.toMatch(/new Date\(/);
    expect(js).not.toMatch(/toISOString/);
    // …rounding rides the saved DEFINITION (no setSetting from the builder — it is per-def)…
    expect(js).not.toMatch(/setSetting/);
    // …and the renderer re-derives no preset date math (core owns resolveRange).
    expect(js).not.toMatch(/setHours\(0, 0, 0, 0\)/);
    expect(js).not.toMatch(/thisWeekRange/);
  });

  it('the custom range is a pair of plain date fields on BOTH range surfaces, applied live in Entries (§09 R01 / G3)', () => {
    const html = read('index.html');
    const app = read('app.js');
    const js = read('reports.js');
    // The four RANGE inputs — the Reports builder pair and the Entries toolbar pair — are
    // plain type="date" fields (no time component); no range input is a datetime-local.
    for (const id of ['rep-range-from', 'rep-range-to', 'el-range-from', 'el-range-to']) {
      expect(html, `#${id} must be a plain date input`).toMatch(
        new RegExp(`id="${id}"[^>]*type="date"`),
      );
      expect(html, `#${id} must not be a datetime-local`).not.toMatch(
        new RegExp(`id="${id}"[^>]*type="datetime-local"`),
      );
    }
    // The Entries toolbar has NO Apply button — the two date fields apply LIVE once both
    // are populated (matching the main.html mockup toolbar), driving activateEntryQuery.
    expect(html).not.toMatch(/id="el-range-apply"/);
    expect(app).not.toMatch(/el-range-apply/);
    expect(app).toMatch(/entryQuery\.fromDate/);
    expect(app).toMatch(/entryQuery\.toDate/);
    expect(app).toMatch(/if \(entryQuery\.fromDate && entryQuery\.toDate\) activateEntryQuery\(\)/);
    // The listEntries query carries the RAW date strings (fromDate/toDate, never a derived
    // fromUtc/toUtc instant) — main resolves the pair via gui/src resolveDateRange.
    expect(app).toMatch(/q\.fromDate = entryQuery\.fromDate/);
    expect(app).toMatch(/q\.toDate = entryQuery\.toDate/);
    expect(app).not.toMatch(/fromUtc/);
    expect(app).not.toMatch(/toUtc/);
    // Neither range surface converts a field value through the Date constructor — the two
    // raw strings travel verbatim over IPC (reports.js is fully Date-free; app.js keeps
    // Date only off the range path, so the range fields' handlers stay string-only).
    expect(js).not.toMatch(/new Date\(/);
    expect(app).not.toMatch(/new Date\(\$\('el-range/);
  });

  it('the Reports run-output paints grouped totals with flags in context + Export CSV/JSON from the saved report (§09 R09 / R06)', () => {
    const html = read('index.html');
    const js = read('reports.js');
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
  });

  it('the consolidated modal editor (editor.js / window.SE) is retired; the richer-fields path opens the unified editor (§12 R06 / §Z)', () => {
    const app = read('app.js');
    const html = read('index.html');
    // editor.js (window.SE) is DELETED: the file is gone, index.html no longer loads it, and
    // app.js references no window.SE surface anywhere (openEditor / mergeSelected / closeEditor).
    expect(() => read('editor.js')).toThrow();
    expect(html).not.toMatch(/editor\.js/);
    expect(app).not.toMatch(/window\.SE\b/);
    expect(app).not.toMatch(/SE\.openEditor/);
    expect(app).not.toMatch(/SE\.mergeSelected/);
    // Editing an entry goes through the inline unified entry form (openEntryForm) — never a modal
    // opened via a per-row kebab (⋯), which is also gone…
    expect(app).not.toMatch(/data-act="menu"/);
    expect(app).toMatch(/openEntryForm/);
    expect(app).toMatch(/window\.stint\.edit\(\{\s*id:\s*e\.id,\s*patch\s*\}\)/);
    // …and the running strip's richer fields (Tags / Client-project) route into that SAME unified
    // editor: the handler switches to the Entries view and opens the unified form in edit mode
    // seeded with the running entry (no separate modal, no window.SE).
    expect(app).toMatch(/const leTags = \$\('le-tags'\)/);
    expect(app).toMatch(/const leProject = \$\('le-project'\)/);
    const runEditorBody = app.match(/const openRunningEditor = \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
    expect(runEditorBody, 'the openRunningEditor handler must be present').toBeTruthy();
    expect(runEditorBody!).toMatch(/route\('entries'\)/);
    expect(runEditorBody!).toMatch(/openEntryForm\(row, e\)/);
    // …the retired toolbar Merge-selected button (which called window.SE.mergeSelected) is gone
    // from both the page and app.js; the ONLY merge entry point is the corner-checkbox → merge-bar
    // → openMergeConflict path (§06 R3)…
    expect(html).not.toMatch(/id="merge-selected"/);
    expect(app).not.toMatch(/merge-selected/);
    // …and the merge-conflict resolver lives in app.js (§06 R3) on the
    // shared `.editor.conflict-prompt` chrome (the resolver itself is exercised by the §06 R3 test).
    expect(app).toMatch(/function openMergeConflict\(/);
    expect(app).toMatch(/conflict-prompt/);
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
  });

  it('the Settings view ships a Software Update → download + guided install over the update bridge (§19 R04)', () => {
    const settings = read('settings.js');
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
  });

  it('the Settings view ships a Backups group (restore list + retention + recovery banner) over the backup IPC (§20 R04/R05)', () => {
    const html = read('index.html');
    const settings = read('settings.js');
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
  });

  it('the Timer view ships a favorites rail wired to the favorite IPC (§05 R09)', () => {
    const html = read('index.html');
    const app = read('app.js');
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
  });

  it('the Timer view ships a live-edit-running strip whose edit never carries endUtc (§12 R14)', () => {
    const html = read('index.html');
    const app = read('app.js');
    // The live-edit-running strip lives in the Timer view…
    const timerView = html.match(
      /<section class="view" data-view="timer"[\s\S]*?<\/section>\s*\n\s*<!-- §12 R3: the Entries view/,
    )?.[0];
    expect(timerView, 'index.html must declare the Timer view section').toBeTruthy();
    expect(timerView!).toMatch(/id="live-edit"/);
    expect(timerView!).toMatch(/id="le-desc"/);
    expect(timerView!).toMatch(/id="le-start"/);
    expect(timerView!).toMatch(/id="le-bill"/);
    // …the Start field is a RAW text field in localInputValue format (§12 R14 / G1 — the
    // native datetime-local popover is gone from this entry-time surface)…
    expect(timerView!).toMatch(/id="le-start"[^>]*type="text"/);
    expect(timerView!).not.toMatch(/id="le-start"[^>]*type="datetime-local"/);
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
    // …and the raw text field's value goes through a validity guard before it can patch
    // (a half-typed instant contributes nothing — never a NaN toISOString crash).
    expect(patchBody!).toMatch(/isNaN\(parsed\.getTime\(\)\)/);
  });

  it('the renderer never imports Node or touches the DB directly (parity via IPC)', () => {
    for (const f of ['app.js', 'timepicker.js', 'popover.js', 'util.js', 'reports.js', 'settings.js']) {
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
    for (const f of ['app.js', 'timepicker.js', 'popover.js', 'util.js', 'reports.js', 'settings.js']) {
      const src = read(f);
      for (const re of forbidden) expect(src, `${f} must not use ${re}`).not.toMatch(re);
    }
  });

  it('the renderer never calls window.prompt or window.confirm — Electron implements neither (issue #52)', () => {
    // Electron's renderer does not implement window.prompt — it returns null and logs
    // "prompt() is and will not be supported." — and window.confirm is unavailable/blocking
    // here (the constraint app.js's confirmInline note records), so either call silently
    // no-ops in the packaged app. Every name/confirm affordance must be an INLINE control
    // (inlineRenameForm, confirmInline, the add-client/tag fields). This promotes that note
    // into an enforced guard: walk EVERY file under renderer/ so no call site — present or
    // future — can reintroduce the pattern.
    const dir = fileURLToPath(new URL('../renderer/', import.meta.url));
    const files = readdirSync(dir).filter((f) => /\.(js|html)$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = read(f);
      expect(src, `${f} must not call window.prompt`).not.toMatch(/window\s*\.\s*prompt\s*\(/);
      expect(src, `${f} must not call window.confirm`).not.toMatch(/window\s*\.\s*confirm\s*\(/);
      // The bare globals reach the same unsupported built-ins (confirmInline etc. don't match:
      // the pattern requires the exact name immediately followed by an open paren).
      expect(src, `${f} must not call the bare prompt()`).not.toMatch(/(?<![.\w$])prompt\(/);
      expect(src, `${f} must not call the bare confirm()`).not.toMatch(/(?<![.\w$])confirm\(/);
    }
  });

  it('the interval picker is a pure INLINE renderer component (window.STP) wired on every R15 surface (§12 R15)', () => {
    const stp = read('timepicker.js');
    const app = read('app.js');
    const html = read('index.html');
    // timepicker.js exposes the window.STP module with the two INLINE mount forms (openInline +
    // openStartOnly) and the pure geometry/snap helpers (snapTo5 / minutesToY / yToMinutes) so the
    // guard + JUDGE can drive the math deterministically. There is NO modal open() — the picker only
    // ever renders IN FLOW. It is a classic script (no ES module export, loads over file://).
    expect(stp).toMatch(/window\.STP\s*=/);
    expect(stp).toMatch(/function openInline\(/);
    expect(stp).toMatch(/function openStartOnly\(/);
    // The retired modal open() + its backdrop/Apply chrome are gone from timepicker.js.
    expect(stp).not.toMatch(/function open\(/);
    expect(stp).not.toMatch(/stp-backdrop/);
    expect(stp).not.toMatch(/stp-apply/);
    for (const fn of ['snapTo5', 'minutesToY', 'yToMinutes']) {
      expect(stp, `timepicker.js must define the pure helper ${fn}`).toMatch(new RegExp(`function ${fn}\\b`));
    }
    expect(stp).toMatch(/snapTo5,\s*minutesToY,\s*yToMinutes/); // exported on window.STP
    // The picker NEVER resolves anything itself — it only writes localInputValue strings back
    // into the bound text inputs and fires input/change so the existing add/edit paths see it
    // (text stays authoritative). It uses the ONE shared window.SU.localInputValue (util.js) —
    // no duplicate definition of its own. No new IPC channel: it never calls window.stint.*.
    expect(stp).toMatch(/window\.SU\.localInputValue/);
    expect(stp).not.toMatch(/function localInputValue\(/);
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
    // index.html loads timepicker.js BEFORE app.js (the mounts depend on window.STP)…
    expect(html).toMatch(/src="timepicker\.js"[\s\S]*src="app\.js"/);
    // …and the running-edit Start field's calendar affordance is a DISCLOSURE toggle
    // (aria-expanded) over the IN-FLOW start-only host below the field — no modal (§05 R06):
    expect(html).toMatch(
      /id="le-start-pick"[^>]*class="range-pick-btn"[\s\S]*?aria-expanded="false"[\s\S]*?aria-controls="le-start-disc"/,
    );
    expect(html).toMatch(/id="le-start-disc"/);
    // §12 R15: app.js mounts the picker IN FLOW on every R15 surface through ONE shared helper
    // (mountIntervalPicker): the add form (#add-picker over #add-from/#add-to), the inline edit
    // form (.edit-picker over .edit-start/.edit-end), and the running-entry start (#le-start-pick →
    // the inline START-ONLY disclosure). There is NO modal picker: app.js never calls window.STP.open
    // and has no .edit-pick trigger (the retired modal chrome).
    expect(app).toMatch(/function mountIntervalPicker\(/);
    expect(app).toMatch(/window\.STP\.openInline\(/);
    expect(app).toMatch(/host:\s*form\.querySelector\('\.edit-picker'\)/);
    expect(app).toMatch(/le-start-pick'\)/);
    expect(app).not.toMatch(/window\.STP\.open\(/);
    expect(app).not.toMatch(/edit-pick['"]/);
    // §05 R06 — the running surface opens STP.openStartOnly (host + startInput ONLY): the
    // variant takes no end binding at all, so its write path is structurally incapable of
    // producing an end value. The disclosure wiring block never mentions an end input or endUtc.
    expect(stp).toMatch(/function openStartOnly\(/);
    expect(app).toMatch(/window\.STP\.openStartOnly\(/);
    const discBlock = app.match(/function closeLeStartDisc[\s\S]*?leStartPick\.setAttribute\('aria-expanded', 'true'\);[\s\S]*?\n\}/)?.[0];
    expect(discBlock, 'the start-only disclosure wiring must be present').toBeTruthy();
    expect(discBlock!).not.toMatch(/endInput/);
    expect(discBlock!).not.toMatch(/endUtc/);
    expect(discBlock!).not.toMatch(/STP\.open\(/); // the modal never opens on the running surface
    // The start-only variant renders the RUNNING block: future-fade class + start grip only —
    // no bottom resize grip, no end label, no end echo (timepicker.js builds them only when an
    // end binding exists; the fade mask lives on .stp-block.me.open).
    expect(stp).toMatch(/stp-block me open/);
    expect(stp).toMatch(/stp-grip/);
    const css = read('styles.css');
    expect(css).toMatch(/\.stp-block\.me\.open\s*\{[\s\S]*?mask-image:\s*linear-gradient/);
    expect(css).toMatch(/\.stp-grip\s*\{/);
    // The inline disclosure is IN FLOW: .stp-inline is position: static (no backdrop, no
    // fixed/absolute chrome) with a scrollable day viewport (G16 — scroll, never clip).
    expect(css).toMatch(/\.stp-inline\s*\{\s*\n?\s*position:\s*static/);
    expect(css).toMatch(/\.stp-inline\s+\.stp-dayview\s*\{[\s\S]*?overflow-y:\s*auto/);
    // The modal backdrop / Apply chrome is gone from the stylesheet entirely.
    expect(css).not.toMatch(/\.stp-backdrop/);
    expect(css).not.toMatch(/\.stp-apply/);
    // The inline edit mount binds the START-ONLY variant for the open row (endInput null → no stop
    // is ever written) and both inputs for a closed entry — the shared helper switches on the
    // presence of an end field.
    expect(app).toMatch(/endInput:\s*running \? null : form\.querySelector\('\.edit-end'\)/);
  });

  it('load() refreshes shared state and repaints regardless of the entries-query branch (§12 R04, issue #50)', () => {
    const app = read('app.js');
    // Isolate the load() body (its closing brace is the first one back at column 0).
    const load = app.match(/async function load\(\) \{[\s\S]*?\n\}/)?.[0];
    expect(load, 'app.js must define load()').toBeTruthy();
    // The shared UiState refresh is unconditional — every (re)load fetches a fresh snapshot
    // before any branching, so the Timer card / compact strip / summary always paint current
    // running/idle truth (the card mirrors `tt status`, §12 R04).
    expect(load!).toMatch(/state =[\s\S]*?window\.stint\.getState\(\)/);
    // The entries-query branch must NEVER early-return before the repaint — the exact #50
    // freeze: once a toolbar control latched entryCtrlActive, load() returned into the
    // entries-only query and render() was starved, so Start/Stop clicks mutated the DB while
    // the Active-Timer card stayed painted with stale idle data. No return statement exists
    // anywhere in the body.
    expect(load!).not.toMatch(/^\s*return\b/m);
    // The toolbar re-query cannot take the shared repaint down with it: a failure degrades to
    // the last-painted calendar groups while the fresh state still reaches render().
    expect(load!).toMatch(/try \{\s*\n\s*await refreshEntryGroups\(\);/);
    // And the active view repaints unconditionally — render() is the body's final statement.
    expect(load!.trimEnd()).toMatch(/render\(\);\s*\n\}$/);
  });
});
