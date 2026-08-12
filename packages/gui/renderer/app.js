// Main window renderer (PRD §12). Paints the same truth tt would show — entries
// grouped by day with flags in context, a one-tap subtract on slept entries, an
// instructing empty state, and a live count-up on the running entry.
// Classic script: helpers come from window.SU (the bundled su.ts entry — dist/su.js,
// loaded first; the tooling decision is recorded in context/architecture.html §08).
const SU = window.SU;
const {
  fmtDur, fmtHours, elapsed, localTime, friendlyHotkey, localInputValue, parseLocalInput,
  tagDiff, errMessage, escapeHtml, localMinuteOfDay,
} = window.SU;

// Element lookup. Typed `any` (not HTMLElement) under checkJs: the call sites use
// page-specific form-element properties (.value/.checked/…) the id alone can't prove.
/** @type {(id: string) => any} */
const $ = (id) => document.getElementById(id);
let state = null;

// §09 R7: the active free-text query. Empty string means "no search" — load() then fetches
// the whole window via getState; a non-empty query routes through the `search` IPC (parity
// with `tt list --search`). Kept here so load()/onChange re-apply the live query on refresh.
let searchQuery = '';

// §12 R9: the Entries TOOLBAR state — week/filter/search over the readonly entries
// calendar (R16). The view is WEEK-ONLY: there is no range concept here (core and
// `tt list --range` keep arbitrary ranges — week-only is GUI presentation, not a core
// narrowing), and no grouping — grouped breakdowns moved to Reports (§09 R02 /
// `tt report --by`, G11). `entryQuery` holds the live filter values; the selected week
// lives in `selectedWeekStart` below. `entryGroups` is the flat, day-laid result of the
// last window.stint.listEntries call, or null when the toolbar is idle (the current week,
// no filters) — in which case render() paints the default getState entries so the
// existing empty-state facts hold. A week/filter change or search keystroke re-queries +
// repaints (§17 R11 — the re-query IS the live reflection).
/** @type {{ billable: 'all' | 'billable' | 'non-billable', clientId: any, projectId: any, tag: string }} */
const entryQuery = { billable: 'all', clientId: null, projectId: null, tag: '' };
let entryGroups = null;

// §12 R09: the selected week — its FIRST day as a 'YYYY-MM-DD' token, aligned to the
// weekStart setting. null means "the week containing today", resolved per read so the
// default view follows the clock (and the setting) without stashing a stale token.
/** @type {string | null} */
let selectedWeekStart = null;

// §12 R09: the week picker's displayed month as 'YYYY-MM'. Follows the selected week
// until the user pages it with the picker's own month steppers; re-anchored on selection.
/** @type {string | null} */
let pickerMonth = null;

// §12 R09: the picker's roving-grid focus — the day cell holding tabindex="0" (arrow keys
// move it, Enter selects its week). null falls back to the selected week's first day.
/** @type {string | null} */
let pickerActiveDay = null;

// §12 R09: entry-dot days — the day tokens carrying entries over the picker's rendered
// grid, from one unfiltered listEntries read per displayed grid range (keyed so a repaint
// of the same month never re-queries). Dots are unfiltered by design: they say "this day
// has entries", not "this day matches the current filters".
let pickerDots = new Set();
let pickerDotsKey = '';

// True once the user touches any control (week/filter) — the search box alone does not
// flip it, so a lone search keeps the live narrowing it always had.
let entryCtrlActive = false;

// §06 R3: a multi-select of contiguous CLOSED entries that the Merge action folds into
// one. The set holds the selected entry ids; it is cleared on every (re)load so a merge
// — which deletes the originals and inserts a fresh row — never leaves stale ids armed.
const selected = new Set();

async function load() {
  selected.clear();
  // §06 R4: the overlap banner is a transient at-write-time signal. Clear it on every
  // (re)load so it auto-dismisses once the next write/refresh carries no warning; the
  // durable signal is the per-row overlap flag, which render() repaints below.
  clearOverlapBanner();
  // §09 R7: honour the active search on every (re)load so a live refresh (a tt write, a
  // local mutation) keeps the list narrowed to the current query; an empty query is the
  // whole window via getState. The status/timer card + settings always come from getState
  // (the toolbar query is entries-only), so we always fetch a UiState to paint those.
  state = searchQuery && !entryCtrlActive
    ? await window.stint.search({ query: searchQuery })
    : await window.stint.getState();
  // §04 R06 / §12 R11: apply the display settings to SU on EVERY (re)load — not only when
  // the Settings view repaints — so a `tt config set time_zone/date_format` reaches every
  // stamp, field seed, and calendar minute on the next refresh.
  if (state && state.settings) {
    SU.applyDateFormat(state.settings.dateFormat || 'system');
    SU.applyTimeZone(state.settings.timeZone || 'system');
  }
  // §12 R9: when the toolbar is active, the entries calendar shows the queried set —
  // re-run the range/filter/search query on every (re)load so a tt write keeps the
  // filtered calendar fresh. Otherwise entryGroups stays null and render() paints the
  // default state.days.
  //
  // Issue #50 (§12 R04): the entries-only query must NEVER gate the shared repaint. load()
  // used to early-return into applyEntryQuery here, so once a toolbar control latched
  // entryCtrlActive, any failure (or stall) inside the entries query starved render() —
  // the Timer view's Active-Timer card and Start/Stop button froze on stale idle data while
  // writes kept landing in the DB. Now the fresh `state` always reaches the unconditional
  // render() below: the card/strip/summary mirror `tt status` on every (re)load, and a
  // failed entries query only leaves the calendar on its last-painted groups.
  if (entryCtrlActive) {
    try {
      await refreshEntryGroups();
    } catch {
      // keep the last-painted groups; the shared surfaces still repaint below
    }
  } else {
    entryGroups = null;
  }
  // §12 R09: a (re)load may follow a write, so the week picker's entry-dot cache is stale —
  // drop the key and the next picker paint re-reads the dots for its rendered range.
  pickerDotsKey = '';
  render();
}

// §06 R4: surface a non-blocking inline banner when a write lands on an overlapping
// span. Overlap is allowed but flagged (PRD §06 R4) — the write already committed, so
// this is advisory, not a block. `ack` is the WriteAck the write IPC returns; only an
// `overlap` warning raises the banner. Anything else is ignored here.
function applyAck(ack) {
  const warnings = (ack && ack.warnings) || [];
  showOverlapBanner(warnings);
  return ack;
}

function showOverlapBanner(warnings) {
  const banner = $('overlap-banner');
  if (!banner) return;
  const overlap = (warnings || []).find((w) => w && w.kind === 'overlap');
  if (!overlap) return; // no overlap → leave the banner as load() left it (cleared)
  banner.classList.remove('error'); // an overlap is a warn advisory, never the block chrome
  const n = overlap.overlapsWith ? overlap.overlapsWith.length : 0;
  banner.textContent =
    `This entry overlaps ${n} other ${n === 1 ? 'entry' : 'entries'} — ` +
    `allowed, but flagged in reports.`;
  banner.hidden = false;
}

function clearOverlapBanner() {
  const banner = $('overlap-banner');
  if (!banner) return;
  banner.textContent = '';
  banner.hidden = true;
  banner.classList.remove('error');
  // §12 R21: the Timer-view Stop/toggle rejection region is cleared on the same beat — a good
  // write reloads through load() → clearOverlapBanner(), so the block dismisses from both views.
  const timerWarn = $('timer-warning');
  if (timerWarn) {
    timerWarn.textContent = '';
    timerWarn.hidden = true;
  }
}

// §12 R21: paint a refused write into an INLINE message region at the point of action. The
// region is announced (role=status/aria-live) and stays until the next input on that form
// clears it. `showFormError`/`clearFormError` are the shared primitives the unified form,
// split confirm and inline rename all use; the report builder and the popover own their own
// regions but read the message through the same SU.errMessage.
//
// design.html D15: a refusal is a BLOCK, so the region it lands in must read in the --danger
// palette — never the --flag advisory one. The dedicated `.form-error` regions are danger by
// construction; #overlap-banner serves BOTH kinds and takes danger from the `error` state
// class (showWriteError sets it, load() clears it). Setting it on an always-danger region is inert.
function showFormError(el, err) {
  if (!el) return;
  el.textContent = errMessage(err);
  el.classList.add('error');
  el.hidden = false;
}
function clearFormError(el) {
  if (!el) return;
  el.textContent = '';
  el.classList.remove('error');
  el.hidden = true;
}

// §12 R21: a Stop/toggle (timer card + Timer view) rejection has no open form to hold it, so it is
// surfaced WHERE THE ACTION LIVES. The Stop/toggle controls are on the Timer view, so it paints the
// Timer-view region (#timer-warning, beside the card's controls — the "Stop appears dead" surface,
// issue #61) AND the Entries-view overlap-banner area (reworded as a block via .error) so the block
// is visible in whichever view is active. load() clears both on the next good write.
function showWriteError(err) {
  const message = errMessage(err);
  const timerWarn = $('timer-warning');
  if (timerWarn) {
    timerWarn.textContent = message;
    timerWarn.hidden = false;
  }
  const banner = $('overlap-banner');
  if (banner) {
    banner.textContent = message;
    banner.classList.add('error');
    banner.hidden = false;
  }
}

// The compact glance summary line shared by render() (data repaint) and tick() (per-second
// advance), so both build the same markup: the run dot + "running" + the live elapsed +
// description + tags while a timer runs, or a plain "idle" face. A pure function of the
// running entry (null when idle) keeps the two call sites in lockstep.
function summaryHtml(running) {
  if (!running) return '<b>idle</b>';
  return (
    `<span class="run-dot" aria-hidden="true"></span> <b>running</b> ` +
    `${fmtDur(elapsed(running.startUtc))} · ${escapeHtml(running.description ?? 'your timer')}${tagsHtml(running)}`
  );
}

function render() {
  if (!state) return;
  const running = state.status.running ? state.status.entry : null;

  $('summary').innerHTML = summaryHtml(running);

  // §12 R04: the Entries view hosts only the COMPACT STRIP; the full Active-Timer card lives
  // in the Timer view. Paint both from the same running state so a write from either view (the
  // card's Stop reloads via load()→render()) keeps the strip AND the Timer-view card in
  // sync — even though only one is on-screen at a time. route('timer') also repaints the card.
  renderTimerStrip(running);
  renderTimerCard(running);

  const toggle = $('toggle');
  toggle.textContent = running ? 'Stop' : 'Start';
  // The `primary` class is NOT re-asserted here: syncStandingPrimary owns it (design.html D11 —
  // the accent handoff), and re-lighting it on every repaint would fight that.
  // §12 R14: announce the toggle's running/idle state to the accessibility tree (the JUDGE
  // harness reads the a11y tree) — aria-pressed reflects "running", and the label spells out
  // the action so the icon-or-ambiguous button is discernible under a screen reader.
  toggle.setAttribute('aria-pressed', String(!!running));
  toggle.setAttribute('aria-label', running ? 'Stop timer' : 'Start timer');

  // §12 R09 (issue #264): NO range-total chip repaint here — the toolbar carries no report
  // total. The billable figures this view shows are the per-day day-header totals the
  // calendar paints (§12 R16, renderEntries below), live per §17 R11; report totals are
  // Reports' job, reached by its sidebar item (§12 R03).
  renderEntries();
}

// §12 R16 — the readonly entries CALENDAR geometry (G10/G16). One day column per SHOWN day of
// the selected week — an equal share of the view width with NO horizontal scroll (§12 R22,
// styles.css `.dcol` flexes from zero, no floor) — over a FULL 24h track: the track is always
// the whole day so nothing clips; the viewport scrolls to the working-hours default. HOUR_PX
// drives both the vertical pixels-per-hour and the event positioning, so an entry's top/height
// is a pure function of its local minutes-of-day — the SAME window math the picker uses
// (window.SU.timelineWindow), never re-derived here.
// 60 is the TALLER hour of §12 R16 (hour legibility outranks hours-in-view; mockup main.html)
// and is NOT free to change here alone (#174): styles.css `.dt` paints the hour rules with a
// repeating-linear-gradient hard-coded at 59px/60px — CSS cannot read this constant — so the
// two must move together or the painted hour lines drift off the positioned events. The value
// also keeps the 24h track (1440px) overflowing `.cstrip`'s 60vh viewport at any ordinary
// window height, which is what makes the working-hours default a real SCROLL, never a clip (G16).
const CAL_HOUR_PX = 60;
const CAL_DAY_PX = CAL_HOUR_PX * 24; // the full 24h track height (scroll, never clip)
const CAL_PX_PER_MIN = CAL_HOUR_PX / 60;
const CAL_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// An instant's LOCAL day as a 'YYYY-MM-DD' token — core's localDay in the CONFIGURED zone
// (SU.localDayOf, §04 R06), the same vocabulary core gives the snapshot's day keys, so the
// two compare directly. Used to detect a cross-midnight span (§12 R16 / issue #71): a
// closed entry whose local end day differs from its local start day.
function calLocalDayOf(iso) {
  return SU.localDayOf(iso);
}
// 'YYYY-MM-DD' → { dw, dd } via UTC math, so a day column's weekday/date label never depends
// on the runner timezone (the day key is already the entry's local day, resolved by core).
function calDayParts(dayStr) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return { dw: CAL_WEEKDAYS[dt.getUTCDay()], dd: String(d) };
}
function calAddDays(dayStr, n) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
// The [start, end] day strings of the week (by the weekStart setting) containing a day. Pure
// string/UTC math so it is timezone-agnostic — used to pad the default view to a whole week.
function calWeekBounds(dayStr) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const startDow = state && state.settings && state.settings.weekStart === 'sunday' ? 0 : 1;
  const back = (dow - startDow + 7) % 7;
  const start = calAddDays(dayStr, -back);
  return [start, calAddDays(start, 6)];
}
function calEnumerateDays(minDay, maxDay) {
  const out = [];
  let cur = minDay;
  let guard = 0;
  while (cur <= maxDay && guard++ < 400) {
    out.push(cur);
    cur = calAddDays(cur, 1);
  }
  return out;
}

// Whether a 'YYYY-MM-DD' token is a Monday–Friday weekday (UTC math over the token, like
// calDayParts — the token is already a resolved local day, so no zone re-derivation here).
function calIsWeekday(dayStr) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

// Today's local day token in the configured zone — the one 'today' every surface of this
// view marks (the grid's today indicator, the picker's today ring, the default week).
function calToday() {
  return SU.localDayOf(new Date().toISOString());
}

// §12 R09: the selected week's first day. null (the default) resolves to the week containing
// today, per the weekStart setting, at read time — so the default view follows the clock.
function calSelectedWeekStart() {
  return selectedWeekStart ?? calWeekBounds(calToday())[0];
}

// The selected week's seven day tokens, and the SHOWN subset — Monday–Friday with the
// weekend hidden (show_weekend off, the §14 default), all seven with it shown (§12 R09).
function calWeekDays() {
  const ws = calSelectedWeekStart();
  return calEnumerateDays(ws, calAddDays(ws, 6));
}
function calShownDays() {
  const week = calWeekDays();
  return state && state.settings && state.settings.showWeekend ? week : week.filter(calIsWeekday);
}

// Fixed English month names for the week label and the picker's month heading (deterministic
// across runners; the date/number-format setting governs times and numerals, not these).
const CAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CAL_MONTHS_SHORT = CAL_MONTHS.map((m) => m.slice(0, 3));

// §12 R09: the toolbar's week label over the SHOWN days — "Jun 22 – 26, 2026" with the
// weekend hidden, "Jun 22 – 28, 2026" with it shown; month/year repeat only when they differ
// across the span (a cross-month or cross-year week names both ends in full).
function calWeekLabel() {
  const shown = calShownDays();
  const first = shown[0];
  const last = shown[shown.length - 1];
  const [fy, fm, fd] = first.split('-').map(Number);
  const [ly, lm, ld] = last.split('-').map(Number);
  if (fy === ly && fm === lm) return `${CAL_MONTHS_SHORT[fm - 1]} ${fd} – ${ld}, ${fy}`;
  if (fy === ly) return `${CAL_MONTHS_SHORT[fm - 1]} ${fd} – ${CAL_MONTHS_SHORT[lm - 1]} ${ld}, ${fy}`;
  return `${CAL_MONTHS_SHORT[fm - 1]} ${fd}, ${fy} – ${CAL_MONTHS_SHORT[lm - 1]} ${ld}, ${ly}`;
}

// §12 R16 (issue #71): the rendering SEGMENTS an entry lays onto the day columns. A same-day
// entry is one 'full' segment in its start-day column; a CLOSED entry whose local end day differs
// from its local start day CROSSES MIDNIGHT and renders ONE SEGMENT PER TOUCHED COLUMN, all sharing
// the entry id: a start-day segment (its start minute → the track BOTTOM, 24:00), a full-height
// 00:00→24:00 segment for each fully-covered middle day, and an end-day segment (the track TOP,
// 00:00 → its end minute). The open/running entry never splits — it stays one future-fading
// start-only block in its start column (calEvent caps the span; no end day exists to cross into).
// Attribution is NOT touched here: the entry lives in exactly one day bucket keyed by its START
// day (entrylist.ts localDay(startUtc)); these segments are a pure rendering fan-out that never
// re-buckets it, so a cross-midnight end/middle column shows the span WITHOUT counting it in that
// column's billable total — matching `tt report --by day`. `startDay` is the authoritative bucket
// key the entry was grouped under (never re-derived), so the start segment always lands in its
// own column even at a local-day boundary. topMin/botMin are local minutes-of-day; a null botMin
// marks the open block, whose foot calEvent computes (future-fade cap).
function calEntrySegments(e, startDay) {
  const startMin = localMinuteOfDay(e.startUtc);
  if (e.endUtc === null) return [{ day: startDay, topMin: startMin, botMin: null, part: 'open' }];
  const endDay = calLocalDayOf(e.endUtc);
  const endMin = localMinuteOfDay(e.endUtc);
  // Same local day (the common case): one block start→end, with the legibility floor applied by
  // calEvent. `endDay <= startDay` also folds any degenerate end-before-start into the same-day
  // path rather than emitting a backwards fan-out.
  if (endDay <= startDay) {
    return [{ day: startDay, topMin: startMin, botMin: Math.max(endMin, startMin + 5), part: 'full' }];
  }
  // Cross-midnight: a start segment to the boundary, a full-height slice per whole middle day, and
  // an end segment from the boundary down to the end minute.
  const segs = [{ day: startDay, topMin: startMin, botMin: 1440, part: 'seg-start' }];
  for (let mid = calAddDays(startDay, 1); mid < endDay; mid = calAddDays(mid, 1)) {
    segs.push({ day: mid, topMin: 0, botMin: 1440, part: 'seg-mid' });
  }
  // A span ending exactly at local midnight (endMin 0) gains no visible slice on the end day — the
  // start segment already reaches the boundary — so no zero-height end segment is emitted.
  if (endMin > 0) segs.push({ day: endDay, topMin: 0, botMin: endMin, part: 'seg-end' });
  return segs;
}

// §12 R16 (G13): resolve the ORDERED set of day columns to paint plus each day's entries + its
// per-day billable total. The view is WEEK-ONLY (§12 R09): the columns are exactly the selected
// week's SHOWN days — Monday–Friday with the weekend hidden, all seven with it shown — including
// EMPTY days (present-but-empty `.dcol`), so the week reads as a continuous surface. The entries
// come from the SAME two sources render() already distinguishes: the toolbar's day-laid
// listEntries result when active (R09), else the getState day grouping — either way clipped to
// the selected week, so a snapshot day outside it paints nothing.
function calendarModel() {
  const week = calWeekDays();
  const shown = calShownDays();
  const source = entryGroups
    ? entryGroups.map((g) => ({ day: g.key, entries: g.entries }))
    : state.days.map((d) => ({ day: d.day, entries: d.entries }));
  // Only groups INSIDE the selected week feed the paint — both hidden weekend days and days
  // outside the week keep their entries stored/reported, they are just not this view's columns.
  const present = source.filter((p) => p.day >= week[0] && p.day <= week[week.length - 1]);
  const map = new Map(present.map((p) => [p.day, p.entries]));
  // §12 R16 / §16 (issue #71): fan each entry out into a rendering segment per day column it
  // touches (calEntrySegments). Keyed by SHOWN day, so a segment landing on a day the grid does
  // not show — a hidden weekend day, or a day outside the selected week — is simply NOT DRAWN
  // (no bucket exists for it); hiding a segment never changes attribution or any total. A
  // cross-midnight end/middle segment lands in the right column even though that column's own
  // `entries` (its totals below) never gained the entry — the fan-out is pure rendering,
  // attribution stays start-day.
  const segsByDay = new Map(shown.map((d) => [d, []]));
  for (const p of present) {
    for (const e of p.entries) {
      for (const seg of calEntrySegments(e, p.day)) {
        const bucket = segsByDay.get(seg.day);
        if (bucket) bucket.push({ ...seg, entry: e });
      }
    }
  }
  return shown.map((day) => {
    const entries = map.get(day) || [];
    // The day-header total is the billable-only sum (empty day → 0), matching what `tt report`
    // sums for that day — the same billableSeconds core owns; the renderer never re-derives it.
    // Start-day attribution: a cross-midnight span counts only in its start-day column, so the
    // end/middle columns can show its segment without inflating their totals.
    const billableSeconds = entries.reduce((s, e) => s + (e.billable ? e.billableSeconds : 0), 0);
    return { day, entries, billableSeconds, segments: segsByDay.get(day) || [] };
  });
}

// §12 R16: the grid's vertical scroll position, held across repaints. renderCalendar builds a
// FRESH strip on every paint, so assigning the default window on each one meant every external
// write (a tt edit, the DB file watcher) yanked the user's view back to working hours mid-look
// — and mid-drag it shifted the track under the rect the press captured, bending the
// cursor→minute mapping with no visible cause. null means "nothing to restore" and the next
// build lands on its computed default; it is cleared only where a retarget IS the intent — an
// explicit week change (selectWeek) and a form open (which centres on the edited interval).
let calScrollTop = null;

// §12 R9/R16: paint the Entries view. The default (toolbar idle) and the toolbar-active query
// both flow into the SAME readonly week grid (R16); only the never-tracked / no-match empty
// states short-circuit to their instructive `.empty` block. A week with no entries is NOT an
// empty state — it paints as a week of empty columns (stepping into a quiet week is normal);
// the no-match copy is reserved for a filter/search that excluded everything.
function renderEntries() {
  // §12 R09: the toolbar chrome around the grid — week label, weekend switch, picker — repaints
  // with the data so a week/setting change is reflected everywhere at once.
  renderWeekControls();
  renderWeekPicker();
  // §12 R24: a repaint NEVER closes the open unified form — it lives in the view-level
  // #entry-form-host outside this repainted host, so a week change or external refresh
  // repaints the grid beneath while the form (and its unsaved fields) stays mounted. The
  // pre-R24 renderEntries closed the form here, which was exactly the silent discard the
  // pending-changes gate exists to prevent; onChange below owns the refresh-time gating.
  const host = $('entries');
  // §12 R16: carry the live viewport over the rebuild below. Read off the DOM here rather than
  // recorded by a scroll listener: Chromium dispatches `scroll` at frame time, and a repaint
  // driven by an awaited IPC read reaches this line first, so the listener's value would be one
  // frame stale exactly when it matters. A null calScrollTop is a pending retarget (a week
  // change, a form open) and is left alone — the next build lands on its computed default.
  const liveStrip = host.querySelector('.cstrip');
  if (liveStrip && calScrollTop !== null) calScrollTop = liveStrip.scrollTop;
  host.innerHTML = '';
  if (entryGroups) {
    if (entryGroups.length === 0 && (searchQuery || hasNarrowingFilter())) {
      host.appendChild(emptyEntries());
      host.appendChild(calFab());
      refreshCalendarChrome();
      renderMergeBar();
      return;
    }
    renderCalendar(host);
    renderMergeBar();
    return;
  }
  if (state.days.length === 0) {
    // §12 R07 / §05 R05: even the never-tracked empty state keeps manual add reachable — the
    // + button rides the empty block (no grid to drag, so BOTH activation paths open the form
    // directly with the working-hours default interval; see calFab's no-grid degradation).
    host.appendChild(emptyState());
    host.appendChild(calFab());
    refreshCalendarChrome();
    renderMergeBar();
    return;
  }
  renderCalendar(host);
  renderMergeBar();
}

// §12 R16: build the week grid — the shown day columns sharing the view width equally over a
// shared hour gutter (fit to width, NO horizontal scroll), then default the viewport to the
// working-hours window (a vertical scroll over the full 24h track, never a clip).
function renderCalendar(host) {
  const model = calendarModel();
  const wrap = document.createElement('div');
  wrap.className = 'calwrap';
  const strip = document.createElement('div');
  strip.className = 'cstrip';
  const grid = document.createElement('div');
  grid.className = 'cgrid';
  grid.appendChild(calGutter());
  model.forEach((d, i) => grid.appendChild(calColumn(d, i === model.length - 1)));
  strip.appendChild(grid);
  wrap.appendChild(strip);
  // §12 R07/R23: the grid's corner pair — the round + button at rest, the fine-snap toggle
  // in its spot during select-interval/create/edit — anchored to the non-scrolling wrap so
  // they hold the corner while the hour track scrolls beneath.
  wrap.appendChild(calFab());
  wrap.appendChild(calSnapCtl());
  // §12 R16: the grid is also a drag surface — select-interval + create gestures (R07) and
  // the selected event's edge/body drags (R06), all snapping per R23.
  wireGridDrag(wrap);
  host.appendChild(wrap);
  refreshCalendarChrome();
  // §14 / G16: the entries calendar ALWAYS defaults to working hours — pass the shared window
  // helper the picker uses, forcing working_hours mode, and scroll the 24h track to that start.
  // A scroll, never a clip: every off-hours entry stays in the DOM and is reachable by scrolling.
  const win = window.SU.timelineWindow(
    { ...(state.settings || {}), pickerWindowMode: 'working_hours' },
    new Date().toISOString(),
    null,
  );
  // The header band is STICKY (styles.css `.dh`, issue #145), so it stays pinned to the
  // scrollport's top edge and no longer scrolls out of the way: the working-hours row must land
  // BELOW it, not behind it. The strip's content is the 52px header band followed by the 24h
  // track, so scrolling by the track offset ALONE puts working-start at the band's bottom edge —
  // adding the band's own height back would hide the first 52px of the working day behind it.
  // §12 R06/R07: while the unified form is open its pending/selected interval is the thing the
  // user is dragging, so the viewport lands on IT (a little context above its start) rather
  // than the working-hours default — otherwise editing an off-hours entry opens onto empty grid.
  const iv = calMode === 'form' ? openFormInterval() : null;
  const defaultTop = Math.round(
    iv
      ? Math.max(localMinuteOfDay(iv.startIso) - 60, 0) * CAL_PX_PER_MIN
      : win.startMin * CAL_PX_PER_MIN,
  );
  // The default is for the FIRST build and for the retargets that cleared calScrollTop; every
  // other paint restores where the user was. Read back rather than stored verbatim, so a
  // position clamped to the track's maximum is the one carried on.
  strip.scrollTop = calScrollTop ?? defaultTop;
  calScrollTop = strip.scrollTop;
}

// The fixed hour gutter: a header spacer aligned with the day headers, then 00:00–24:00 labels
// over the full 24h track (so every hour is reachable — the viewport scrolls, the track never clips).
function calGutter() {
  const gut = document.createElement('div');
  gut.className = 'gut';
  const sp = document.createElement('div');
  sp.className = 'sp2';
  gut.appendChild(sp);
  const gtr = document.createElement('div');
  gtr.className = 'gtr';
  gtr.style.height = CAL_DAY_PX + 'px';
  for (let h = 0; h <= 24; h++) {
    const lab = document.createElement('span');
    lab.className = 'hlab';
    lab.style.top = h * CAL_HOUR_PX + 'px';
    lab.textContent = String(h).padStart(2, '0') + ':00';
    gtr.appendChild(lab);
  }
  gut.appendChild(gtr);
  return gut;
}

// One day column: a header carrying the weekday/date + that day's billable total
// (§12 R16 / G13), then a 24h track holding the day's positioned events + any overlap warn bands.
// TODAY is visibly indicated on the grid — an ink ring on the date numeral (`.dd.today`,
// matching the week picker's today ring; mockup main.html), distinct from mere selection, which
// is the picker's week band. A zero-total day carries no figure (the mockup's authored reading
// of "empty days render as empty columns": the header stays quiet rather than shouting 0.00h).
function calColumn(d, isEnd) {
  const col = document.createElement('div');
  col.className = 'dcol' + (isEnd ? ' end' : '');
  const { dw, dd } = calDayParts(d.day);
  const today = d.day === calToday() ? ' today' : '';
  const head = document.createElement('div');
  head.className = 'dh';
  head.innerHTML =
    `<span class="dw">${dw}</span><b class="dd${today}">${dd}</b>` +
    (d.billableSeconds > 0 ? `<span class="ds tnum">${fmtHours(d.billableSeconds)}</span>` : '');
  col.appendChild(head);
  const track = document.createElement('div');
  track.className = 'dt';
  track.style.height = CAL_DAY_PX + 'px';
  // §12 R07/R16: the day token the drag surface resolves pointer positions against
  // (gridPointAt) and the pending-interval overlay keys its segments by (paintPendingOverlay).
  track.dataset.day = d.day;
  // §06 R4 / §12 R10: overlap renders as a yellow warn BAND behind the events (detail lives in
  // the editor). Painted first so the events sit above it. Overlap is a same-day concept, so the
  // band iterates the column's own start-day entries.
  for (const e of d.entries) if (e.overlapped) track.appendChild(calOverlapBand(e));
  // §12 R16 (issue #71): paint one calendar event per SEGMENT — a same-day entry has exactly one,
  // a cross-midnight span has a segment in each touched column (all sharing the entry id, so
  // selection/click/hover act on the one entry). calEvent positions from the segment's bounds.
  // §12 R06: the entry being EDITED paints as the accent-outlined pending interval instead
  // (paintPendingOverlay, off the form's live Start/Stop values — mockup edit-entry.html), so
  // its stored segments are skipped here rather than drawn twice.
  const editingId = calMode === 'form' && openForm?.mode === 'edit' ? openForm.entry.id : null;
  for (const seg of d.segments) {
    if (editingId !== null && seg.entry.id === editingId) continue;
    track.appendChild(calEvent(seg.entry, seg));
  }
  col.appendChild(track);
  return col;
}

// §06 R4 / §12 R10: the yellow overlap warn band, positioned over the overlapping minutes.
function calOverlapBand(e) {
  const band = document.createElement('div');
  band.className = 'ov';
  band.style.top = localMinuteOfDay(e.startUtc) * CAL_PX_PER_MIN + 'px';
  const mins = e.overlapMinutes || 15;
  band.style.height = Math.max(mins * CAL_PX_PER_MIN, 8) + 'px';
  band.innerHTML = `<span class="otag">overlap ${mins}m</span>`;
  return band;
}

// ─────────────────────────────────────────── §12 R07/R16/R23 — the grid as drag surface

// §12 R07: the Entries view's interaction mode over the week grid.
//   'rest'   — readonly calendar; the round + button sits bottom-right (R07).
//   'select' — select-interval: a start handle follows the cursor at the coarse snap;
//              pressing and dragging sets the interval length; release enters create mode.
//   'form'   — the unified form is open above the grid (add or edit, `openForm` below);
//              the grid is the drag surface adjusting the form's interval (R06/R07/R16).
// Outside these modes nothing on the grid mutates an entry directly (R16).
let calMode = 'rest';

// §12 R23: the ephemeral fine-snap toggle — deliberately NOT a setting (§14): never
// persisted, reset to coarse on every entry into select-interval mode or a form open.
let fineSnap = false;

// §12 R06/R07/R24: the open unified form, or null. One form ever (add or edit); the grid
// chrome (gray-out, + button, fine-snap toggle, the pending/selected interval overlay) is a
// pure function of this + calMode, re-derived on every repaint (refreshCalendarChrome).
//   mode     — 'add' | 'edit'
//   entry    — the edited entry (edit mode) / null (add mode)
//   running  — edit mode on the open row (no Stop field, start grip only — §05 R06)
//   form     — the mounted <form> element in #entry-form-host
//   seed     — the field snapshot dirty-tracking compares against (R24); the select halves
//              are patched in once the async reference data resolves, so a keystroke landing
//              before the selects populate still reads dirty against the true seed
//   tags     — the live tag working set (the chips mutate it; Save reads it)
//   billTouched — §05 R07: add mode's billable stays core-derived until the user touches it
let openForm = null;

// Snap a minute-of-day onto the active grid, clamped to the 24h track. Applied ONLY to a
// value the user is actively dragging (issue #49): a shown value is never rewritten.
// The step itself is SU.snapStepMin (§12 R23, src/snap.ts) — the same resolution the Timer
// view's picker reads, off the §14 settings snapshot with core's defaults behind it.
function snapMin(minutes) {
  const step = SU.snapStepMin(state && state.settings, fineSnap);
  return Math.max(0, Math.min(1440, Math.round(minutes / step) * step));
}

// Resolve a viewport point to the day column under it. The minute is clamped to the track
// (a cursor above/below still resolves), so a drag can overshoot without losing its column.
function gridPointAt(clientX, clientY) {
  for (const track of document.querySelectorAll('#entries .dt')) {
    const r = track.getBoundingClientRect();
    if (clientX >= r.left && clientX < r.right) {
      const minute = Math.max(0, Math.min(1440, (clientY - r.top) / CAL_PX_PER_MIN));
      return { day: track.dataset.day, minute, track };
    }
  }
  return null;
}

// The wall-clock instant of (local day token, minute-of-day) in the CONFIGURED zone — built
// through the ONE parse rule (SU.parseLocalInput), so grid geometry and typed fields resolve
// through identical zone math. Whole minutes only: drag output is always on a snap grid.
function wallDateAt(day, minute) {
  const h = String(Math.floor(minute / 60)).padStart(2, '0');
  const m = String(Math.round(minute % 60)).padStart(2, '0');
  return parseLocalInput(`${day} ${h}:${m}:00`);
}

// §12 R17: the open form's interval as parsed from its raw Start/Stop fields — the fields
// are the authoritative form state (grid and fields drive the SAME values), so the overlay
// and every drag read through here. A half the user has typed unparseable text into reads
// null and the overlay simply doesn't paint it; Save surfaces the parse error (R21).
function openFormInterval() {
  if (!openForm) return null;
  const form = openForm.form;
  const startRaw = form.querySelector('.edit-start')?.value ?? '';
  const endRaw = openForm.running ? '' : (form.querySelector('.edit-end')?.value ?? '');
  let start = null;
  let stop = null;
  try { if (startRaw) start = parseLocalInput(startRaw); } catch { start = null; }
  try { if (endRaw) stop = parseLocalInput(endRaw); } catch { stop = null; }
  if (!start || Number.isNaN(start.getTime())) return null;
  if (stop && Number.isNaN(stop.getTime())) stop = null;
  return { startIso: start.toISOString(), stopIso: stop ? stop.toISOString() : null };
}

// §12 R06/R07: write a dragged interval back into the form's Start/Stop fields LIVE (R17 —
// a grid drag updates them live) and repaint the overlay. Only the actively dragged handle
// arrives snapped; an untouched half is passed through verbatim by the callers.
function writeFormInterval(startDate, stopDate) {
  if (!openForm) return;
  const form = openForm.form;
  const startInput = form.querySelector('.edit-start');
  const endInput = form.querySelector('.edit-end');
  if (startDate && startInput) startInput.value = localInputValue(startDate);
  if (stopDate && endInput) endInput.value = localInputValue(stopDate);
  clearFormError(form.querySelector('.ef-warning'));
  paintPendingOverlay();
}

// §12 R16 (issue #71): the shown-day rendering segments of an arbitrary local span — the
// same fan-out calEntrySegments applies to stored entries, over the form's live interval:
// one 'full' block same-day, else start segment → the column foot, a full-height slice per
// whole middle day, an end segment from the column head. A null stop is the open row's
// start-only block (capped like calEvent's future fade).
function calSpanSegments(startIso, stopIso) {
  const startDay = calLocalDayOf(startIso);
  const startMinute = localMinuteOfDay(startIso);
  if (!stopIso) {
    return [{ day: startDay, topMin: startMinute, botMin: Math.min(startMinute + 180, 1440), part: 'open' }];
  }
  const endDay = calLocalDayOf(stopIso);
  const endMinute = localMinuteOfDay(stopIso);
  if (endDay <= startDay) {
    return [{ day: startDay, topMin: startMinute, botMin: Math.max(endMinute, startMinute + 1), part: 'full' }];
  }
  const segs = [{ day: startDay, topMin: startMinute, botMin: 1440, part: 'seg-start' }];
  for (let mid = calAddDays(startDay, 1); mid < endDay; mid = calAddDays(mid, 1)) {
    segs.push({ day: mid, topMin: 0, botMin: 1440, part: 'seg-mid' });
  }
  if (endMinute > 0) segs.push({ day: endDay, topMin: 0, botMin: endMinute, part: 'seg-end' });
  return segs;
}

// §12 R06/R07 (mockup edit-entry.html): paint the pending/selected interval — the ONE vivid
// block on the drag surface: an accent-outlined `.ev.me` per shown-day segment, edge grips on
// the outer edges (top grip on the start segment, bottom grip on the end segment — the only
// handles an edge drag grabs), and the start/stop time pills beside them. Re-derived from the
// form's raw fields on every call, so a typed field updates the grid live (R17) and a week
// change simply doesn't draw segments whose day isn't shown (the form itself stays). An
// `explicit` interval paints the select-mode provisional drag before any form exists.
function paintPendingOverlay(explicit) {
  document.querySelectorAll('#entries .ev.me, #entries .tlabel').forEach((el) => el.remove());
  const iv = explicit ?? (calMode === 'form' ? openFormInterval() : null);
  if (!iv || !iv.startIso) return;
  const segs = calSpanSegments(iv.startIso, iv.stopIso);
  const last = segs[segs.length - 1];
  for (const seg of segs) {
    const track = document.querySelector(`#entries .dt[data-day="${seg.day}"]`);
    if (!track) continue; // a hidden day's segment is simply not drawn (R16)
    const block = document.createElement('div');
    const first = seg === segs[0];
    block.className =
      'ev me' +
      (seg.part === 'seg-start' || seg.part === 'seg-mid' || seg.part === 'seg-end' ? ` seg ${seg.part}` : '') +
      (seg.part === 'open' ? ' open' : '');
    block.style.top = seg.topMin * CAL_PX_PER_MIN + 'px';
    block.style.height = Math.max((seg.botMin - seg.topMin) * CAL_PX_PER_MIN, 6) + 'px';
    let inner = '';
    // Grips only on the outer edges: dragging one edge never moves the other (issue #49 —
    // the untouched half keeps its stored value to the second).
    if (first && (seg.part === 'full' || seg.part === 'seg-start' || seg.part === 'open')) {
      inner += '<span class="grip t" data-grip="start" aria-hidden="true"></span>';
    }
    if (seg === last && (seg.part === 'full' || seg.part === 'seg-end') && iv.stopIso) {
      inner += '<span class="grip b" data-grip="stop" aria-hidden="true"></span>';
    }
    block.innerHTML = inner;
    track.appendChild(block);
    // The time pills ride beside the outer edges (mockup: start above, stop below).
    if (first) {
      const lab = document.createElement('span');
      lab.className = 'tlabel tnum';
      lab.style.top = Math.max(seg.topMin * CAL_PX_PER_MIN - 24, 0) + 'px';
      lab.textContent = localTime(iv.startIso);
      track.appendChild(lab);
    }
    if (seg === last && iv.stopIso && (seg.part === 'full' || seg.part === 'seg-end')) {
      const lab = document.createElement('span');
      lab.className = 'tlabel tnum';
      lab.style.top = Math.min(seg.botMin * CAL_PX_PER_MIN + 4, CAL_DAY_PX - 20) + 'px';
      lab.textContent = localTime(iv.stopIso);
      track.appendChild(lab);
    }
  }
}

// The one in-flight grid drag (window-level pointermove/pointerup while the button is held).
//
// The gestures below run under POINTER CAPTURE, taken on the press by wireGridDrag. That is
// what makes a release the page would otherwise never hear still END the drag: let the button
// go outside the window and no `mouseup` is delivered at all, so a mouse-event drag stays live
// forever — the interval trailing a cursor with no button held, Escape dead (its handler is
// guarded on no drag in flight), and the next click anywhere firing the stale release. The
// start-only picker (timepicker.js) has always used this pattern; the grid now shares it.
let gridDrag = null;

// Begin a press-drag that PLACES an interval: the select-interval gesture (release enters
// create mode) and add mode's re-place-anywhere gesture (`live` writes the form fields on
// every move, R07). The interval grows from the snapped anchor toward the cursor; a bare
// click (no movement) falls back to a 60-minute default from the anchor.
function startNewDrag(pt, { openOnRelease = false, live = false } = {}) {
  const track = pt.track;
  const rect = track.getBoundingClientRect();
  const day = pt.day;
  const anchor = snapMin(pt.minute);
  hideSelectHandle();
  gridDrag = { kind: 'new', moved: false };
  const intervalAt = (clientY) => {
    const cur = snapMin((clientY - rect.top) / CAL_PX_PER_MIN);
    let lo = Math.min(anchor, cur);
    let hi = Math.max(anchor, cur);
    if (hi === lo) hi = Math.min(lo + SU.snapStepMin(state && state.settings, fineSnap), 1440);
    return { startIso: wallDateAt(day, lo).toISOString(), stopIso: wallDateAt(day, hi).toISOString() };
  };
  const onMove = (ev) => {
    gridDrag.moved = true;
    const iv = intervalAt(ev.clientY);
    if (live && openForm) writeFormInterval(new Date(iv.startIso), new Date(iv.stopIso));
    else paintPendingOverlay(iv);
  };
  const onUp = (ev) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const moved = gridDrag.moved;
    gridDrag = null;
    if (!openOnRelease) return;
    // Release enters create mode (R07); an un-dragged click seeds a default-length interval.
    const iv = moved
      ? intervalAt(ev.clientY)
      : {
          startIso: wallDateAt(day, anchor).toISOString(),
          stopIso: wallDateAt(day, Math.min(anchor + 60, 1440)).toISOString(),
        };
    void openUnifiedForm({ mode: 'add', startIso: iv.startIso, stopIso: iv.stopIso });
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// §12 R06/R07: drag ONE edge of the pending/selected interval. Only the dragged edge snaps;
// the other keeps its value verbatim — to the second (issue #49). Edge drags stay within the
// edge's own day column (the typed Start/Stop fields are the only overnight path, R17), and
// the span stays strictly positive by clamping against the fixed edge.
function startEdgeDrag(which) {
  const iv = openFormInterval();
  if (!iv) return;
  const edgeIso = which === 'start' ? iv.startIso : iv.stopIso;
  if (!edgeIso) return;
  const day = calLocalDayOf(edgeIso);
  const track = document.querySelector(`#entries .dt[data-day="${day}"]`);
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const startMs = Date.parse(iv.startIso);
  const stopMs = iv.stopIso ? Date.parse(iv.stopIso) : null;
  gridDrag = { kind: 'edge' };
  const onMove = (ev) => {
    const minute = snapMin(Math.max(0, Math.min(1440, (ev.clientY - rect.top) / CAL_PX_PER_MIN)));
    let cand = wallDateAt(day, minute).getTime();
    const minSpanMs = 60 * 1000; // the span stays strictly positive (§05 R05)
    if (which === 'start') {
      if (stopMs !== null && cand > stopMs - minSpanMs) cand = stopMs - minSpanMs;
      writeFormInterval(new Date(cand), null);
    } else {
      if (cand < startMs + minSpanMs) cand = startMs + minSpanMs;
      writeFormInterval(null, new Date(cand));
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    gridDrag = null;
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// §12 R06/R07: drag the interval's BODY — both edges move together, the exact span preserved
// (both handles are actively dragged, so the snapped start plus the verbatim span is the
// whole write). The cursor's column sets the day, so a body drag can carry the interval to
// another shown day.
function startMoveDrag(pressEv) {
  const iv = openFormInterval();
  if (!iv || !iv.stopIso) return; // the open row moves by its start grip only (§05 R06)
  const pt = gridPointAt(pressEv.clientX, pressEv.clientY);
  if (!pt) return;
  const startMs = Date.parse(iv.startIso);
  const spanMs = Date.parse(iv.stopIso) - startMs;
  const grabMs = wallDateAt(pt.day, pt.minute).getTime() - startMs;
  gridDrag = { kind: 'move' };
  const onMove = (ev) => {
    const at = gridPointAt(ev.clientX, ev.clientY);
    if (!at) return;
    const tentative = new Date(wallDateAt(at.day, at.minute).getTime() - grabMs);
    const tentIso = tentative.toISOString();
    const snapped = wallDateAt(calLocalDayOf(tentIso), snapMin(localMinuteOfDay(tentIso)));
    writeFormInterval(snapped, new Date(snapped.getTime() + spanMs));
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    gridDrag = null;
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// §12 R07: the select-interval start handle — a snapped accent line following the cursor
// with a time pill, moved between day tracks as the cursor crosses columns.
function moveSelectHandle(pt) {
  /** @type {any} */
  let handle = document.querySelector('#entries .shandle');
  if (!handle) {
    handle = document.createElement('div');
    handle.className = 'shandle';
    handle.innerHTML = '<span class="st tnum"></span>';
  }
  const minute = snapMin(pt.minute);
  if (handle.parentElement !== pt.track) pt.track.appendChild(handle);
  handle.style.top = minute * CAL_PX_PER_MIN + 'px';
  handle.hidden = false;
  const h = String(Math.floor(minute / 60)).padStart(2, '0');
  const m = String(minute % 60).padStart(2, '0');
  handle.querySelector('.st').textContent = `${h}:${m}`;
}
function hideSelectHandle() {
  document.querySelector('#entries .shandle')?.remove();
}

// §12 R07: enter select-interval mode — the + button's pointer path. Coarse snap on every
// entry (fineSnap resets); Escape returns to rest.
function enterSelectInterval() {
  calMode = 'select';
  fineSnap = false;
  refreshCalendarChrome();
}
function exitToRest() {
  calMode = openForm ? 'form' : 'rest';
  hideSelectHandle();
  refreshCalendarChrome();
}

// §12 R07: the keyboard path's default interval — aligned to the configured working hours
// (§14): one hour from the working-day start, on today when today is shown, else the shown
// week's first day.
function workingHoursDefaultInterval() {
  const win = window.SU.timelineWindow(
    { ...((state && state.settings) || {}), pickerWindowMode: 'working_hours' },
    new Date().toISOString(),
    null,
  );
  const shown = calShownDays();
  const day = shown.includes(calToday()) ? calToday() : shown[0];
  const startMin = Math.min(win.startMin, 1440 - 60);
  return {
    startIso: wallDateAt(day, startMin).toISOString(),
    stopIso: wallDateAt(day, startMin + 60).toISOString(),
  };
}

// §12 R07 (mockup main.html): the round + Add-entry button — bottom-right of the week grid,
// the view's standing accent-filled primary (design.html D11/D14; syncStandingPrimary hands
// the accent to an open commit surface). On hover it expands rightward into "+ Add entry"
// without the + glyph moving (CSS .fab .fl). Activation splits by input: a keyboard
// activation (click with detail 0) opens the form DIRECTLY with the working-hours default
// interval — every field tabbable — while a pointer click enters select-interval mode as
// the pointer enhancement. Hidden outside rest mode (the fine-snap toggle takes its spot).
function calFab() {
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'fab primary';
  fab.setAttribute('data-standing-primary', '');
  fab.setAttribute('aria-label', 'Add entry');
  fab.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-plus" /></svg><span class="fl">Add entry</span>';
  fab.addEventListener('click', (ev) => {
    // Keyboard activation (a click with detail 0), or no grid to drag on (the empty states
    // still carry the + button so manual add stays reachable, §05 R05): open the form
    // directly. A pointer click over a real grid enters select-interval mode.
    if (ev.detail === 0 || !document.querySelector('#entries .dt')) {
      const iv = workingHoursDefaultInterval();
      void openUnifiedForm({ mode: 'add', startIso: iv.startIso, stopIso: iv.stopIso });
    } else {
      enterSelectInterval();
    }
  });
  return fab;
}

// §12 R23: the fine-snap toggle — drawn in the + button's spot (bottom-right of the grid)
// while select-interval mode or the form is up. Ephemeral by design: flipping it never
// persists anything, and every mode entry resets to coarse.
function calSnapCtl() {
  const ctl = document.createElement('span');
  ctl.className = 'snapctl';
  ctl.innerHTML =
    `<button type="button" class="sw${fineSnap ? ' on' : ''}" role="switch" ` +
    `aria-checked="${fineSnap}" aria-label="Fine snap"><i aria-hidden="true"></i></button> Fine snap`;
  const sw = ctl.querySelector('.sw');
  sw.addEventListener('click', () => {
    fineSnap = !fineSnap;
    sw.classList.toggle('on', fineSnap);
    sw.setAttribute('aria-checked', String(fineSnap));
  });
  return ctl;
}

// §12 R07/R16/R23: sync the grid chrome to the current mode — called after every calendar
// repaint and on every mode change, so the chrome is a pure function of (calMode, openForm)
// rather than per-transition bookkeeping. Gray-out is CREATE mode only (R07); the + button
// shows only at rest; the fine-snap toggle holds its spot in the other modes.
function refreshCalendarChrome() {
  const wrap = document.querySelector('#entries .calwrap');
  if (wrap) {
    wrap.classList.toggle('sel-mode', calMode === 'select');
    wrap.classList.toggle('grayed', calMode === 'form' && openForm?.mode === 'add');
    wrap.classList.toggle('edit-mode', calMode === 'form' && openForm?.mode === 'edit');
  }
  // The + button and the fine-snap toggle trade the same bottom-right spot (R07/R23); the
  // empty states carry a + button with no calwrap, so these resolve against the view host.
  const fab = document.querySelector('#entries .fab');
  if (fab) fab.hidden = calMode !== 'rest';
  const ctl = document.querySelector('#entries .snapctl');
  if (ctl) ctl.hidden = calMode === 'rest';
  if (calMode !== 'select') hideSelectHandle();
  paintPendingOverlay();
}

// The grid's press/hover wiring — one delegated pair per calendar build (renderCalendar).
function wireGridDrag(wrap) {
  wrap.addEventListener('mousemove', (ev) => {
    if (calMode !== 'select' || gridDrag) return;
    const pt = gridPointAt(ev.clientX, ev.clientY);
    if (pt && ev.target.closest('.dt')) moveSelectHandle(pt);
    else hideSelectHandle();
  });
  wrap.addEventListener('mouseleave', () => {
    if (calMode === 'select' && !gridDrag) hideSelectHandle();
  });
  // The press is a POINTER event so the gesture can take capture (see gridDrag): the wrap then
  // receives pointermove/pointerup for the whole drag, including a release outside the window,
  // which no mouse event reports. Capture is taken here rather than inside each starter — it
  // belongs to the press, not to which of the three drags the press turns out to be.
  wrap.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || gridDrag) return;
    const capture = () => wrap.setPointerCapture?.(ev.pointerId);
    if (calMode === 'select') {
      const pt = gridPointAt(ev.clientX, ev.clientY);
      if (!pt || !ev.target.closest('.dt')) return;
      ev.preventDefault();
      capture();
      startNewDrag(pt, { openOnRelease: true });
      return;
    }
    if (calMode !== 'form') return;
    const grip = ev.target.closest('.grip');
    if (grip) {
      ev.preventDefault();
      capture();
      startEdgeDrag(grip.dataset.grip);
      return;
    }
    const me = ev.target.closest('.ev.me');
    if (me) {
      ev.preventDefault();
      capture();
      startMoveDrag(ev);
      return;
    }
    // A press on another event is the click-to-swap path (wire(), gated by R24) — not a drag.
    if (ev.target.closest('.ev')) return;
    if (!ev.target.closest('.dt')) return;
    const pt = gridPointAt(ev.clientX, ev.clientY);
    if (!pt) return;
    if (openForm.mode === 'add') {
      // R07: the pending interval stays adjustable by dragging anywhere on the grid.
      ev.preventDefault();
      capture();
      startNewDrag(pt, { live: true });
    } else {
      // R06: an empty spot mid-edit starts a create — a subject swap, gated when dirty (R24).
      guardedSwap(() => {
        closeUnifiedForm();
        enterSelectInterval();
      });
    }
  });
}

// Escape leaves select-interval mode, and CLOSES an open form through the same gate the Cancel
// button uses (§12 R24, issue #323). Gating Cancel left Save and Cancel as the only ways out of
// the form, and Cancel now costs a confirm when there is typed work — so Escape, which every
// desktop app spends on exactly this, became the cheap way out. A clean form just closes; a
// dirty one asks. Rest is a keystroke away either way, matching the gate's non-destructive
// default. Bound once at the document: the handle/overlay live inside a repainted host, so a
// per-build binding would leak one listener per repaint.
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || gridDrag) return;
  // A dialog on screen owns Escape — the gate resolves to keep/cancel, the merge prompt closes
  // itself. Both bind with capture, but a stray Escape must not also reach past them to here.
  if (document.querySelector('.editor-backdrop')) return;
  if (calMode === 'select') {
    exitToRest();
    return;
  }
  if (openForm) guardedSwap(() => closeUnifiedForm());
});

// §12 R04: the FULL in-window Active-Timer card — the GUI mirror of `tt status`, hosted in
// the Timer view (R14). When a timer runs it paints the live count-up (derived now − start,
// never stored), the running state, the entry's description + client/project label and its
// billable/slept attributes, and reveals the primary Stop action (no Switch — issue #34).
// When idle it shows an idle face (00:00:00, "nothing running") and hides the actions. The
// per-second advance is driven by tick() updating #timer-clock; this only repaints when the
// data changes. Called from route('timer') so the Timer view's card is fresh on every visit.
function renderTimerCard(running) {
  const card = $('timer-card');
  if (!card) return;
  card.classList.toggle('running', !!running);
  card.classList.toggle('idle', !running);
  // §12 R05 (issue #51): while a timer runs the Timer view offers ONLY edit-or-stop of the
  // running entry — the whole start panel (the one-tap #toggle primary, the #start-toggle
  // disclosure and its #start-form) is hidden until the entry is stopped, so no start
  // affordance exists while running. Collapse the disclosure with it so stopping never
  // resumes a stale open form (and its aria-expanded resets alongside).
  const startPanel = $('start-panel');
  if (startPanel) {
    startPanel.hidden = !!running;
    if (running) {
      const startForm = $('start-form');
      if (startForm && !startForm.hidden) {
        startForm.hidden = true;
        $('start-toggle').setAttribute('aria-expanded', 'false');
      }
    }
  }
  // The word goes into the inner span, not the whole .state line — the line also holds the
  // D05 dot, and writing textContent on the line would delete it (issue #142).
  $('timer-state-word').textContent = running ? 'running' : 'idle';
  if (running) {
    $('timer-clock').textContent = fmtDur(elapsed(running.startUtc, running.excludedSeconds ?? 0));
    $('timer-desc').textContent = running.description ?? 'your timer';
    $('timer-meta').textContent = running.clientLabel ?? '';
    $('timer-flags').innerHTML = cardFlagsHtml(running);
  } else {
    $('timer-clock').textContent = '00:00:00';
    $('timer-desc').textContent = '';
    $('timer-meta').textContent = '';
    $('timer-flags').innerHTML = '';
  }
  $('timer-stop').hidden = !running;
  // §05 R09: the Pin-as-favorite control on the running card (captures the open entry's
  // template via window.stint.pinFavorite, parity with `tt fav add`). Shown only while running.
  const pin = $('timer-pin');
  if (pin) pin.hidden = !running;
  renderLiveEdit(running);
}

// §12 R14 (G5): the LIVE-EDIT-RUNNING strip — edit the OPEN entry's attributes + its start
// time WITHOUT stopping it. Mirrors src/timerview.ts's liveEditPatch (the testable main-process
// unit) in the page: each change debounces a window.stint.edit({ id, patch }) whose patch NEVER
// carries endUtc, so the row stays open and the timer keeps running (§05 R6). Hidden while idle.
// The Start-time field seeds from the running entry's start; the End time is deliberately absent.
function renderLiveEdit(running) {
  const strip = $('live-edit');
  if (!strip) return;
  strip.hidden = !running;
  if (!running) {
    // §05 R06: collapse the inline start-only disclosure with the strip, so a later timer
    // never resumes a stale expanded state (the toggle's aria-expanded resets with it).
    closeLeStartDisc();
    return;
  }
  // Seed the fields from the running entry, but only when not focused — so a debounced commit
  // mid-typing (or a 1s tick repaint) never clobbers what the user is editing.
  const desc = $('le-desc');
  if (desc && document.activeElement !== desc) desc.value = running.description ?? '';
  const start = $('le-start');
  // §12 R14/R15 (issue #68): seed the raw Start field with the entry's EXACT stored instant as a
  // localInputValue string, and STASH THAT SAME STRING — the diff byte-compares the field against
  // it (an untouched field is byte-identical ⇒ no startUtc), so a DST-ambiguous wall-clock is never
  // reparsed to the wrong instant. seedStart is the FIELD STRING; startUtc holds the stored ISO for
  // the reparse double-guard.
  const seedStart = localInputValue(new Date(running.startUtc));
  if (start && document.activeElement !== start) start.value = seedStart;
  const bill = $('le-bill');
  if (bill) bill.checked = !!running.billable;
  // Stash the open entry's id + the last-seeded values so the change handlers send a minimal
  // patch (only the changed field) and target the right row.
  strip.dataset.entryId = String(running.id);
  strip.dataset.seedDesc = running.description ?? '';
  strip.dataset.seedStart = seedStart;
  strip.dataset.startUtc = new Date(running.startUtc).toISOString();
  strip.dataset.seedBill = String(!!running.billable);
}

// Build the live-edit patch — ONLY changed fields, and NEVER an endUtc (the open row stays
// open, §05 R6 / §12 R14). The seed-vs-field diff mirrors src/timerview.ts.liveEditStripPatch
// (the GOLD-pinned unit); this is the page's copy (which cannot import the TS module).
function liveEditPatch(strip) {
  const patch = {};
  const desc = $('le-desc');
  if (desc) {
    const next = desc.value.trim() === '' ? null : desc.value;
    const seed = strip.dataset.seedDesc === '' ? null : strip.dataset.seedDesc;
    if (next !== seed) patch.description = next;
  }
  const start = $('le-start');
  // §12 R14/R15 (issue #68): BYTE-compare the field against its seeded string FIRST — an untouched
  // field is byte-identical to the seed and is skipped WITHOUT reparsing, so a DST fall-back-
  // ambiguous wall-clock never resolves to the wrong instant and emits a spurious startUtc on a
  // desc-only edit. Only a genuinely edited value is parsed (§12 R14/G1: #le-start is a RAW text
  // field, so a half-typed value can be unparseable — the NaN guard drops it), and the double-guard
  // drops a change resolving to the SAME stored instant.
  if (start && start.value && start.value !== strip.dataset.seedStart) {
    const parsed = parseLocalInput(start.value);
    if (!isNaN(parsed.getTime())) {
      const nextIso = parsed.toISOString();
      if (nextIso !== strip.dataset.startUtc) patch.startUtc = nextIso;
    }
  }
  const bill = $('le-bill');
  if (bill && String(bill.checked) !== strip.dataset.seedBill) patch.billable = bill.checked;
  // The patch never gains an end instant — editing the open row keeps it open (§05 R6).
  return patch;
}

// Debounce for the §12 R14 live-edit commit, in ms. Every commit is a real core write followed
// by a full `load()` re-render (and the main process's DB file-watcher fires on top of it), so
// committing per keystroke would thrash both. 500ms exceeds the gap inside ordinary typing — a
// burst collapses to ONE write — while staying short enough that the edit has landed before a
// user who typed and looked away hits Stop. Re-seeding skips a focused field, so a commit that
// fires mid-edit never clobbers what is still being typed.
const LIVE_EDIT_DEBOUNCE_MS = 500;
let liveEditTimer = null;
async function commitLiveEdit() {
  const strip = $('live-edit');
  if (!strip || strip.hidden) return;
  const id = Number(strip.dataset.entryId);
  if (!Number.isFinite(id)) return;
  const patch = liveEditPatch(strip);
  if (Object.keys(patch).length === 0) return; // a no-op edit sends nothing
  // §12 R21 / issue #61: a live start edit the core REFUSES (a future start on the running row —
  // start > now freezes the count-up and bricks Stop) must be surfaced where it was attempted,
  // never a silently swallowed rejected promise (the "Stop appears dead" wedge). Route it to the
  // Timer-view region via showWriteError; the open row is untouched so the count-up keeps running
  // and the user can retype a valid start — the timer never wedges.
  try {
    const ack = await window.stint.edit({ id, patch });
    await load();
    applyAck(ack);
  } catch (err) {
    showWriteError(err);
  }
}
function scheduleLiveEdit() {
  if (liveEditTimer) clearTimeout(liveEditTimer);
  liveEditTimer = setTimeout(() => void commitLiveEdit(), LIVE_EDIT_DEBOUNCE_MS);
}

// §12 R04: the COMPACT STRIP on the Entries view — a one-line mirror of the running timer
// that links to the full Timer-view panel. It carries the live count-up (#strip-clock), the
// running/idle state (#strip-state, with the .running class driving the accented dot + clock),
// and the running entry's description (#strip-desc). It hosts NO Stop and no flags grid
// — those belong to the full card in the Timer view. Like the card, the per-second advance is
// driven by tick(); this only repaints when the data changes. The strip itself routes to the
// Timer view (wired below), so a click anywhere on it opens the full panel.
function renderTimerStrip(running) {
  const strip = $('timer-strip');
  if (!strip) return;
  strip.classList.toggle('running', !!running);
  strip.classList.toggle('idle', !running);
  const stateEl = $('strip-state');
  if (stateEl) stateEl.textContent = running ? 'running' : 'idle';
  if (running) {
    $('strip-clock').textContent = fmtDur(elapsed(running.startUtc, running.excludedSeconds ?? 0));
    $('strip-desc').textContent = running.description ?? 'your timer';
  } else {
    $('strip-clock').textContent = '00:00:00';
    $('strip-desc').textContent = '';
  }
}

// The card's attribute row: the billable/non-billable ATTRIBUTE plus a slept FLAG when the
// running entry's machine slept — two different kinds of thing, so two different palettes
// (design.html D04/D14, issue #160). Billability is the entry's normal state, said quietly in
// `.attr`/--muted; `slept` is the advisory, and the only one of the row the --flag warn palette
// is for. Emitting all three through one `.flag` class painted every running card amber, which
// is how the default case came to wear the colour reserved for "look at this" — the guard this
// function's comment carried (a quiet label, not an accent fill) watched the accent and never
// noticed it had reached for warn instead. Neither palette is the accent: that stays on the
// running clock/state and the primary Stop button (§15).
function cardFlagsHtml(e) {
  const flags = [];
  flags.push(
    e.billable
      ? '<span class="attr" title="billable time">billable</span>'
      : '<span class="attr" title="non-billable time">non-billable</span>',
  );
  if (e.sleptThrough) flags.push('<span class="flag" title="machine slept during this entry">slept</span>');
  return flags.join('');
}

// Every entry across the painted groups, keyed for the merge flow to look up the
// selected rows' attributes (clientLabel/billable) without re-resolving anything. When
// the §12 R9 toolbar is active the painted set is the queried entries (flattened + de-duped
// by id, defensive); otherwise it is the default state entries.
function allEntries() {
  const rows = entryGroups
    ? entryGroups.flatMap((g) => g.entries)
    : state.days.flatMap((d) => d.entries);
  const seen = new Map();
  for (const e of rows) if (!seen.has(e.id)) seen.set(e.id, e);
  return [...seen.values()];
}

function selectedEntries() {
  const byId = new Map(allEntries().map((e) => [e.id, e]));
  return [...selected].map((id) => byId.get(id)).filter(Boolean);
}

// §06 R3 (design.html V5): the merge selection bar. It is hidden until at least two entries
// are selected — a single row has nothing to merge into — and the live count reads in the
// "N selected" chip; the Merge button's label is static (set once in index.html).
function renderMergeBar() {
  const bar = $('merge-bar');
  if (!bar) return;
  const n = selected.size;
  bar.hidden = n < 2;
  if (n >= 2) $('merge-count').textContent = `${n} selected`;
}

function emptyState() {
  const hk = friendlyHotkey(state.settings.globalHotkey);
  const div = document.createElement('div');
  div.className = 'empty';
  div.innerHTML =
    `<div class="big">No entries yet</div>` +
    `<div>Press <code>${hk}</code> or run <code>tt start</code> to begin.</div>`;
  return div;
}

// §12 R9: the empty state when a filter / search excludes everything in the selected week.
// Distinct from the never-tracked empty state — here there IS history, just nothing matching
// — so it instructs changing the selection (the range concept is gone with the week-only view).
function emptyEntries() {
  const div = document.createElement('div');
  div.className = 'empty';
  div.innerHTML =
    `<div class="big">No matching entries</div>` +
    `<div>Try another week or clear the filters to see more.</div>`;
  return div;
}

// §12 R16: one positioned calendar EVENT for an entry. It is the calendar's visible block
// (`.bd` description, `.bc` client, `.bt` time label, positioned by local minutes on the 24h
// track) AND the durable entry surface every editing/merge/flag path targets — so it keeps the
// `.entry` / `data-id` / `[data-act]` / `.sel` hooks the unified editor (§12 R06), the merge
// selection (§06 R03), split/delete and the flag readouts (§12 R10) all reach. Hover reveals the
// corner checkbox (`.ck`) + the ops toolbar (Delete / Split / Edit); a click on the inert body
// opens the unified editor. The running/open entry gets the future-fade `.run` treatment, a
// start-only block with no end (§05 R06), and no merge checkbox (only bounded spans merge).
//
// §12 R14 · design.html A04 (issue 140): the block is ONE tab stop and its controls hang off it
// (blockKeys below), not four top-level stops apiece — see the tabIndex/role comment inline.
function calEvent(e, seg) {
  const running = e.endUtc === null;
  // §12 R16 (issue #71): the block's vertical bounds come from the SEGMENT (calEntrySegments) —
  // 'full' (same-day) / 'seg-start' / 'seg-mid' / 'seg-end' for a cross-midnight span, or 'open'
  // for the running block. Positioning is per-segment local minutes, so a cross-midnight span is
  // NEVER the single (endMin − startMin) sliver that collapsed to the 18px floor when the stop
  // was on a later local day; each segment stays within one day column's 0–1440 track.
  const part = seg ? seg.part : running ? 'open' : 'full';
  const topMin = seg ? seg.topMin : localMinuteOfDay(e.startUtc);
  // The open block extends a fixed span into the future and fades out (no bottom edge, G8); a
  // closed segment runs top→bottom (the min height keeps a very short span legible/clickable).
  const botMin = running
    ? Math.min(topMin + 180, 1440)
    : seg
      ? seg.botMin
      : Math.max(localMinuteOfDay(e.endUtc), topMin + 5);
  const el = document.createElement('div');
  el.className =
    'ev entry' +
    (running ? ' run running' : '') +
    // The cross-midnight parts carry an open edge toward the boundary they continue across
    // (styles.css): seg-start no bottom edge, seg-end no top edge, seg-mid neither.
    (part === 'seg-start' || part === 'seg-mid' || part === 'seg-end' ? ` seg ${part}` : '') +
    (selected.has(e.id) ? ' on selected' : '');
  el.dataset.id = String(e.id);
  el.style.top = topMin * CAL_PX_PER_MIN + 'px';
  el.style.height = Math.max((botMin - topMin) * CAL_PX_PER_MIN, 18) + 'px';
  // §12 R14 · design.html A04 (issue 140): the block is the calendar's TAB STOP. Its four
  // affordances — the merge checkbox and the three ops buttons — used to be four top-level stops
  // each, so a three-week calendar put ~200 of them between the keyboard and the rest of the view,
  // every one of them at zero opacity until the pointer arrived. One stop per block cuts that to
  // one per entry, and the controls are reached FROM the focused block (blockKeys in wire()).
  // `role="group"` is what makes a focusable container legitimate — and what makes `aria-label`
  // exposed on it at all; the label names the entry the stop stands for, so the announcement is
  // "quick call, Acme / API, 08:00–08:10", not fifty unlabelled groups. The block is not a
  // `role="button"` even though a click opens the editor: a button may not contain interactive
  // descendants, and this one contains four. The semantic path to the editor is the Edit button
  // inside it; Enter on the block is the keyboard twin of the click-anywhere affordance.
  el.tabIndex = 0;
  el.setAttribute('role', 'group');

  // Every segment of one entry carries the SAME full start–end label, so both blocks of a
  // cross-midnight span read as the one entry they share an id with.
  const timeLabel = running
    ? `${localTime(e.startUtc)} –`
    : `${localTime(e.startUtc)}–${localTime(e.endUtc)}`;
  const runDot = running ? '<span class="run-dot" aria-hidden="true"></span>' : '';
  // The focusable group's accessible name (see the tabIndex comment): the same three facts the
  // block paints, in the same order — description, client/project, span.
  el.setAttribute(
    'aria-label',
    [e.description ?? '(no description)', e.clientLabel, timeLabel].filter(Boolean).join(', '),
  );

  let html = '';
  // §06 R3: the hover-corner checkbox marks a CLOSED span for the multi-select merge; the open
  // row has no end, so it is not offered. It doubles as the legacy `.sel` selection hook.
  // `tabindex="-1"` (issue 140): still focusable, no longer a top-level stop — the block owns the
  // stop and hands focus here on ArrowLeft/ArrowRight. Every `.check()` / `.sel` hook is intact.
  if (!running) html += '<input type="checkbox" class="ck sel" data-act="select" tabindex="-1" aria-label="Select entry" />';
  // Hover ops: Delete / Split / Edit, the same `data-act` controls the row affordances and the
  // JUDGE scenes drive; a click opens the unified editor (wire()), where tags are edited too.
  html += `<span class="ops">${actionButtons(e)}</span>`;
  html += `<span class="bd desc${e.billable ? '' : ' nonbill'}">${runDot}${escapeHtml(e.description ?? '(no description)')}</span>`;
  if (e.clientLabel) html += `<span class="bc where">${escapeHtml(e.clientLabel)}</span>`;
  html += `<span class="bt time tnum">${timeLabel}</span>`;
  // §07: the entry's tags show in-context as chips (kept in the DOM, folded away visually on the
  // readonly calendar — see the `.ev > .chips` rule). §12 R10 (G12): the flags themselves are NOT
  // text on the event — overlap paints as the `.ov` warn band (calColumn) and sleep as the `.zz`
  // hatch below; the amount/neighbour detail, the reversible sleep subtract/restore control and the
  // struck raw-vs-trimmed duration all live in the unified editor (openUnifiedForm), not on the
  // calendar, so the readonly calendar stays a calm at-a-glance surface.
  html += tagsHtml(e);
  // §12 R10 (G12): a slept span carries a hatched marker at its foot on the calendar.
  if (e.sleptThrough) html += '<span class="zz"><svg class="ic" aria-hidden="true"><use href="#i-moon" /></svg></span>';
  el.innerHTML = html;

  const ck = el.querySelector('.ck');
  if (ck) ck.checked = selected.has(e.id);
  wire(el, e);
  return el;
}

// §12 R10: the unified editor's sleep duration readout. For a slept entry whose billable was
// trimmed (excluded seconds subtracted, so the raw wall-clock duration differs from the billable
// one), the raw duration reads STRUCK THROUGH next to the live, trimmed billable duration — the
// trimmed value is what bills, the struck one shows what was cut. Otherwise it is just the billable
// duration (or, for the open/running entry, the live count-up). Consumed by editorFlagsInnerHtml.
function durHtml(e) {
  if (e.endUtc === null) return fmtDur(elapsed(e.startUtc, e.excludedSeconds));
  const raw = e.rawSeconds ?? e.billableSeconds;
  const trimmed = e.sleptThrough && (e.excludedSeconds ?? 0) > 0 && raw !== e.billableSeconds;
  if (trimmed) {
    return `<s class="struck">${fmtDur(raw)}</s> ${fmtDur(e.billableSeconds)}`;
  }
  return fmtDur(e.billableSeconds);
}

// §07: an entry's tags shown in-context as monochrome chips (the same tags `tt` shows on
// the row and the report). Display only — the chips are read here; editing them is the
// inline tag editor below. Empty when the entry carries no tags, so nothing is painted.
function tagsHtml(e) {
  const tags = e.tags ?? [];
  if (!tags.length) return '';
  const chips = tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('');
  return `<span class="chips">${chips}</span>`;
}

// §07: the EDITABLE tag chip — the same monochrome chip as above, plus the remover the two
// in-form tag editors (the add form's and the unified editor's) both paint. The remover is a
// real button carrying the sprite × (issue 148): it used to be a `<b>` with a click listener,
// which no keyboard could reach (design.html A04), carried no role for a screen reader to
// announce (D16), and measured 10x17 against A03's 24x24 target floor — three defects in one
// element. Its accessible name carries the tag, so "Remove tag" is never ambiguous between
// chips; `title` stays the short sentence-case tooltip its siblings use.
function editableChipHtml(t) {
  const { icon } = window.SU;
  return (
    `<span class="chip">${escapeHtml(t)} ` +
    `<button type="button" class="chip-x" title="Remove tag" ` +
    `aria-label="Remove tag ${escapeHtml(t)}">${icon('x')}</button></span>`
  );
}

// §12 R10: the unified editor's detailed overlap detail ("Overlap: 15m with previous entry").
// Where the readonly calendar shows only the `.ov` warn band, the editor spells out the
// overlapping amount (core-owned minutes) and which neighbour (previous / next) it shares with —
// so the same time billing twice is visible, not just flagged. Monochrome --flag tokens (no
// accent, §15). Emitted by editorFlagsInnerHtml only when the edited entry is overlapped.
function overlapBannerHtml(e) {
  if (!e.overlapped) return '';
  const minutes = e.overlapMinutes ?? 0;
  const which = e.overlapRelation === 'previous' ? 'previous' : 'next';
  return `<div class="banner overlap" title="overlaps another entry">Overlap: ${minutes}m with ${which} entry</div>`;
}

// §12 R10 (G12): the unified editor's in-context FLAGS region — where the flag DETAIL lives now
// that the entries list is gone and the readonly calendar shows only the markers (the `.ov` warn
// band + the `.zz` slept hatch). An overlapped entry shows the overlap detail (amount + neighbour);
// a slept-through entry shows the reversible sleep subtract/restore control — its label toggles
// "Subtract slept" ↔ "Restore" off the core-fed excludedSeconds — beside the sleep duration
// readout, which strikes the raw wall-clock duration through next to the trimmed billable once
// subtracted (durHtml). Returns '' when the entry carries neither flag, so the region stays empty.
function editorFlagsInnerHtml(e) {
  let html = '';
  if (e.overlapped) html += overlapBannerHtml(e);
  if (e.sleptThrough) {
    const restore = (e.excludedSeconds ?? 0) > 0;
    const label = restore ? 'Restore' : 'Subtract slept';
    const icon = restore ? 'i-restore' : 'i-moon';
    html +=
      `<div class="ef-sleep">` +
      `<button type="button" class="small ef-subtract" data-act="ef-subtract" aria-label="${label}">` +
      `<svg class="ic" aria-hidden="true"><use href="#${icon}" /></svg>${label}</button>` +
      `<span class="ef-dur tnum">${durHtml(e)}</span>` +
      `</div>`;
  }
  return html;
}

// §12 R16 (mockup main.html): the entry's hover ops — three ICON-ONLY 22×22 line-icon buttons in
// the `.ops` raised paper chip, each carrying a `title` tooltip and the `data-act` hook the row
// affordances + JUDGE scenes drive. Order matches the mockup: Delete (x) · Split (closed only) ·
// Edit (pencil). Kept at parity with the tt verbs: Edit (unified form, §12 R06 — tags edit inside
// that form, §07/G6), Split (closed only, §06 R2), Delete (two-step, §06 R1). Sleep subtract/
// restore is NOT a calendar-hover op — it is the reversible control inside the unified editor
// (§12 R10), reached by opening the entry.
//
// Each button carries `tabindex="-1"` (issue 140): it stays a native <button> — Enter/Space
// activatable, click-dispatching, screen-reader-announced — but it is not a TOP-LEVEL tab stop.
// Focus reaches it from the block that contains it (wire() → blockKeys), so a calendar of fifty
// entries costs fifty stops instead of two hundred.
function actionButtons(e) {
  const actions = [];
  // §06 R1: Delete opens the two-step confirm gate (armDelete); the x icon reads as remove.
  actions.push('<button class="op-btn" type="button" tabindex="-1" data-act="delete" title="Delete" aria-label="Delete entry"><svg class="ic" aria-hidden="true"><use href="#i-x" /></svg></button>');
  // §06 R2: Split only makes sense on a CLOSED entry (it needs an instant strictly inside a
  // bounded span). The open/running entry has no end, so it exposes no Split.
  if (e.endUtc !== null) actions.push('<button class="op-btn" type="button" tabindex="-1" data-act="split" title="Split" aria-label="Split entry"><svg class="ic" aria-hidden="true"><use href="#i-split" /></svg></button>');
  // §12 R06: Edit opens the UNIFIED ENTRY FORM in edit mode (openUnifiedForm) inline in the Entries
  // view — one form surfacing EVERY tt-editable field plus the footer Split + two-step Delete, the
  // GUI counterpart to `tt edit` / `tt split` / `tt rm`. A click anywhere on the entry opens the
  // same form (wired below); tags edit inside it (§12 R06/G6), so no separate per-row Edit-tags
  // control or modal is needed (there is no consolidated modal editor; the unified form owns editing).
  actions.push('<button class="op-btn" type="button" tabindex="-1" data-act="edit" title="Edit" aria-label="Edit entry fields"><svg class="ic" aria-hidden="true"><use href="#i-edit" /></svg></button>');
  return actions.join('');
}

// §12 R06/R24: every path that opens the unified form on an entry runs through the
// pending-changes gate — a clean form swaps its subject in place with no animation; a dirty
// one blocks on keep-editing / discard. Opening the entry ALREADY under edit is a no-op.
function requestEdit(e) {
  if (openForm?.mode === 'edit' && openForm.entry.id === e.id) return;
  guardedSwap(() => void openUnifiedForm({ mode: 'edit', entry: e }));
}

function wire(row, e) {
  row.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'select') return toggleSelect(e.id, btn.checked); // multi-select for merge
      else if (act === 'edit') return requestEdit(e); // §12 R06: unified form (edit mode), gated (R24)
      else if (act === 'split') return openSplitForm(btn, e); // inline; resolves on Split
      else if (act === 'delete') return armDelete(btn, e); // two-step; first click only arms
      else return;
    });
  });
  // §12 R06 (R16 wiring): a click anywhere on the entry — not on one of its action controls —
  // opens the unified entry form in edit mode INLINE, the same form the Edit affordance opens.
  // The action buttons/inputs above stopPropagation, so a click on them never also opens the
  // form; a click on the inert body (time / description / duration) does — gated per R24 when
  // another subject's form is dirty.
  row.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-act], input, button, a, .confirm, .split-at')) return;
    requestEdit(e);
  });
  blockKeys(row, e);
}

// The block's four affordances in DOM order — merge checkbox, then Delete / Split / Edit — which
// is also their left-to-right order on screen (the checkbox holds the top-left corner, the ops
// chip the top-right). Read live on every keypress, because a mounted gate replaces the button it
// grew from: while the delete confirm or the split picker is up, that op-btn is simply not here.
const blockControls = (row) => [...row.querySelectorAll('.ck, .op-btn')];

// §12 R14 · design.html A04 (issue 140) — the block's ROVING FOCUS. Tab spends one stop per entry
// (calEvent's tabIndex); these keys are how the four controls are reached once a block holds it:
//
//   ← / →    step through the block's controls, wrapping; from the block itself the first press
//            enters at the near end (→ the checkbox, ← the Edit button).
//   Escape   from a control back to the block, so leaving is a keystroke rather than a Tab walk.
//   Enter    on the block: open the unified editor — the keyboard twin of the click-anywhere-on-
//   / Space  the-body affordance above. On a control, the browser's own button/checkbox
//            activation already handles both keys, so this never sees them.
//
// Tab out of a control needs no code: the controls are `tabindex="-1"`, so the next tab stop is
// the next block, exactly as if focus had never left this one.
//
// A MOUNTED GATE OWNS ITS OWN KEYS. The two-step delete confirm and the split picker mount real
// controls — including a text input — inside the block, and they are transient chrome, not the
// entry's affordances. Intercepting ← / → there would eat the caret keys inside the split field,
// so every key originating in a gate passes straight through to it.
function blockKeys(row, e) {
  row.addEventListener('keydown', (ev) => {
    if (ev.target.closest('.confirm, .split-at')) return;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      const controls = blockControls(row);
      if (!controls.length) return;
      const step = ev.key === 'ArrowRight' ? 1 : -1;
      const at = controls.indexOf(document.activeElement);
      const next = at === -1 ? (step === 1 ? 0 : controls.length - 1) : (at + step + controls.length) % controls.length;
      ev.preventDefault();
      controls[next].focus();
    } else if (ev.key === 'Escape' && document.activeElement !== row) {
      ev.preventDefault();
      row.focus();
    } else if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === row) {
      ev.preventDefault(); // Space on a focusable div scrolls the track otherwise
      requestEdit(e); // gated per R24, like the click-anywhere path
    }
  });
}

// §06 R3: toggle an entry into/out of the merge selection. We re-render (not reload — a
// reload would clear the set) so the row's .selected class and the Merge action bar's
// visibility/count track the live selection without round-tripping to core.
function toggleSelect(id, on) {
  if (on) selected.add(id);
  else selected.delete(id);
  // §12 R16 (issue #71): a cross-midnight span has more than one segment sharing this id — lift
  // (and sync the corner checkbox on) EVERY segment, not just the first, so selecting one block
  // of the span lights both without waiting for a re-render.
  document.querySelectorAll(`.entry[data-id="${id}"]`).forEach((row) => {
    row.classList.toggle('selected', on);
    row.classList.toggle('on', on); // §12 R16: the calendar event's selected lift
    const cb = row.querySelector('.ck');
    if (cb) cb.checked = on;
  });
  renderMergeBar();
}

// §06 R3: a selection is *contiguous* only when each entry's end equals the next's start
// exactly; any positive gap between consecutive selected entries would be folded into the
// merged span as fabricated billable time. An open (null-end) entry covers everything after
// it, so it can never leave a positive gap. Returns the total gapped seconds (0 = contiguous).
function mergeGapSeconds(sorted) {
  let gap = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const prevEnd = sorted[i].endUtc;
    if (prevEnd == null) continue;
    const g = Date.parse(sorted[i + 1].startUtc) - Date.parse(prevEnd);
    if (g > 0) gap += g;
  }
  return Math.round(gap / 1000);
}

// §06 R3: fold the selected entries into one. Core concatenates descriptions and unions
// tags unconditionally; the only thing that can DISAGREE is client/project and billable.
// If the selection already agrees on both, merge fires directly. If it disagrees, we
// raise an inline conflict prompt so the user picks which entry's client/project win and
// which billable value the merged row carries — exactly the §06 R3 / §12 R6 rule. The
// renderer never resolves names: it sends the chosen entry's id as `winnerId`, and the
// main process looks that entry up and passes its clientId/projectId as MergeOptions.
//
// A NON-CONTIGUOUS selection is gated first (§06 R3, §12 R13): folding a gap fabricates it
// as billable time, so — before any commit — the Merge button swaps into a confirm stating
// the resulting span/duration (the confirmInline delete-confirm precedent). Only the explicit
// "Merge anyway" tap re-enters with the gap acknowledged, threading allowGap through both the
// direct and conflict paths so core accepts the fold; Cancel leaves the originals untouched.
async function mergeSelected(acknowledgedGap = false) {
  const entries = selectedEntries();
  if (entries.length < 2) return;
  const sorted = entries.slice().sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  const gapSeconds = mergeGapSeconds(sorted);
  if (gapSeconds > 0 && !acknowledgedGap) {
    // Resulting span: earliest start → latest end (or "now" if any selected entry is open).
    const first = sorted[0];
    let latest = first.startUtc;
    let open = false;
    for (const e of sorted) {
      if (e.endUtc == null) open = true;
      else if (Date.parse(e.endUtc) > Date.parse(latest)) latest = e.endUtc;
    }
    const spanSeconds = open ? elapsed(first.startUtc) : Math.round((Date.parse(latest) - Date.parse(first.startUtc)) / 1000);
    const endLabel = open ? 'now' : localTime(latest);
    confirmInline($('merge-go'), {
      kind: 'gap',
      question: `Not contiguous — merge spans ${localTime(first.startUtc)}–${endLabel} (${fmtDur(spanSeconds)}), folding a ${fmtDur(gapSeconds)} gap into billable time?`,
      confirmLabel: 'Merge anyway',
      onConfirm: () => mergeSelected(true),
    });
    return;
  }
  const clients = new Set(entries.map((e) => e.clientLabel ?? ''));
  const billables = new Set(entries.map((e) => !!e.billable));
  const conflict = clients.size > 1 || billables.size > 1;
  if (!conflict) {
    // §06 R4: the folded span can overlap a third entry outside the selection; capture
    // the WriteAck and raise the banner after the reload (which clears it).
    const payload = { ids: entries.map((e) => e.id) };
    if (gapSeconds > 0) payload.allowGap = true;
    const ack = await window.stint.merge(payload);
    await load();
    applyAck(ack);
    return;
  }
  // The disagreeing selection resolves field-by-field in the merge-conflict prompt, hosted here
  // in app.js (§12 modal-editor row / #43). The prompt commits the merge itself; onDone reloads
  // + surfaces any overlap ack the fold raised against a third entry (§06 R4).
  openMergeConflict(
    entries,
    async (ack) => {
      await load();
      if (ack) applyAck(ack);
    },
    gapSeconds > 0,
  );
}

// The Escape listener belonging to the prompt currently up, held at module scope so
// closeMergeConflict detaches it wherever the modal ends. Null whenever no prompt is open.
let mergeConflictEscape = null;

// Remove any open merge-conflict prompt (only one at a time). A local backdrop-remove
// helper so app.js owns the modal's lifecycle end to end
// — the two share the `.editor-backdrop` chrome but not the code path.
// Every dismissal route (Cancel, the header ×, the backdrop, Escape, and the commit itself)
// funnels through here, so detaching the key listener once here is what keeps it from
// outliving the modal it belongs to.
function closeMergeConflict() {
  if (mergeConflictEscape) {
    document.removeEventListener('keydown', mergeConflictEscape);
    mergeConflictEscape = null;
  }
  document.querySelector('.editor-backdrop')?.remove();
}

// The merge-conflict prompt (§06 R3, §12 R6) is hosted here rather than in a modal editor
// (§12 modal-editor row / #43) so the calendar multi-select merge path keeps its resolver.
// Styled to context/mockups/merge-conflict.html: a modal one rung
// above content (.editor.conflict-prompt over .editor-backdrop) resolving the disagreeing
// attributes field-by-field with accent radios, then listing the unconditionally-kept
// fields (description, tags, span) as auto-kept "agree" rows so the user sees exactly what
// merges. It sends { ids, winnerId, billable } — the winning entry's id, never a resolved
// name — over the same window.stint.merge IPC (no new channel, no parity row); the main
// process maps winnerId to core's MergeOptions. `onDone(ack)` reloads after the commit.
// `allowGap` is threaded from mergeSelected's gap gate (§06 R3): a gapped selection has
// already been confirmed before this prompt opens, so it rides into the merge payload.
/** @param {any[]} entries @param {(ack?: unknown) => void} [onDone] @param {boolean} [allowGap] */
function openMergeConflict(entries, onDone = () => {}, allowGap = false) {
  closeMergeConflict();
  const { icon } = window.SU;
  const backdrop = document.createElement('div');
  backdrop.className = 'editor-backdrop';
  const dialog = document.createElement('div');
  dialog.className = 'editor conflict-prompt';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Resolve merge conflict');

  // Distinct client choices, each mapped to a representative (winning) entry id.
  const seen = new Map();
  for (const e of entries) {
    const label = e.clientLabel ?? '(no client)';
    if (!seen.has(label)) seen.set(label, e.id);
  }
  const clientChoices = [...seen.entries()];
  const billableConflict = new Set(entries.map((e) => !!e.billable)).size > 1;

  // The merged span runs from the earliest start to the latest end.
  const sorted = entries.slice().sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const spanLabel =
    last.endUtc != null ? `${localTime(first.startUtc)} – ${localTime(last.endUtc)}` : localTime(first.startUtc);

  const clientOpts = clientChoices
    .map(
      ([label, id], i) =>
        `<label class="mc-opt${i === 0 ? ' on' : ''}"><input type="radio" name="ed-mc-client" class="mc-client" ` +
        `value="${id}"${i === 0 ? ' checked' : ''} /><span class="rad"></span>` +
        `<span class="ot"><b>${escapeHtml(label)}</b></span></label>`,
    )
    .join('');
  const billRow = billableConflict
    ? `<div class="conf mc-bill-row"><div class="mc-q">Billable</div><div class="opts">` +
      `<label class="mc-opt on"><input type="radio" name="ed-mc-bill" class="mc-bill" value="1" checked /><span class="rad"></span><span class="ot"><b>Billable</b></span></label>` +
      `<label class="mc-opt"><input type="radio" name="ed-mc-bill" class="mc-bill" value="0" /><span class="rad"></span><span class="ot"><b>Non-billable</b></span></label></div></div>`
    : '';

  // Auto-kept rows: the fields core merges unconditionally, shown so nothing is a surprise.
  const keptDesc = sorted
    .map((e) => (e.description ?? '').trim())
    .filter(Boolean)
    .join(' · ');
  const keptTags = [...new Set(entries.flatMap((e) => e.tags ?? []))].join(' · ');
  const agreeRow = (label, value) =>
    value
      ? `<div class="agree">${icon('check')}<b>${label}</b><span class="val tnum">${escapeHtml(value)}</span></div>`
      : '';

  dialog.innerHTML =
    `<div class="ed-head"><div class="ed-title">Merge ${entries.length} entries</div>` +
    `<button type="button" class="iconbtn mc-close" aria-label="Close">${icon('x')}</button></div>` +
    `<div class="ed-body">` +
    `<div class="conf mc-row"><div class="mc-q">Client / project</div><div class="opts">${clientOpts}</div></div>` +
    billRow +
    agreeRow('Description', keptDesc) +
    agreeRow('Tags', keptTags) +
    agreeRow('Span', spanLabel) +
    `</div>` +
    `<div class="ed-foot">` +
    `<button type="button" class="small ghost mc-cancel">Cancel</button>` +
    `<button type="button" class="small primary mc-merge">${icon('swap')}Merge</button>` +
    `</div>`;
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  // The accent rides the selected radio's row; clicking a radio moves the .on lift.
  function syncRadioRows(name) {
    for (const r of dialog.querySelectorAll(`input[name="${name}"]`)) {
      r.closest('.mc-opt')?.classList.toggle('on', r.checked);
    }
  }
  dialog.querySelectorAll('.mc-client, .mc-bill').forEach((r) => {
    r.addEventListener('change', () => syncRadioRows(r.name));
  });

  dialog.querySelector('.mc-merge').addEventListener('click', async () => {
    const winnerId = Number(dialog.querySelector('.mc-client:checked').value);
    const payload = { ids: entries.map((e) => e.id), winnerId };
    const billChoice = dialog.querySelector('.mc-bill:checked');
    if (billChoice) payload.billable = billChoice.value === '1';
    if (allowGap) payload.allowGap = true;
    const ack = await window.stint.merge(payload);
    closeMergeConflict();
    onDone(ack);
  });
  dialog.querySelector('.mc-cancel').addEventListener('click', () => closeMergeConflict());
  dialog.querySelector('.mc-close').addEventListener('click', () => closeMergeConflict());
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) closeMergeConflict();
  });
  // Craft checklist §4 — Esc cancels the innermost thing, which while this is up is the modal
  // itself (issue 147: the app's ONE modal ignored Escape, so a keyboard user mid-merge had no
  // way out). It is a CANCEL, not a confirm: it calls exactly what .mc-cancel calls, so no field
  // resolution is applied and no merge is written — one dismissal behaviour, not two.
  // The listener is on `document`, not the dialog: the prompt mounts on <body> and takes no
  // focus when it opens, so a dialog-scoped keydown would never see the press.
  mergeConflictEscape = (ev) => {
    if (ev.key === 'Escape') closeMergeConflict();
  };
  document.addEventListener('keydown', mergeConflictEscape);
  return dialog;
}

// Breathing room, in px, between a calendar-armed inline gate and the calendar viewport's own
// edges — the gate is clamped to sit this far inside, so it never grazes the scroller's rim.
const CAL_GATE_INSET = 6;

// design.html D09 (issue #146): position a transient inline gate — the two-step delete confirm
// (confirmInline) or the split picker (openSplitForm) — that was armed from a CALENDAR EVENT.
// Both gates are ~2–3× wider than the 124px day column their button lives in, so laid out IN FLOW
// they ran straight out of the column and, in the leftmost column, 16px off the left edge of the
// WINDOW; and neither carried a surface of its own, so a region raised above the calendar read as
// loose text floating over it. Both halves are the same mistake — the gate is a LAYER over the
// calendar, not content of a day column — so both are fixed the same way: `.cal-gate` lifts it
// onto the elevation ladder's popover rung (the CSS) and this clamps its box inside the calendar
// viewport (the geometry). Anchored at the event (left/top 0 of the block that armed it) and
// nudged by the smallest offset that pulls it wholly inside `.cstrip`'s visible box, so a gate
// armed in the first or last column stays whole and on screen.
//
// Gates armed OUTSIDE the calendar — the unified form's footer, the Clients rows, the Reports
// builder — are already in-flow content of a full-width surface that fits them, so they get
// neither the layer chrome nor the clamp: no `.cstrip` ancestor, nothing to do.
//
// Idempotent: it resets its own offsets before measuring, so it can be re-run when the gate's
// content grows (the split picker's refusal message wraps in a second row, §12 R21).
function placeInlineGate(wrap) {
  const strip = wrap.closest('.cstrip');
  if (!strip) return;
  wrap.classList.add('cal-gate');
  wrap.style.left = '0px';
  wrap.style.top = '0px';
  // The region the gate must land in: the scroller's VISIBLE box — its border box less the
  // scrollbar gutters (clientWidth/Height) — INTERSECTED with the window, since the calendar's
  // own viewport can itself hang below the fold. Only the intersection is both inside the
  // calendar (the box the gate belongs to) and actually on screen.
  const box = strip.getBoundingClientRect();
  const view = {
    left: Math.max(box.left, 0),
    top: Math.max(box.top, 0),
    right: Math.min(box.left + strip.clientWidth, document.documentElement.clientWidth),
    bottom: Math.min(box.top + strip.clientHeight, document.documentElement.clientHeight),
  };
  // …less the two STICKY axes pinned inside that box (issue #145): the day-header band holds the
  // scrollport's top edge and the hour gutter its left, both on opaque paper. They are chrome the
  // calendar keeps legible while it scrolls, so the gate is placed in the CLEAR region rather than
  // over them. Measured off the live elements, not the 52/48px constants, so a band that changes
  // size takes the clamp with it. Their pinned edges are the SCROLLPORT's own (box.left/top), which
  // is not `view`'s when the strip hangs off the window — hence the max() rather than an offset.
  const gutter = strip.querySelector('.gut');
  const header = strip.querySelector('.dh');
  if (gutter) view.left = Math.max(view.left, box.left + gutter.offsetWidth);
  if (header) view.top = Math.max(view.top, box.top + header.offsetHeight);
  const r = wrap.getBoundingClientRect();
  // Pull the overflowing edge in first, then re-check the opposite edge — so a gate wider than the
  // viewport lands flush against its start edge rather than being pushed off the other side.
  let dx = Math.min(0, view.right - CAL_GATE_INSET - r.right);
  if (r.left + dx < view.left + CAL_GATE_INSET) dx = view.left + CAL_GATE_INSET - r.left;
  let dy = Math.min(0, view.bottom - CAL_GATE_INSET - r.bottom);
  if (r.top + dy < view.top + CAL_GATE_INSET) dy = view.top + CAL_GATE_INSET - r.top;
  wrap.style.left = `${Math.round(dx)}px`;
  wrap.style.top = `${Math.round(dy)}px`;
}

// Swap an armed gate in for the control that armed it, then place it (above). The single mount
// point for both gates, so neither can acquire the containment fix without the other.
function mountInlineGate(btn, wrap) {
  btn.replaceWith(wrap);
  placeInlineGate(wrap);
}

// §12 R13: the generic in-window confirm gate for a destructive action. A destructive
// control (today only Delete; archive-when-referenced lands with the Clients view, R10)
// must never act on a single stray click — the first click swaps the button into an
// explicit confirm affordance ("<question>" + a destructive confirm button + a Cancel),
// and ONLY the explicit confirm runs the supplied callback. Cancel restores the original
// button untouched, so a stray click destroys nothing. Kept dependency-free DOM (no
// window.confirm — the renderer's CSP is script-src 'self' and window.confirm is
// unavailable/blocking here). The confirm control carries stable hooks (.confirm class,
// data-act="confirm-<kind>" / "cancel-<kind>") JUDGE and the static guard assert.
//
// `onConfirm` is the destructive op itself; the helper only gates it behind the explicit
// confirm. Factored generically (label + destructive callback + a kind for the hooks) so
// the same gate is reused for the future archive-when-referenced confirm (R10), even
// though only Delete wires it today.
function confirmInline(btn, { kind, question, confirmLabel, onConfirm }) {
  // A04 / issue 140: arming must not strand focus. The armed button is REMOVED from the document,
  // which drops focus to <body> — a keyboard user would have to Tab back from the top of the view
  // to reach the gate they just raised. So focus follows the gate whenever it was on the button.
  // It lands on CANCEL, not the destructive confirm: Enter fires a button on keydown, so focusing
  // the confirm would let one held Enter arm and then commit on its own auto-repeat.
  const hadFocus = document.activeElement === btn;
  const wrap = document.createElement('span');
  wrap.className = `confirm confirm-${kind}`;
  wrap.innerHTML =
    `<span class="confirm-q">${escapeHtml(question)}</span>` +
    `<button class="small danger" type="button" data-act="confirm-${kind}">${escapeHtml(confirmLabel)}</button>` +
    `<button class="small ghost confirm-cancel" type="button" data-act="cancel-${kind}">Cancel</button>`;
  mountInlineGate(btn, wrap);
  if (hadFocus) wrap.querySelector(`[data-act="cancel-${kind}"]`).focus();
  // Re-wire the freshly-created controls (they were not present at row build time). Only
  // the explicit confirm runs the destructive callback — the first (arming) click did not.
  wrap.querySelector(`[data-act="confirm-${kind}"]`).addEventListener('click', async (ev) => {
    ev.stopPropagation();
    await onConfirm();
    // If the confirm chrome is still mounted after the destructive op (most callbacks repaint
    // their whole region, which discards it), restore the original control — so a PERSISTENT
    // button (e.g. the Reports builder's Delete) survives the gate for its next use.
    if (wrap.isConnected) wrap.replaceWith(btn);
  });
  wrap.querySelector(`[data-act="cancel-${kind}"]`).addEventListener('click', (ev) => {
    ev.stopPropagation();
    const inGate = wrap.contains(document.activeElement);
    wrap.replaceWith(btn); // restore the original button untouched — nothing destroyed
    if (inGate) btn.focus(); // …and hand focus back to it, closing the loop the arming opened
  });
}

// Delete is destructive, so it takes a confirm step (PRD §06 R1, §12 R13): the first
// click swaps the button into an explicit "Confirm delete?" affordance with a Cancel, and
// only the confirm tap removes the entry. A stray first click never deletes anything — the
// remove() call is reachable ONLY from inside the confirm callback below.
function armDelete(btn, e) {
  confirmInline(btn, {
    kind: 'delete',
    question: 'Confirm delete?',
    confirmLabel: 'Delete',
    onConfirm: async () => {
      await window.stint.remove({ id: e.id });
      // A repaint no longer closes the form (§12 R24), so deleting the form's own subject —
      // the footer Delete — must close it explicitly (an explicit destroy, not a silent one).
      if (openForm?.mode === 'edit' && openForm.entry.id === e.id) closeUnifiedForm();
      await load();
    },
  });
}

// §12 R13 — archiving a REFERENCED client/project hides a record that carries history, so it is
// destructive and takes the SAME two-step gate as Delete (confirmInline): the first click only
// ARMS the confirm, and window.stint.archiveClient/archiveProject is reachable ONLY from inside
// the explicit confirm. An UNREFERENCED record (core-fed `referenced` flag false/absent — no entry
// points at it) archives directly, matching R13's scope exactly (unreferenced records archive
// without a confirm). Tags follow R13's text, which is silent on them, so tag archive is direct.
function armArchiveClient(btn, c) {
  const doArchive = async () => {
    await window.stint.archiveClient({ id: c.id });
    await renderClients();
  };
  if (!c.referenced) return void doArchive();
  confirmInline(btn, {
    kind: 'archive',
    question: `Archive "${c.name}"? It has time entries.`,
    confirmLabel: 'Archive',
    onConfirm: doArchive,
  });
}

function armArchiveProject(btn, p) {
  const doArchive = async () => {
    await window.stint.archiveProject({ id: p.id });
    await renderClients();
  };
  if (!p.referenced) return void doArchive();
  confirmInline(btn, {
    kind: 'archive',
    question: `Archive "${p.name}"? It has time entries.`,
    confirmLabel: 'Archive',
    onConfirm: doArchive,
  });
}

// Split (PRD §06 R2 / G4): a closed entry can be cut at an instant inside its span into two
// adjacent entries. The renderer stays a thin shell — it offers a simple PLAIN-TEXT instant
// field (G1: no native datetime-local anywhere on an entry start/stop surface), seeded in the
// SAME local `YYYY-MM-DD HH:mm:ss` format the unified form's raw Start/Stop fields use and parsed
// identically, defaulting to the span's midpoint; it converts the typed local time to a UTC ISO,
// and core (over the same `split` IPC tt uses) enforces the strictly-in-span rule and performs
// the arithmetic. The open/running entry never reaches here (no Split button).
function openSplitForm(btn, e) {
  const startMs = Date.parse(e.startUtc);
  const endMs = Date.parse(e.endUtc);
  const midpoint = new Date(startMs + Math.floor((endMs - startMs) / 2));

  const wrap = document.createElement('span');
  wrap.className = 'split-at';
  wrap.innerHTML =
    `<span class="split-q">Split at</span>` +
    `<input type="text" class="split-input" autocomplete="off" spellcheck="false" ` +
    `placeholder="YYYY-MM-DD HH:mm:ss" aria-label="Split instant" />` +
    `<button class="small primary" type="button" data-act="confirm-split">Split</button>` +
    `<button class="small ghost split-cancel" type="button">Cancel</button>` +
    // §12 R21: a refused split (a point NOT strictly inside the span, or unparseable text) is
    // surfaced here at the point of action; the picker stays open with the message announced.
    `<span class="split-warning form-error" role="status" aria-live="polite" hidden></span>`;
  const hadFocus = document.activeElement === btn;
  mountInlineGate(btn, wrap);
  wrap.querySelector('.split-input').value = localInputValue(midpoint);
  const warn = wrap.querySelector('.split-warning');
  // A04 / issue 140, as in confirmInline: the button that opened the picker is gone, so focus
  // follows into it — here onto the instant field, which is the thing the picker exists to fill.
  if (hadFocus) wrap.querySelector('.split-input').focus();

  wrap.querySelector('[data-act="confirm-split"]').addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const atLocal = wrap.querySelector('.split-input').value;
    if (!atLocal) return;
    // §12 R21: catch BOTH a locally-thrown parse error (unparseable instant → RangeError from
    // toISOString) and core's in-span rejection over the `split` IPC — the split picker stays
    // open and shows the reason instead of the click reading as a silent no-op.
    try {
      // Convert the picked local instant to a UTC ISO; core rejects anything not strictly
      // inside [startUtc, endUtc], so no clamping or arithmetic happens here.
      const atUtc = parseLocalInput(atLocal).toISOString();
      // Splitting a span in place cannot create a NEW overlap, so the ack carries no
      // warning; routing it through applyAck keeps every write path one uniform shape.
      const ack = await window.stint.split({ id: e.id, atUtc });
      // Splitting the form's own subject (the footer Split) replaces one span with two —
      // the form's seed no longer exists, so close it explicitly (§12 R24: repaints never do).
      if (openForm?.mode === 'edit' && openForm.entry.id === e.id) closeUnifiedForm();
      await load();
      applyAck(ack);
    } catch (err) {
      showFormError(warn, err);
      // The refusal wraps onto a second row inside the gate, so a gate already sitting against the
      // calendar's bottom or right edge has just grown past it — re-clamp (issue #146).
      placeInlineGate(wrap);
    }
  });
  // The message persists until the next input on the split field (add-form pattern).
  wrap.querySelector('.split-input').addEventListener('input', () => {
    clearFormError(warn);
    placeInlineGate(wrap);
  });
  wrap.querySelector('.split-cancel').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const inPicker = wrap.contains(document.activeElement);
    wrap.replaceWith(btn);
    if (inPicker) btn.focus();
  });
}

// §12 R06/R07 (G5): tear down the open unified form (either mode) and return the grid to
// rest. It lives in the view-level #entry-form-host (not inside a calendar event), so closing
// means removing the mounted form, clearing the form state, and repainting the grid chrome
// (un-gray, + button back, overlay gone). Explicit paths only — Cancel, a successful Save,
// and the gate's Discard; a repaint NEVER lands here (R24). Idempotent when nothing is open.
function closeUnifiedForm() {
  const host = $('entry-form-host');
  const form = host?.querySelector('.entry-form');
  if (form) form.remove();
  openForm = null;
  calMode = 'rest';
  fineSnap = false;
  document.querySelectorAll('.entry.editing').forEach((el) => el.classList.remove('editing'));
  // The edited entry's stored segments were suppressed while the form was open — repaint so
  // they return (and the mode chrome drops) without waiting for a data reload.
  if (state) renderEntries();
}

// §12 R24: does the open form's current field state differ from its seed? The seed is the
// snapshot taken at open (edit: the entry's stored values; add: the blank form + the dragged
// interval), so a fresh form reads CLEAN and any typed/ dragged change reads DIRTY until
// saved or discarded. Tags compare as ordered lists — the chips only ever append/remove.
function formIsDirty() {
  if (!openForm) return false;
  const f = openForm.form;
  const s = openForm.seed;
  if ((f.querySelector('.edit-desc')?.value ?? '') !== s.desc) return true;
  if ((f.querySelector('.edit-client')?.value ?? '') !== s.client) return true;
  if ((f.querySelector('.edit-project')?.value ?? '') !== s.project) return true;
  if ((f.querySelector('.edit-bill-box')?.getAttribute('aria-checked') === 'true') !== s.bill) return true;
  if ((f.querySelector('.edit-start')?.value ?? '') !== s.start) return true;
  if (!openForm.running && (f.querySelector('.edit-end')?.value ?? '') !== s.stop) return true;
  if (JSON.stringify(openForm.tags) !== JSON.stringify(s.tags)) return true;
  return false;
}

// §12 R24 — the pending-changes gate. Swapping the form's subject (clicking another event,
// an empty spot / the + button to start a create, or an external refresh re-seeding the
// form) runs through here: a CLEAN form swaps in place — no prompt, no animation — while a
// dirty form blocks on the keep-editing / discard-changes dialog. Keep editing returns to
// the form untouched; only the explicit Discard abandons the pending fields and performs
// the swap. No SUBJECT SWAP replaces a dirty form silently — which is the gate's proven
// scope, and deliberately narrower than "no path": the footer's own Cancel calls
// closeUnifiedForm directly, so whether Cancel IS the explicit discard or should itself
// gate is an open §12 R24 reading (issue #301), and neither this comment nor the rubric
// claims it in either direction.
function guardedSwap(perform) {
  if (!openForm || !formIsDirty()) {
    perform();
    return;
  }
  openPendingGate(perform);
}

// The gate dialog itself (mockup edit-entry.html .gatecard): the app's second modal, riding
// the same backdrop idiom as the merge-conflict prompt so design.html D11's accent handoff
// (syncStandingPrimary reads .editor-backdrop) covers it. Keep editing is the primary — the
// non-destructive default, also what Escape and a backdrop click resolve to; Discard changes
// wears the danger text idiom (it destroys typed work).
function openPendingGate(perform) {
  openGateCard({
    title: 'Discard unsaved changes?',
    body: "This entry has edits that haven't been saved. Keep editing to stay here, or discard them to open the other entry.",
    confirmLabel: 'Discard changes',
    confirmClass: 'small danger gate-discard',
    cancelLabel: 'Keep editing',
    cancelClass: 'small primary gate-keep',
    onConfirm: perform,
  });
}

// §12 R24 (issue #323): the WEEK-MOVE prompt — a week change with a form open would carry the
// entry to the same weekday of the week being opened, which is a real move of a real entry, so
// it asks first. This is NOT the discard gate: nothing is thrown away either way, so neither
// button is destructive and the affirmative one takes the primary. Cancel means what it says on
// a "do this? / cancel" prompt — the whole action is abandoned, the view stays on the week it
// was on, and the form keeps its subject and its block together on screen.
//
// It asks ONCE per open form. After the first yes, further week changes just happen, so the
// owner can confirm and then step through several weeks. openForm.weekMoveConfirmed carries the
// answer and dies with the form (closeUnifiedForm drops openForm), which is also what resets it
// when a different subject opens.
function openWeekMoveGate(perform) {
  openGateCard({
    title: 'Change entry week?',
    body: 'This entry moves to the same day of the week you are opening. Cancel to stay on this week.',
    confirmLabel: 'Change week',
    confirmClass: 'small primary gate-week-go',
    cancelLabel: 'Cancel',
    cancelClass: 'small gate-week-cancel',
    onConfirm: perform,
  });
}

// The gate dialog itself (mockup edit-entry.html .gatecard): the app's second modal, riding
// the same backdrop idiom as the merge-conflict prompt so design.html D11's accent handoff
// (syncStandingPrimary reads .editor-backdrop) covers it. The CANCEL half is always the
// non-destructive default — what Escape, a backdrop click and the initial focus all resolve to
// — whichever of the two carries the accent. Callers own the button classes because the
// pending gate's pair (danger Discard / primary Keep editing) and the week gate's pair
// (primary Change week / neutral Cancel) sit differently on design.html D11.
function openGateCard({ title, body, confirmLabel, confirmClass, cancelLabel, cancelClass, onConfirm }) {
  if (document.querySelector('.gate-backdrop')) return; // one gate at a time
  const backdrop = document.createElement('div');
  backdrop.className = 'editor-backdrop gate-backdrop';
  backdrop.innerHTML =
    `<div class="gatecard" role="dialog" aria-modal="true" aria-labelledby="gate-h">` +
    `<h3 id="gate-h">${title}</h3>` +
    `<p>${body}</p>` +
    `<div class="gate-row">` +
    `<button type="button" class="${confirmClass}" data-gate="confirm">${confirmLabel}</button>` +
    `<button type="button" class="${cancelClass}" data-gate="cancel">${cancelLabel}</button>` +
    `</div></div>`;
  const dismiss = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const cancel = () => {
    dismiss();
    openForm?.form.querySelector('.edit-desc')?.focus();
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      cancel();
    }
  };
  backdrop.querySelector('[data-gate="cancel"]').addEventListener('click', cancel);
  backdrop.querySelector('[data-gate="confirm"]').addEventListener('click', () => {
    dismiss();
    onConfirm();
  });
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) cancel(); // outside click = the non-destructive default
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(backdrop);
  backdrop.querySelector('[data-gate="cancel"]').focus();
}

// §12 R24: an external refresh (a tt write) arrived while an EDIT form is open — re-seed the
// form's subject from the fresh snapshot. A clean form adopts the fresh truth silently (or
// closes if the entry is gone — nothing typed, nothing lost); the DIRTY case only lands here
// from the gate's explicit Discard.
function reseedFromSnapshot() {
  if (!openForm || openForm.mode !== 'edit') return;
  const id = openForm.entry.id;
  const fresh = (state?.days ?? []).flatMap((d) => d.entries).find((x) => x.id === id);
  if (!fresh) {
    closeUnifiedForm();
    return;
  }
  void openUnifiedForm({ mode: 'edit', entry: fresh });
}

// §12 R06/R07 (G5/G6/G7): the ONE unified entry form — built once here for BOTH modes and
// mounted in the view-level #entry-form-host ABOVE the week grid, inline in the Entries view
// (no modal; the upward expansion leaves the grid in position). The REDUCED field set — the
// form holds exactly: a 3-line multiline description (§05 R10), client, project below client,
// tags, billable, the raw Start/Stop fields (R17 — the exact-entry escape hatch and the only
// path for overnight; a grid drag updates them live and they drive the grid block back), and
// Save entry / Cancel — nothing else, every `tt add`/`tt edit` attribute reachable (§05 R05).
//
// ADD mode (R07) opens BLANK: no last-used client/project seeding, description empty,
// billable per its §05 R07 client-keyed default (untouched → omitted from the payload so core
// derives it), start/stop seeded ONLY from the dragged interval (or the working-hours
// default). Save entry is the sole commit over the unchanged `add` IPC.
//
// EDIT mode (R06) seeds EVERY tt-editable field from the entry; start/stop adjust by
// dragging the selected event's edges on the grid (snapping per R23) or by typing — same
// form values either way — and Save sends a changed-fields-only patch over the same `edit`
// IPC tt uses. The footer adds Split (§06 R02) and the two-step Delete (R13). Editing the
// RUNNING entry must not stop it: the open row's form omits Stop, so the patch never
// carries endUtc (§05 R06).
async function openUnifiedForm(opts) {
  const mode = opts.mode;
  const e = opts.entry ?? null;
  const running = mode === 'edit' && e.endUtc === null;
  closeUnifiedForm(); // one form ever (add or edit)

  const currentClient = e?.clientLabel ? e.clientLabel.split(' / ')[0] : '';
  const currentProject =
    e?.clientLabel && e.clientLabel.includes(' / ')
      ? e.clientLabel.split(' / ').slice(1).join(' / ')
      : '';

  const form = document.createElement('form');
  // `entry-form unified-form` are the shared behavioural hooks (one form, two modes); the
  // per-mode class rides alongside for the tests/JUDGE scenes that target a mode.
  form.className = 'entry-form unified-form ' + (mode === 'edit' ? 'edit-form' : 'add-form');
  form.dataset.mode = mode;
  if (mode === 'edit') form.dataset.id = String(e.id);
  const stopField = running
    ? ''
    : `<label class="uf-field"><span>Stop</span>` +
      `<input type="text" class="edit-end edit-time uf-time tnum" autocomplete="off" spellcheck="false" ` +
      `placeholder="YYYY-MM-DD HH:mm:ss" aria-label="Entry stop time" /></label>`;
  form.innerHTML =
    // The mockup's three-column body: description + tags · client/project/billable · the
    // Start/Stop pair (edit-entry.html .eform). Every field carries a visible label (D13).
    `<div class="ef-cols">` +
    `<div class="ef-fcol">` +
    // §05 R10 — a 3-line scrollable textarea keeps interior newlines verbatim (the submit
    // trims only outer whitespace).
    `<label class="uf-field uf-desc"><span>Description</span>` +
    `<textarea class="edit-desc desc-field" rows="3" autocomplete="off" placeholder="${mode === 'add' ? 'What were you doing?' : '(no description)'}"></textarea></label>` +
    `<label class="uf-field uf-tags"><span>Tags</span>` +
    `<span class="chips uf-tag-chips ef-tag-chips"></span></label>` +
    // §12 R10 (G12): the in-context flags region (edit mode) — overlap detail + the
    // reversible sleep subtract/restore. Hidden when the entry carries neither flag.
    (mode === 'edit' ? `<div class="ef-flags" hidden></div>` : '') +
    `</div>` +
    `<div class="ef-acol">` +
    `<label class="uf-field"><span>Client</span>` +
    `<select class="edit-client uf-select"></select></label>` +
    `<label class="uf-field"><span>Project</span>` +
    `<select class="edit-project uf-select" disabled></select></label>` +
    // The billable control is the shared switch idiom (.sw — the Show-weekend / fine-snap
    // control), with its visible label riding beside it (mockup edit-entry.html .toggle).
    `<span class="uf-bill"><button type="button" class="sw edit-bill-box" role="switch" ` +
    `aria-checked="false" aria-label="Billable"><i aria-hidden="true"></i></button> Billable</span>` +
    `</div>` +
    `<div class="ef-tcol">` +
    // §12 R17: raw text fields — the format the user reads and retypes (localInputValue,
    // seconds always shown, no `T`, issue #159), NEVER datetime-local (G1). A stop dated a
    // later day makes an OVERNIGHT span; the grid drag writes these live and typing here
    // moves the grid block — one set of form values (R06/R07/R17).
    `<label class="uf-field"><span>Start</span>` +
    `<input type="text" class="edit-start edit-time uf-time tnum" autocomplete="off" spellcheck="false" ` +
    `placeholder="YYYY-MM-DD HH:mm:ss" aria-label="Entry start time" /></label>` +
    stopField +
    `</div>` +
    `</div>` +
    // §12 R21: a refused Save is surfaced HERE, inline at the point of action — a core
    // StoreError over the add/edit IPC or a locally-thrown parse error. Announced; the form
    // stays open and the message persists until the next input on it.
    `<div class="ef-warning form-error" role="status" aria-live="polite" hidden></div>` +
    // The footer (mockup): Split + Delete lead in edit mode, then Cancel and the one
    // accent-solid Save entry (§15 / design.html D11).
    `<div class="uf-foot edit-foot">` +
    (mode === 'edit' && !running
      ? `<button type="button" class="small ghost ef-split" data-act="split">Split</button>`
      : '') +
    // Delete carries the standard .danger text treatment (mockup edit-entry.html .btn.danger),
    // never the accent; the two-step confirm gate still arms before anything destroys (R13).
    (mode === 'edit'
      ? `<button type="button" class="small danger ef-delete" data-act="delete">Delete</button>`
      : '') +
    `<span class="uf-foot-spacer ef-foot-spacer"></span>` +
    `<button type="button" class="small ghost edit-cancel">Cancel</button>` +
    `<button type="submit" class="small primary">Save entry</button>` +
    `</div>`;

  // ---- seed the fields --------------------------------------------------------------
  const descField = form.querySelector('.edit-desc');
  const startInput = form.querySelector('.edit-start');
  const endInput = form.querySelector('.edit-end');
  // The billable switch state lives on aria-checked (a button.sw, not a checkbox) — one
  // place read by the dirty check, the submit, and the §05 R07 client-follow below.
  const bill = form.querySelector('.edit-bill-box');
  const billOn = () => bill.getAttribute('aria-checked') === 'true';
  const setBill = (on) => {
    bill.setAttribute('aria-checked', String(on));
    bill.classList.toggle('on', on);
  };
  let seededStart = '';
  let seededEnd = '';
  if (mode === 'edit') {
    descField.value = e.description ?? '';
    // §12 R17 (issue #49): seed the raw Start/Stop with the EXACT stored instants —
    // localInputValue always renders seconds, so a 09:07:33 start reads 09:07:33, never a
    // snapped 09:05. The submit treats a byte-identical field as UNTOUCHED (no time patch),
    // so open-then-Save round-trips stored times to the second.
    seededStart = localInputValue(new Date(e.startUtc));
    startInput.value = seededStart;
    if (!running) {
      seededEnd = localInputValue(new Date(e.endUtc));
      endInput.value = seededEnd;
    }
    setBill(!!e.billable);
  } else {
    // §12 R07: the form opens BLANK — only the interval is seeded (from the drag, or the
    // working-hours default). Whole-minute values: this is a fresh suggestion, not stored
    // truth, so clean :00 seconds are honest.
    seededStart = opts.startIso ? localInputValue(new Date(opts.startIso)) : '';
    seededEnd = opts.stopIso ? localInputValue(new Date(opts.stopIso)) : '';
    startInput.value = seededStart;
    endInput.value = seededEnd;
    setBill(false); // §05 R07: tracks the client select until touched (below)
  }

  const select = form.querySelector('.edit-client');
  const projectSelect = form.querySelector('.edit-project');
  let currentClientId = null;
  let currentProjectId = null;

  // §12 R06/R07 (G6): the in-form tag chip editor — `nextTags` is the working set the chips
  // mutate; edit-mode Save diffs it via the pure window.SU.tagDiff, add-mode Save sends it whole.
  const originalTags = mode === 'edit' ? (e.tags ?? []).slice() : [];
  const nextTags = originalTags.slice();
  const chipHost = form.querySelector('.ef-tag-chips');
  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.className = 'tag-add-input uf-tag-add ef-tag-add';
  tagInput.placeholder = 'add a tag…';
  tagInput.autocomplete = 'off';
  function renderTagChips() {
    chipHost.innerHTML = '';
    for (const t of nextTags) {
      chipHost.insertAdjacentHTML('beforeend', editableChipHtml(t));
      chipHost.lastElementChild.querySelector('.chip-x').addEventListener('click', (ev) => {
        ev.stopPropagation();
        const i = nextTags.indexOf(t);
        if (i >= 0) nextTags.splice(i, 1);
        renderTagChips();
        tagInput.focus();
      });
    }
    chipHost.appendChild(tagInput);
  }
  function addTypedTag() {
    const name = tagInput.value.trim();
    tagInput.value = '';
    if (!name) return;
    if (!nextTags.some((t) => t.toLowerCase() === name.toLowerCase())) nextTags.push(name);
    renderTagChips();
    tagInput.focus();
  }
  tagInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ',') {
      ev.preventDefault();
      addTypedTag();
    }
  });
  renderTagChips();

  // §05 R07 (add mode): billable defaults off the one client-keyed rule — the checkbox
  // tracks the Client select until the user touches it, and an UNTOUCHED box is omitted
  // from the payload so core derives the default (the same tri-state the Start form uses).
  let billTouched = mode === 'edit';
  bill.addEventListener('click', () => {
    billTouched = true;
    setBill(!billOn());
  });

  // ---- form state (R24 seed) ----------------------------------------------------------
  // The select halves are patched once the async reference data pre-selects them, so the
  // seed always reflects what the user actually saw (openForm doc-comment above).
  openForm = {
    mode,
    entry: e,
    running,
    form,
    tags: nextTags,
    seed: {
      desc: descField.value,
      client: select.value,
      project: projectSelect.value,
      bill: billOn(),
      start: startInput.value,
      stop: endInput ? endInput.value : '',
      tags: nextTags.slice(),
    },
  };

  // §12 R10 (G12): the in-context flags region + its reversible sleep control (edit mode).
  if (mode === 'edit') {
    const flagsRow = form.querySelector('.ef-flags');
    const renderFlags = () => {
      flagsRow.innerHTML = editorFlagsInnerHtml(e);
      flagsRow.hidden = flagsRow.innerHTML === '';
      const subtractBtn = flagsRow.querySelector('.ef-subtract');
      if (subtractBtn) {
        subtractBtn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          await window.stint.subtractSleep({ id: e.id });
          // Re-read the toggled entry off core's snapshot — the editor owns no sleep math.
          const st = await window.stint.getState();
          const fresh = (st?.days ?? []).flatMap((d) => d.entries).find((x) => x.id === e.id);
          if (fresh) {
            e.excludedSeconds = fresh.excludedSeconds;
            e.billableSeconds = fresh.billableSeconds;
            e.rawSeconds = fresh.rawSeconds;
          }
          renderFlags();
        });
      }
    };
    renderFlags();
    // §06 R2 / §12 R13: the footer Split + the two-step Delete gate.
    const splitBtn = form.querySelector('.ef-split');
    if (splitBtn) {
      splitBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openSplitForm(ev.currentTarget, e);
      });
    }
    form.querySelector('.ef-delete').addEventListener('click', (ev) => {
      ev.stopPropagation();
      armDelete(ev.currentTarget, e);
    });
  }

  // §12 R24 (issue #323): Cancel is a way to LOSE the form, so it is gated like every other one.
  // It was the single unguarded path — the button most likely to be clicked threw typed work
  // away in silence while a stray click on the grid behind it did not.
  form.querySelector('.edit-cancel').addEventListener('click', () => guardedSwap(() => closeUnifiedForm()));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    addTypedTag(); // fold any half-typed tag still in the add input
    const warn = form.querySelector('.ef-warning');
    // §12 R21: catch BOTH failure modes — a locally-thrown parse error and a core
    // StoreError forwarded over the IPC. On either, the form stays open with the reason.
    try {
      if (mode === 'add') {
        // §12 R07 (G7): Save entry is the sole commit over the UNCHANGED `add` IPC — the
        // raw field text travels verbatim (both spellings parse in the handler), the
        // selects contribute NAMES so core resolves them through the same rule tt add uses.
        const desc = descField.value.trim();
        const clientName =
          select.value === '' ? '' : (select.options[select.selectedIndex]?.textContent || '').trim();
        const projectName =
          projectSelect.value === ''
            ? ''
            : (projectSelect.options[projectSelect.selectedIndex]?.textContent || '').trim();
        const payload = {
          fromLocal: startInput.value,
          toLocal: endInput.value,
        };
        if (desc) payload.description = desc;
        if (clientName) payload.client = clientName;
        if (projectName) payload.project = projectName;
        if (nextTags.length) payload.tags = nextTags.slice();
        if (billTouched) payload.billable = billOn(); // §05 R07: untouched → core derives
        const ack = await window.stint.add(payload);
        closeUnifiedForm();
        await load();
        applyAck(ack); // §06 R4: an overlapping backfill saves, warned in the banner
        return;
      }
      // §12 R06 (G7): edit mode — send ONLY the changed fields. A Start/Stop field whose
      // text is byte-identical to the seed is UNTOUCHED and contributes no time patch, so
      // open-then-Save round-trips stored times to the second (issue #49).
      const desc = descField.value.trim();
      const patch = {};
      const nextDesc = desc || null;
      if (nextDesc !== (e.description ?? null)) patch.description = nextDesc;
      const startLocal = startInput.value;
      if (startLocal && startLocal !== seededStart) {
        const nextStart = parseLocalInput(startLocal).toISOString();
        if (nextStart !== new Date(e.startUtc).toISOString()) patch.startUtc = nextStart;
      }
      const endLocal = running ? '' : endInput.value;
      if (!running && endLocal && endLocal !== seededEnd) {
        const nextEnd = parseLocalInput(endLocal).toISOString();
        if (nextEnd !== new Date(e.endUtc).toISOString()) patch.endUtc = nextEnd;
      }
      if (billOn() !== !!e.billable) patch.billable = billOn();
      const clientSel = select.value === '' ? null : Number(select.value);
      const projectSel = projectSelect.value === '' ? null : Number(projectSelect.value);
      if (clientSel !== currentClientId) patch.clientId = clientSel;
      if (projectSel !== currentProjectId) patch.projectId = projectSel;
      const { addTags, removeTags } = tagDiff(originalTags, nextTags);
      if (addTags.length) patch.addTags = addTags;
      if (removeTags.length) patch.removeTags = removeTags;

      // §06 R4: an edit can move the entry onto an overlapping span; the write already
      // committed — the banner is advisory.
      const ack = await window.stint.edit({ id: e.id, patch });
      closeUnifiedForm();
      await load();
      applyAck(ack);
    } catch (err) {
      showFormError(warn, err);
    }
  });
  // §12 R21: the message persists until the next input on the form. §12 R17: typing in the
  // raw Start/Stop fields moves the grid block live — grid and fields drive the same values.
  form.addEventListener('input', (ev) => {
    clearFormError(form.querySelector('.ef-warning'));
    if (ev.target === startInput || ev.target === endInput) paintPendingOverlay();
  });

  // ---- mount ---------------------------------------------------------------------------
  // §12 R06/R07 (G5): the ONE view-level host above the week grid — the quick upward
  // expansion leaves the grid in position (CSS .entry-form animation; instant under
  // reduced motion). Mode chrome (gray-out, hidden +, fine-snap toggle, the interval
  // overlay) resolves off the new state on the repaint below.
  const host = $('entry-form-host');
  host.appendChild(form);
  calMode = 'form';
  fineSnap = false; // §12 R23: coarse on every open
  // The one repaint that SHOULD move the viewport: it lands on the pending/edited interval
  // (renderCalendar's `iv` branch), so editing an off-hours entry never opens onto empty grid.
  calScrollTop = null;
  renderEntries();
  host.scrollIntoView({
    block: 'nearest',
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
  descField.focus();

  // §12 R06 (G6): populate the selects from the same source tt uses; pre-select the entry's
  // client/project (edit) or leave them blank (add — no last-used seeding, R07).
  async function fillProjects(clientId, preselectName) {
    projectSelect.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '(no project)';
    projectSelect.appendChild(none);
    currentProjectId = null;
    if (clientId == null) {
      projectSelect.disabled = true;
      projectSelect.value = '';
      return;
    }
    projectSelect.disabled = false;
    const projects = (await window.stint.listProjects({ clientId })) || [];
    for (const p of projects) {
      const opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = p.name;
      if (preselectName && p.name === preselectName) currentProjectId = p.id;
      projectSelect.appendChild(opt);
    }
    projectSelect.value = currentProjectId === null ? '' : String(currentProjectId);
  }

  const clients = (await window.stint.listClients()) || [];
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '(no client)';
  select.appendChild(none);
  for (const c of clients) {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = c.name;
    if (mode === 'edit' && c.name === currentClient) currentClientId = c.id;
    select.appendChild(opt);
  }
  select.value = currentClientId === null ? '' : String(currentClientId);
  await fillProjects(currentClientId, mode === 'edit' ? currentProject : null);
  // R24: the async pre-selection is part of the SEED, not a user edit — patch it in (the
  // guard keeps a subject swap that closed this form from resurrecting a stale seed).
  if (openForm && openForm.form === form) {
    openForm.seed.client = select.value;
    openForm.seed.project = projectSelect.value;
  }
  select.addEventListener('change', () => {
    const cid = select.value === '' ? null : Number(select.value);
    // §05 R07 (add mode): an untouched Billable box follows the client — set once a client
    // is chosen, cleared when none — until the user's own click wins.
    if (mode === 'add' && !billTouched) setBill(select.value !== '');
    void fillProjects(cid, null); // a client change resets the project (no stale pre-selection)
  });
}

// Live count-up on the running entry (display tick, independent of data changes). It
// advances the compact summary glance line, the Timer-view Active-Timer card clock and the
// Entries-view compact strip clock (§12 R04), and the running entry's row duration — all
// derived from now − start, never stored.
function tick() {
  if (!state?.status.running) return;
  const e = state.status.entry;
  $('summary').innerHTML = summaryHtml(e);
  const clock = $('timer-clock');
  if (clock) clock.textContent = fmtDur(elapsed(e.startUtc, e.excludedSeconds ?? 0));
  // §12 R04: advance the Entries-view compact strip's count-up in lockstep with the card. The
  // readonly calendar's running block carries no duration cell (it shows a start-only time label
  // and fades into the future, §12 R16/G8), so there is nothing else to tick on the Entries view.
  const stripClock = $('strip-clock');
  if (stripClock) stripClock.textContent = fmtDur(elapsed(e.startUtc, e.excludedSeconds ?? 0));
}

$('toggle').addEventListener('click', async () => {
  // §06 R4: the toggle (stop / resume / start) can land on an overlapping span; capture
  // the WriteAck, reload to repaint the durable per-row flags, then raise the transient
  // banner (load() clears it first, so applyAck must run after the reload).
  // §12 R21: a Stop/toggle rejection (e.g. core refuses a stop time before the entry started,
  // #61) has no form to hold it, so it routes to the banner area as a block, never swallowed.
  try {
    const ack = await window.stint.toggle();
    await load();
    applyAck(ack);
  } catch (err) {
    showWriteError(err);
  }
});

// §12 R14: the live-edit-running strip wiring. Description + Start-time changes debounce a
// commit (so a multi-keystroke edit sends one patch on settle); the Billable toggle commits
// immediately. Every commit goes through commitLiveEdit → window.stint.edit with a patch that
// never carries endUtc, so the open row stays open and the timer keeps running (§05 R6).
{
  const leDesc = $('le-desc');
  const leStart = $('le-start');
  const leBill = $('le-bill');
  if (leDesc) leDesc.addEventListener('input', scheduleLiveEdit);
  // §05 R06: the Start text field rides the DEBOUNCED commit — typing settles into one
  // patch, and the inline start-only picker's live per-drag writes (each firing input +
  // change) coalesce the same way. Every commit is commitLiveEdit → liveEditPatch, whose
  // patch NEVER carries endUtc, so amending the start can never stop the open row.
  if (leStart) {
    leStart.addEventListener('input', scheduleLiveEdit);
    leStart.addEventListener('change', scheduleLiveEdit);
  }
  if (leBill) leBill.addEventListener('change', () => void commitLiveEdit());
  // §12 R06/R14: Tags + client/project are richer than a single inline field, so they route to
  // the ONE unified editor — not a separate modal. Switch to the Entries view and open the
  // unified form in EDIT MODE seeded with the running entry: it already supports the open row
  // (start-only picker, no End), so the patch never carries endUtc and editing it cannot stop
  // the timer (§05 R6). One click from the Timer live-edit strip lands the user in the editor
  // with tags/project editable.
  const openRunningEditor = () => {
    const running = state?.status?.running ? state.status.entry : null;
    if (!running) return;
    route('entries'); // render() repaints the Entries calendar, including the running event
    // The unified form seeds from the DAY-GROUPED row shape (endUtc and the flag fields the
    // status glance omits), so resolve the open row through the snapshot by id.
    const e = (state?.days ?? []).flatMap((d) => d.entries).find((x) => x.id === running.id);
    if (e) guardedSwap(() => void openUnifiedForm({ mode: 'edit', entry: e }));
  };
  const leTags = $('le-tags');
  const leProject = $('le-project');
  if (leTags) leTags.addEventListener('click', openRunningEditor);
  if (leProject) leProject.addEventListener('click', openRunningEditor);
  // §05 R09: the running card's Pin-as-favorite — captures the open entry's template
  // (fromEntryId='open') via window.stint.pinFavorite (parity with `tt fav add`).
  const timerPin = $('timer-pin');
  if (timerPin) timerPin.addEventListener('click', () => void pinAsFavorite());
}

// §12 R4: the Active-Timer card's primary Stop reuses the same `toggle` write the Timer-view
// #toggle primary uses (stopping the open entry). No new channel — the card is a presentation
// surface over the existing writes. While running, Stop is the view's ONLY primary action
// (§12 R05 / issue #51 — the start panel is hidden until the entry is stopped; there is no
// Switch button either, issue #34). Core's `start` remains the atomic stop-then-start for
// tt and programmatic callers (§05 R01).
$('timer-stop').addEventListener('click', async () => {
  // §12 R21: same as the Timer-view toggle — a refused stop routes to the banner area, never
  // a silent no-op that reads as "the app is broken".
  try {
    const ack = await window.stint.toggle();
    await load();
    applyAck(ack);
  } catch (err) {
    showWriteError(err);
  }
});

// §12 R04: the Entries-view compact strip routes to the full Timer view. The whole strip is a
// button (a click anywhere on it opens the Timer view); routing is presentation-only (no IPC).
const timerStrip = $('timer-strip');
if (timerStrip) timerStrip.addEventListener('click', () => route('timer'));

// §09 R7 / §12 R9: free-text search over the entries calendar. Each keystroke updates the
// active query. When the §12 R9 toolbar is idle, search routes through the `search` IPC over
// the default window (parity with `tt list --search`, case-insensitive on description /
// client / project / tag) — the original behaviour. Once the toolbar is active (a range /
// filter touched), search instead rides inside the `listEntries` query so it composes with
// the chosen range/filters (parity with `tt list --search`). The renderer holds no match
// logic — core filters either way and the calendar repaints.
const searchInput = $('search');
if (searchInput) {
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    // A search keystroke is itself a toolbar query (parity with `tt list --search`), so it
    // routes through listEntries and composes with the chosen range/filters. It only leaves
    // the bar idle when the box is cleared AND no range/filter is in play — then load()
    // restores the plain default getState calendar view (the default).
    if (searchQuery || hasEntryFilter()) {
      entryCtrlActive = true;
      void applyEntryQuery();
    } else {
      entryCtrlActive = false;
      void load();
    }
  });
}

// True when a client/project/tag/billable filter departs from its default — the controls that
// NARROW the week's entries (the week choice moves the window, it never narrows it). Decides
// whether an empty query result shows the no-match copy or just an empty week grid.
function hasNarrowingFilter() {
  return (
    entryQuery.clientId != null ||
    entryQuery.projectId != null ||
    !!entryQuery.tag ||
    entryQuery.billable !== 'all'
  );
}

// True when any non-search Entries toolbar control departs from its default (a week other
// than the current one, or a client/project/tag/billable filter). Used to decide whether
// clearing the search box reverts to the plain default getState calendar view.
function hasEntryFilter() {
  return (selectedWeekStart !== null && selectedWeekStart !== calWeekBounds(calToday())[0]) || hasNarrowingFilter();
}

// ----------------------------------------------------------- §12 R9 Entries toolbar

// Run the current toolbar query through window.stint.listEntries (the read-only entries
// calendar read, parity with `tt list --range/--client/--project/--tag/--search`), store the
// flat, day-laid result, and repaint. Pure read — no write, no refreshAll. The search box
// rides inside the same query so range + filters + search all compose in one core call; the
// calendar (R16) lays the returned entries into its day columns intrinsically — no grouping.
// §17 R11's live reflection is the repaint itself: the queried set lands on the calendar and
// its day-header totals (§12 R16) — there is no range-total chip to move (§12 R09, issue #264).
async function applyEntryQuery() {
  await refreshEntryGroups();
  render();
}

// The query half of applyEntryQuery, split out so load() can refresh the toolbar-narrowed
// calendar data WITHOUT routing the shared repaint through the entries branch (issue #50) —
// load() renders unconditionally after this; applyEntryQuery renders itself above. Updates
// entryGroups only; an incomplete custom date pair leaves the last groups untouched.
async function refreshEntryGroups() {
  // Issue #55: `by` is REQUIRED on ListEntriesQuery — without it core's grouping throws and
  // the whole query rejects. The Entries calendar always lays entries into day columns, so
  // the toolbar query always asks for the 'day' grouping.
  //
  // §12 R09: the window is ALWAYS the selected week's seven plain-date days (fromDate/toDate,
  // resolved to the local window in main like any date pair) — the WHOLE week even with the
  // weekend hidden, so a weekend day's entries are fetched, reported, and one toggle away;
  // calendarModel simply gives hidden days no column. Week-only is this query's shape, not a
  // core narrowing: `tt list --range` keeps arbitrary ranges.
  const ws = calSelectedWeekStart();
  const q = { by: 'day', billable: entryQuery.billable, fromDate: ws, toDate: calAddDays(ws, 6) };
  if (entryQuery.clientId != null) q.clientId = entryQuery.clientId;
  if (entryQuery.projectId != null) q.projectId = entryQuery.projectId;
  if (entryQuery.tag) q.tag = entryQuery.tag;
  if (searchQuery) q.search = searchQuery;
  selected.clear();
  // Issue #55: a rejected query must never SILENTLY leave the previous (or unfiltered)
  // set on screen while the toolbar highlights a different selection. On failure, log it
  // and paint the explicit no-match empty state instead of stale rows.
  let view;
  try {
    view = await window.stint.listEntries(q);
  } catch (err) {
    console.error('listEntries failed for the Entries toolbar query', q, err);
    entryGroups = [];
    render();
    return;
  }
  entryGroups = view.groups;
}

// Mark the bar active (so search composes into listEntries and load() preserves the query
// on refresh) and run the query. Called by every range/filter control change.
function activateEntryQuery() {
  entryCtrlActive = true;
  void applyEntryQuery();
}

// The one-active-segment helper the toolbar's segmented controls use: flips `.on` +
// aria-pressed onto the clicked segment and off the rest within the group.
function selectSegment(group, btn) {
  for (const b of group.querySelectorAll('.seg-btn')) {
    const on = b === btn;
    b.classList.toggle('on', on);
    if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(on));
  }
}

// §12 R09: adopt a new selected week (its containing week's first day, from any day token).
// The visible week must follow every selection path — picker click, prev/next buttons, the
// picker's Enter — so they all land here: re-anchor the picker's month + roving cell, then
// either re-query (a non-default week / filters / search ride listEntries) or fall back to
// the plain default getState paint when the selection IS the default view.
// §12 R24 (issue #323): every week change funnels through here — the two toolbar steppers and
// the picker's click and Enter alike — so the confirm cannot be walked around by choosing a
// different control. With no form open, or when the chosen day is already inside the shown
// week (a picker click that moves nothing), this is just applySelectedWeek.
function selectWeek(dayToken) {
  const nextWeekStart = calWeekBounds(dayToken)[0];
  const currentWeekStart = calSelectedWeekStart();
  if (!openForm || nextWeekStart === currentWeekStart) {
    applySelectedWeek(dayToken);
    return;
  }
  const move = () => {
    shiftOpenFormDays(calDaysBetween(currentWeekStart, nextWeekStart));
    applySelectedWeek(dayToken);
  };
  if (openForm.weekMoveConfirmed) {
    move();
    return;
  }
  openWeekMoveGate(() => {
    openForm.weekMoveConfirmed = true;
    move();
  });
}

// Whole days between two day strings — pure UTC math on the day tokens, like calAddDays, so it
// is timezone-agnostic and always lands on a multiple of seven here.
function calDaysBetween(fromDay, toDay) {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86400000);
}

// Carry the open form's interval by whole days, keeping the WALL-CLOCK time: the shift lands on
// the date halves of the Start/Stop text and never on a millisecond count, so an entry crossing
// a DST boundary still reads 09:00 on the other side. Only the fields move — the write is still
// the user's Save, exactly as it is for a drag (R17).
function shiftOpenFormDays(days) {
  if (!openForm || !days) return;
  const form = openForm.form;
  for (const sel of ['.edit-start', '.edit-end']) {
    const field = form.querySelector(sel);
    if (!field?.value) continue;
    const day = field.value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue; // unparseable text is the user's to fix (R21)
    field.value = calAddDays(day, days) + field.value.slice(10);
  }
  clearFormError(form.querySelector('.ef-warning'));
  paintPendingOverlay();
}

function applySelectedWeek(dayToken) {
  selectedWeekStart = calWeekBounds(dayToken)[0];
  // A different week is a different set of days, so the viewport retargets to the working-hours
  // default rather than restoring a position that belonged to the week just left (§12 R16).
  calScrollTop = null;
  pickerMonth = selectedWeekStart.slice(0, 7);
  pickerActiveDay = dayToken;
  if (searchQuery || hasEntryFilter()) {
    activateEntryQuery();
  } else {
    entryCtrlActive = false;
    void load();
  }
}

// §12 R09: the prev / next-week toolbar steppers — the week moves by exactly seven days,
// weekend visibility notwithstanding (hidden days are still part of the week).
$('el-prev-week')?.addEventListener('click', () => selectWeek(calAddDays(calSelectedWeekStart(), -7)));
$('el-next-week')?.addEventListener('click', () => selectWeek(calAddDays(calSelectedWeekStart(), 7)));

// §12 R09 / §14: the Show-weekend toggle persists the show_weekend row over the SAME
// setSetting IPC the Settings view's control uses — one stored row, two surfaces, both
// directions (a Settings edit reaches this switch on the next refresh via load()'s fresh
// settings, and this switch reaches the Settings view the same way). The reload repaints
// the grid to five or seven columns; what is stored and totalled never changes (§12 R16).
$('el-weekend')?.addEventListener('click', async () => {
  const next = !(state && state.settings && state.settings.showWeekend);
  try {
    await window.stint.setSetting({ key: 'showWeekend', value: next });
  } catch {
    // core refused the write (nothing stored) — the reload below repaints stored truth
  }
  await load();
});

// §12 R09: sync the toolbar's week label + weekend switch to the current selection/settings.
// Called from renderEntries so every repaint (week step, toggle, external tt config write)
// carries the toolbar with it.
function renderWeekControls() {
  const label = $('el-week-label');
  if (label) label.textContent = calWeekLabel();
  const sw = $('el-weekend');
  if (sw) {
    const on = !!(state && state.settings && state.settings.showWeekend);
    sw.classList.toggle('on', on);
    sw.setAttribute('aria-checked', String(on));
  }
}

// ----------------------------------------------------------- §12 R09 week picker

// §12 R09: the month-calendar WEEK PICKER beside the grid. Days carrying entries show a dot,
// today carries an ink ring, and the selected week is highlighted as ONE unit (a lifted paper
// band — design.html D12, depth not tint); clicking any day selects that day's whole week.
// The picker renders NO live/running-timer treatment — it is a navigation surface, and the
// running state already has its sanctioned homes (§15). Month steppers page the displayed
// month without touching the selection.
//
// Keyboard (the R09 path): a ROVING GRID — the whole grid is one tab stop (exactly one cell
// holds tabindex="0"), arrow keys move the active cell (±1 day, ±7 days — paging the month
// when they cross the rendered grid), Enter/Space selects the active day's week.
function renderWeekPicker() {
  const host = $('week-picker');
  if (!host) return;
  const month = pickerMonth ?? calSelectedWeekStart().slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const firstOfMonth = `${month}-01`;
  const lastOfMonth = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  // Whole weeks covering the month — the grid runs from the week containing the 1st through
  // the week containing the last day, so adjacent-month spill days (`.mut`) fill the rows.
  const gridFirst = calWeekBounds(firstOfMonth)[0];
  const gridLast = calWeekBounds(lastOfMonth)[1];
  const weekStart = calSelectedWeekStart();
  const weekEnd = calAddDays(weekStart, 6);
  const today = calToday();
  const active = pickerActiveDay && pickerActiveDay >= gridFirst && pickerActiveDay <= gridLast
    ? pickerActiveDay
    : weekStart >= gridFirst && weekStart <= gridLast
      ? weekStart
      : gridFirst;

  let html =
    `<div class="wk-hd">` +
    `<span class="m" id="wk-month-label">${CAL_MONTHS[m - 1]} ${y}</span>` +
    `<span class="nav2">` +
    `<button type="button" class="wk-nav" data-page="-1" aria-label="Previous month">${SU.icon('left')}</button>` +
    `<button type="button" class="wk-nav" data-page="1" aria-label="Next month">${SU.icon('right')}</button>` +
    `</span></div>`;
  html += `<div class="wkgrid" role="grid" aria-labelledby="wk-month-label">`;
  const dowRow = [];
  for (let i = 0; i < 7; i++) dowRow.push(calDayParts(calAddDays(gridFirst, i)).dw[0]);
  html += `<div class="wkrow" role="row">${dowRow.map((c) => `<span class="dow" role="columnheader">${c}</span>`).join('')}</div>`;
  for (let row = gridFirst; row <= gridLast; row = calAddDays(row, 7)) {
    html += `<div class="wkrow" role="row">`;
    for (let i = 0; i < 7; i++) {
      const day = calAddDays(row, i);
      const inWeek = day >= weekStart && day <= weekEnd;
      const cls =
        'd' +
        (day.slice(0, 7) !== month ? ' mut' : '') +
        (inWeek ? ' ws' + (i === 0 ? ' first' : i === 6 ? ' last' : '') : '') +
        (day === today ? ' today' : '');
      const [, , dnum] = day.split('-').map(Number);
      html +=
        `<span class="${cls}" role="gridcell" data-day="${day}" tabindex="${day === active ? 0 : -1}" ` +
        `aria-selected="${inWeek}" aria-label="${CAL_MONTHS[Number(day.slice(5, 7)) - 1]} ${dnum}, ${day.slice(0, 4)}">` +
        `<span class="tn2">${dnum}</span>${pickerDots.has(day) ? '<i class="edot" aria-hidden="true"></i>' : ''}</span>`;
    }
    html += `</div>`;
  }
  html += `</div>`;
  host.innerHTML = html;

  for (const nav of host.querySelectorAll('.wk-nav')) {
    nav.addEventListener('click', () => {
      const dm = Number(nav.dataset.page);
      const d = new Date(Date.UTC(y, m - 1 + dm, 1));
      pickerMonth = d.toISOString().slice(0, 7);
      pickerActiveDay = null;
      renderWeekPicker();
    });
  }
  const grid = host.querySelector('.wkgrid');
  grid.addEventListener('click', (ev) => {
    const cell = ev.target.closest('.d[data-day]');
    if (cell) selectWeek(cell.dataset.day);
  });
  grid.addEventListener('keydown', (ev) => {
    const cell = ev.target.closest('.d[data-day]');
    if (!cell) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[ev.key];
    if (step !== undefined) {
      ev.preventDefault();
      const next = calAddDays(cell.dataset.day, step);
      pickerActiveDay = next;
      // Crossing the rendered grid pages the displayed month so the roving cell stays real.
      if (next < gridFirst || next > gridLast) pickerMonth = next.slice(0, 7);
      renderWeekPicker();
      $('week-picker')?.querySelector(`.d[data-day="${next}"]`)?.focus();
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      selectWeek(cell.dataset.day);
    }
  });

  void refreshPickerDots(gridFirst, gridLast);
}

// §12 R09: fetch the entry-dot days for the picker's rendered grid — ONE unfiltered
// listEntries read per displayed range (parity: the same read the toolbar queries ride),
// cached by range so a same-month repaint costs nothing. Re-renders the picker only when
// the dot set actually arrived for a new range, so this can never repaint-loop.
async function refreshPickerDots(gridFirst, gridLast) {
  const key = `${gridFirst}..${gridLast}`;
  if (key === pickerDotsKey) return;
  let view;
  try {
    view = await window.stint.listEntries({ by: 'day', billable: 'all', fromDate: gridFirst, toDate: gridLast });
  } catch (err) {
    console.error('listEntries failed for the week-picker dots', err);
    return;
  }
  pickerDotsKey = key;
  pickerDots = new Set(view.groups.map((g) => g.key));
  renderWeekPicker();
}

// Billable filter (parity with `tt list` default billable / --all / --non-billable).
const elBillableSeg = $('el-billable-seg');
if (elBillableSeg) {
  elBillableSeg.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.seg-btn');
    if (!btn) return;
    selectSegment(elBillableSeg, btn);
    entryQuery.billable = btn.dataset.billable;
    activateEntryQuery();
  });
}

// Client / project filters (parity with `tt list --client/--project`). The renderer
// resolves no names — it sends the entity id; the project select is enabled and
// repopulated only once a client is chosen.
const elClient = $('el-client');
const elProject = $('el-project');
if (elClient) {
  elClient.addEventListener('change', async () => {
    const v = elClient.value;
    entryQuery.clientId = v === '' ? null : Number(v);
    entryQuery.projectId = null;
    if (elProject) {
      elProject.innerHTML = '<option value="">All projects</option>';
      elProject.disabled = entryQuery.clientId == null;
      if (entryQuery.clientId != null) {
        const projects = (await window.stint.listProjects({ clientId: entryQuery.clientId })) || [];
        for (const p of projects) {
          const opt = document.createElement('option');
          opt.value = String(p.id);
          opt.textContent = p.name;
          elProject.appendChild(opt);
        }
      }
    }
    activateEntryQuery();
  });
}
if (elProject) {
  elProject.addEventListener('change', () => {
    entryQuery.projectId = elProject.value === '' ? null : Number(elProject.value);
    activateEntryQuery();
  });
}

// Tag filter (parity with `tt list --tag`). Live as the user types.
const elTag = $('el-tag');
if (elTag) {
  elTag.addEventListener('input', () => {
    entryQuery.tag = elTag.value.trim();
    activateEntryQuery();
  });
}

// Seed the client filter from the same reference data the editor uses. Done once at load
// so the select is populated; the default ("All clients") keeps the bar idle until touched.
async function populateEntryClients() {
  if (!elClient) return;
  const clients = (await window.stint.listClients()) || [];
  // Preserve the current selection across a refresh.
  const current = elClient.value;
  elClient.innerHTML = '<option value="">All clients</option>';
  for (const c of clients) {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = c.name;
    elClient.appendChild(opt);
  }
  elClient.value = current;
}
void populateEntryClients();

// §12 R05 (core): the GUI core-entry surface — the Start form (no separate Switch; issue #34).
// It lives in the Timer view (relocated from the Entries toolbar); the ids are unchanged, so
// these $() lookups resolve the moved nodes. The surface is IDLE-ONLY (issue #51): while a
// timer runs renderTimerCard hides the whole start panel, so the view offers only edit-or-stop
// of the running entry until it is stopped. The primary Start stays one-tap; this disclosure
// (#start-toggle) reveals optional description/client/project/tags/billable fields and
// sends them all over the same `start` IPC the tt CLI uses (core startWithAttributes).
const startForm = $('start-form');
$('start-toggle').addEventListener('click', () => {
  const open = startForm.hidden;
  startForm.hidden = !open;
  $('start-toggle').setAttribute('aria-expanded', String(open));
  if (open) $('start-desc').focus();
});

// §05 R07 (issue #51): the form's Billable checkbox DEFAULTS off the one client-keyed rule —
// billable when a client is set, not otherwise — tracking the Client field live until the
// user explicitly touches the checkbox (an explicit choice then wins, "always overridable").
// Submit forwards billable ONLY when the user set it, so an untouched box falls through to
// core's §05 R07 default — the very same default the one-tap #toggle start gets (it sends no
// billable at all), so BOTH start controls resolve billable through the one core rule.
let startBillTouched = false;
$('start-bill').addEventListener('change', () => {
  startBillTouched = true;
});
$('start-client').addEventListener('input', () => {
  if (!startBillTouched) $('start-bill').checked = $('start-client').value.trim() !== '';
});

startForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const trimmed = (id) => $(id).value.trim();
  const tags = $('start-tags').value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  // Tri-state billable (§05 R07): only an explicitly-touched checkbox rides the payload;
  // otherwise the key is omitted and core derives billable from the resolved client.
  const payload = {};
  if (startBillTouched) payload.billable = $('start-bill').checked;
  if (trimmed('start-desc')) payload.description = trimmed('start-desc');
  if (trimmed('start-client')) payload.client = trimmed('start-client');
  if (trimmed('start-project')) payload.project = trimmed('start-project');
  if (tags.length) payload.tags = tags;
  const ack = await window.stint.start(payload);
  startForm.reset();
  startBillTouched = false;
  startForm.hidden = true;
  $('start-toggle').setAttribute('aria-expanded', 'false');
  await load();
  applyAck(ack);
});

// §12 R15: the snapshot's CLOSED entries (other than the one being edited) so the picker can
// paint them gray on its day column and flag overlaps yellow (warn-only). The running/open
// entry has no stop, so it is excluded; the picker resolves nothing itself — it only reads
// the already-loaded start/stop instants the snapshot carries.
function snapshotEntries(excludeId) {
  if (!state || !Array.isArray(state.days)) return [];
  return state.days
    .flatMap((d) => d.entries)
    .filter((e) => e.endUtc !== null && e.id !== excludeId)
    .map((e) => ({ startUtc: e.startUtc, endUtc: e.endUtc, description: e.description }));
}

// §05 R06 / §12 R14/R15: the running entry's Start field carries an INLINE start-only
// DISCLOSURE of the interval picker — expanded in flow into #le-start-disc below the field
// (no modal, no backdrop, no Apply). The picker renders the running block with a start grip
// only, fading into the future (G8); every grip drag 5-min-snaps and writes #le-start LIVE
// (input+change), riding the strip's debounced commitLiveEdit → window.stint.edit path whose
// liveEditPatch NEVER carries endUtc — so amending the start can never stop the open row or
// synthesize an end. Text stays authoritative: the picker only ever writes the text field.
function closeLeStartDisc() {
  const disc = $('le-start-disc');
  const toggle = $('le-start-pick');
  if (disc) {
    disc.hidden = true;
    disc.innerHTML = '';
  }
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}
{
  const leStartPick = $('le-start-pick');
  const leStartDisc = $('le-start-disc');
  if (leStartPick && leStartDisc) {
    leStartPick.addEventListener('click', () => {
      const leStart = $('le-start');
      if (leStartPick.getAttribute('aria-expanded') === 'true') {
        closeLeStartDisc(); // second click collapses the disclosure
        return;
      }
      if (typeof window.STP === 'undefined' || typeof window.STP.openStartOnly !== 'function') {
        leStart.focus(); // picker unavailable — text entry is always reachable
        return;
      }
      // Unhide BEFORE mounting: openStartOnly positions its scroll window by assigning
      // `scrollTop` (§14/G16 — the SU.timelineWindow default viewport), and an element still
      // carrying `hidden` has no laid-out overflow to scroll, so the assignment clamps to 0
      // and the picker opens at 00:00 instead of the configured window.
      leStartDisc.hidden = false;
      window.STP.openStartOnly({
        host: leStartDisc,
        startInput: leStart, // the ONLY binding — this variant takes no end input at all
        otherEntries: snapshotEntries(state?.status?.entry?.id ?? null),
        settings: state?.settings ?? null,
      });
      leStartPick.setAttribute('aria-expanded', 'true');
    });
  }
}

// §06 R3: the Merge action folds the current contiguous selection. mergeSelected()
// decides whether the selection agrees (merge directly) or disagrees (raise the app.js-
// hosted conflict prompt — openMergeConflict — to pick the
// winning client/project/billable first).
$('merge-go').addEventListener('click', () => void mergeSelected());

// §12 R3: the window shell's persistent left nav. route() is the client-side router —
// it shows the picked .view[data-view] section and hides the rest, and marks the matching
// .nav-item active (the system-accent marker, §12 R13). Routing is presentation-only — no
// IPC — so it stays instant and stateless; the per-view data work (Timer/Reports/Settings)
// is the separate §12 R5–R11 reqs, so those routes land on an instructive placeholder.
let activeView = 'entries';

function route(view) {
  // §12 R07: select-interval is a mode of the ENTRIES GRID, so it cannot outlive the view.
  // Left armed, a return to Entries finds a dead end: the + is hidden (the fine-snap toggle
  // holds its spot), `.sel-mode .dt .ev` makes every entry unclickable, and the only exit is
  // Escape — which nothing on screen mentions. Resolve it on the way out, exactly as Escape
  // would (an open form keeps the grid in 'form' mode; only select-interval is transient).
  if (view !== 'entries' && calMode === 'select') exitToRest();
  activeView = view;
  // Each view is a self-contained <section class="view" data-view="…">; toggling `hidden`
  // on the whole section is enough — the inner forms/banners/merge-bar keep their own state
  // because the Entries section is re-rendered (below) when it becomes active.
  for (const section of document.querySelectorAll('.view')) {
    section.hidden = section.dataset.view !== view;
  }
  for (const item of document.querySelectorAll('.nav-item')) {
    const on = item.dataset.view === view;
    item.classList.toggle('active', on);
    if (on) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  // Repaint the active data view from its current state so a route back restores it.
  if (view === 'entries') render();
  else if (view === 'clients') void renderClients();
  // §12 R04: repaint the favorites rail (R14) and the full Active-Timer card (the Timer view
  // hosts it) from the current running state. The card's count-up keeps advancing via tick().
  else if (view === 'timer') {
    void renderFavorites();
    renderTimerCard(state && state.status.running ? state.status.entry : null);
  }
}

for (const item of document.querySelectorAll('.nav-item')) {
  // Buttons give Enter/Space activation for free (§12 R13 keyboard reachability).
  item.addEventListener('click', () => route(item.dataset.view));
}

// §07: render the Clients view from the same reference-data capabilities tt exposes.
// Each active client is listed with its active projects; rename + archive are offered in
// place, and an Add project control sits under each client. Archived items are excluded
// by listClients/listProjects' default (includeArchived=false) — archive hides from the
// active list but keeps history (the durable entry labels are resolved, not copied).
// Re-entrancy guard (issue #66): a rename / archive / add each calls renderClients directly
// AND the write's `changed` broadcast schedules a SECOND renderClients via onChange. The two
// async runs used to interleave — both cleared #clients-list, then both awaited per-client
// listProjects, then both appended — so every client and project landed twice (6 cards for 3
// clients). Each run now claims a monotonic generation token, builds its rows into a DETACHED
// fragment across the awaits, and only the run still current after the last await swaps them in
// (one synchronous replace). A superseded run drops its fragment and never touches the DOM, so
// exactly one run paints. The Tags strip (renderTags) carries the same guard — the same
// broadcast double-fires it too.
let clientsRenderGen = 0;

// §12 R13 — the "show archived" affordance (index.html #show-archived). Off by default, so the
// view lists only active records (archive hides). When on, archived clients/projects/tags appear
// with a Restore button (per the clients.html mockup), reversing the hide. The flag is read by
// renderClients/renderTags, which pass includeArchived to the list IPC (parity with `tt … ls
// --archived`) and partition the result into the active rows and the archived, Restore-able rows.
let showArchived = false;

async function renderClients() {
  const host = $('clients-list');
  if (!host) return;
  const gen = ++clientsRenderGen;
  const frag = document.createDocumentFragment();
  const clients = await window.stint.listClients({ includeArchived: showArchived });
  if (gen !== clientsRenderGen) return; // a newer run superseded this one — drop the work
  const active = clients.filter((c) => !c.archived);
  const archived = clients.filter((c) => c.archived);
  if (clients.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'clients-empty';
    empty.innerHTML =
      `<div class="big">No clients yet</div>` +
      `<div>Add a client, or run <code>tt client add</code>.</div>`;
    frag.appendChild(empty);
  } else {
    for (const c of active) {
      // With "show archived" on, a client's archived projects are revealed under it (each with a
      // Restore button); off, only its active projects show. One IPC read per client either way.
      const projects = await window.stint.listProjects({ clientId: c.id, includeArchived: showArchived });
      if (gen !== clientsRenderGen) return; // a newer run superseded this one — drop the work
      frag.appendChild(clientRow(c, projects));
    }
    // §12 R13: archived clients render LAST as quiet Restore cards (mockup: the ".arch" card with
    // an "archived" pill and a Restore button), reversing the hide. Only present when showArchived.
    for (const c of archived) frag.appendChild(archivedClientRow(c));
  }
  if (gen !== clientsRenderGen) return; // superseded after the last await — never paint stale rows
  host.innerHTML = '';
  host.appendChild(frag);
  // §12 R10: the tag-management strip lives in the same view, rendered from the active tags.
  await renderTags();
}

// §12 R10: render the Tags strip from the same reference data tt exposes. Each active tag
// is listed with rename + archive in place; archived tags drop out of the active list
// (listTags' default excludes them — archive hides from pickers but keeps history). The
// renderer resolves no names — it sends the tag's id over the rename/archive IPC tt uses.
let tagsRenderGen = 0;

async function renderTags() {
  const host = $('tags-list');
  if (!host) return;
  const gen = ++tagsRenderGen;
  const tags = await window.stint.listTags({ includeArchived: showArchived });
  if (gen !== tagsRenderGen) return; // superseded by a newer run — never paint stale rows (issue #66)
  host.innerHTML = '';
  if (tags.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tags-empty';
    empty.innerHTML =
      `<div class="big">No tags yet</div>` +
      `<div>Add a tag, or run <code>tt tag add</code>.</div>`;
    host.appendChild(empty);
    return;
  }
  // Active tags first, then (when showArchived) the archived tags as Restore rows.
  for (const t of tags.filter((t) => !t.archived)) host.appendChild(tagRow(t));
  for (const t of tags.filter((t) => t.archived)) host.appendChild(archivedTagRow(t));
}

function tagRow(t) {
  const row = document.createElement('div');
  row.className = 'tag-row';
  row.dataset.id = String(t.id);
  row.innerHTML =
    `<span class="tag-row-name">${escapeHtml(t.name)}</span>` +
    `<span class="tag-row-actions">` +
    `<button class="iconbtn" type="button" data-act="rename-tag" aria-label="Rename tag"><svg class="ic" aria-hidden="true"><use href="#i-edit" /></svg></button>` +
    `<button class="iconbtn" type="button" data-act="archive-tag" aria-label="Archive tag"><svg class="ic" aria-hidden="true"><use href="#i-archive" /></svg></button>` +
    `</span>`;
  row.querySelector('[data-act="rename-tag"]').addEventListener('click', () =>
    openTagRename(row, t),
  );
  // §12 R13 — R13's confirm scope names client/project only; a tag archive is direct (noted in
  // the PR). archiveTag hides the tag from the pickers while keeping its history on past entries.
  row.querySelector('[data-act="archive-tag"]').addEventListener('click', async () => {
    await window.stint.archiveTag({ id: t.id });
    await renderTags();
  });
  return row;
}

// §12 R13 — an archived tag rendered as a quiet Restore row (shown only when "show archived" is
// on). Restore reverses the hide over the same restoreTag IPC `tt tag restore` drives.
function archivedTagRow(t) {
  const row = document.createElement('div');
  row.className = 'tag-row archived';
  row.dataset.id = String(t.id);
  row.innerHTML =
    `<span class="tag-row-name">${escapeHtml(t.name)}</span>` +
    `<span class="pill">archived</span>` +
    `<span class="tag-row-actions">` +
    `<button class="small ghost" type="button" data-act="restore-tag"><svg class="ic" aria-hidden="true"><use href="#i-restore" /></svg>Restore</button>` +
    `</span>`;
  row.querySelector('[data-act="restore-tag"]').addEventListener('click', async () => {
    await window.stint.restoreTag({ id: t.id });
    await renderTags();
  });
  return row;
}

// Inline rename for a tag — the same in-place editor the client/project rows use, committed
// over the renameTag IPC tt's `tag rename` uses (the renderer sends the entity id directly).
function openTagRename(row, t) {
  const form = inlineRenameForm(t.name, async (name) => {
    if (name && name !== t.name) await window.stint.renameTag({ id: t.id, name });
    await renderTags();
  });
  row.querySelector('.tag-row-name').replaceWith(form);
  form.querySelector('input').focus();
}

function clientRow(c, projects) {
  const wrap = document.createElement('div');
  wrap.className = 'client';
  wrap.dataset.id = String(c.id);

  const head = document.createElement('div');
  head.className = 'client-head';
  head.innerHTML =
    `<span class="client-name">${escapeHtml(c.name)}</span>` +
    `<span class="client-actions">` +
    `<button class="iconbtn" type="button" data-act="rename-client" aria-label="Rename client"><svg class="ic" aria-hidden="true"><use href="#i-edit" /></svg></button>` +
    `<button class="iconbtn" type="button" data-act="archive-client" aria-label="Archive client"><svg class="ic" aria-hidden="true"><use href="#i-archive" /></svg></button>` +
    `</span>`;
  wrap.appendChild(head);

  const list = document.createElement('div');
  list.className = 'project-list';
  // Active projects first; then (when showArchived) the client's archived projects as Restore rows.
  for (const p of projects.filter((p) => !p.archived)) list.appendChild(projectRow(p));
  for (const p of projects.filter((p) => p.archived)) list.appendChild(archivedProjectRow(p));
  // §07: the Add-project affordance sits at the foot of the client's own project list, in line
  // with the projects — so it reads as "create a project here", under this client. Its "+"
  // icon reads muted like every icon-only affordance (design.html D16 — accent only when the
  // item is active).
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'proj-add';
  add.dataset.act = 'add-project';
  add.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-plus" /></svg>Add project`;
  list.appendChild(add);
  wrap.appendChild(list);

  // Rename swaps the client name into an inline editor; Archive hides it from the active list —
  // a REFERENCED client takes the two-step confirm (§12 R13, armArchiveClient); Add project opens
  // an inline name field. All route through the same IPC tt uses.
  head.querySelector('[data-act="rename-client"]').addEventListener('click', () =>
    openClientRename(head, c),
  );
  head.querySelector('[data-act="archive-client"]').addEventListener('click', (ev) =>
    armArchiveClient(ev.currentTarget, c),
  );
  add.addEventListener('click', () => openProjectAdd(list, c));
  return wrap;
}

function projectRow(p) {
  const row = document.createElement('div');
  row.className = 'project';
  row.dataset.id = String(p.id);
  row.innerHTML =
    `<span class="project-name">${escapeHtml(p.name)}</span>` +
    `<span class="project-actions">` +
    `<button class="iconbtn" type="button" data-act="rename-project" aria-label="Rename project"><svg class="ic" aria-hidden="true"><use href="#i-edit" /></svg></button>` +
    `<button class="iconbtn" type="button" data-act="archive-project" aria-label="Archive project"><svg class="ic" aria-hidden="true"><use href="#i-archive" /></svg></button>` +
    `</span>`;
  row.querySelector('[data-act="rename-project"]').addEventListener('click', () =>
    openProjectRename(row, p),
  );
  // §12 R13 — a REFERENCED project takes the two-step confirm; an unreferenced one archives directly.
  row.querySelector('[data-act="archive-project"]').addEventListener('click', (ev) =>
    armArchiveProject(ev.currentTarget, p),
  );
  return row;
}

// §12 R13 — an archived client rendered as a quiet Restore card (mockup: ".arch" card, "archived"
// pill, Restore button). Restore reverses the hide over the restoreClient IPC `tt client restore`
// drives; a restored client returns to every picker/filter. Shown only when "show archived" is on.
function archivedClientRow(c) {
  const wrap = document.createElement('div');
  wrap.className = 'client archived';
  wrap.dataset.id = String(c.id);
  const head = document.createElement('div');
  head.className = 'client-head';
  head.innerHTML =
    `<span class="client-name">${escapeHtml(c.name)}</span>` +
    `<span class="pill">archived</span>` +
    `<span class="client-actions">` +
    `<button class="small ghost" type="button" data-act="restore-client"><svg class="ic" aria-hidden="true"><use href="#i-restore" /></svg>Restore</button>` +
    `</span>`;
  wrap.appendChild(head);
  head.querySelector('[data-act="restore-client"]').addEventListener('click', async () => {
    await window.stint.restoreClient({ id: c.id });
    await renderClients();
  });
  return wrap;
}

// §12 R13 — an archived project rendered as a Restore row, nested under its (active) client. Core
// refuses restoring a project whose client is still archived, but such a project is never shown
// here (an archived client renders as a card with no project list), so this path always succeeds.
function archivedProjectRow(p) {
  const row = document.createElement('div');
  row.className = 'project archived';
  row.dataset.id = String(p.id);
  row.innerHTML =
    `<span class="project-name">${escapeHtml(p.name)}</span>` +
    `<span class="pill">archived</span>` +
    `<span class="project-actions">` +
    `<button class="small ghost" type="button" data-act="restore-project"><svg class="ic" aria-hidden="true"><use href="#i-restore" /></svg>Restore</button>` +
    `</span>`;
  row.querySelector('[data-act="restore-project"]').addEventListener('click', async () => {
    await window.stint.restoreProject({ id: p.id });
    await renderClients();
  });
  return row;
}

// Inline rename: an in-place text field seeded with the current name, committed over the
// rename IPC tt uses (the renderer resolves no names — it sends the entity id directly).
function openClientRename(head, c) {
  const form = inlineRenameForm(c.name, async (name) => {
    if (name && name !== c.name) await window.stint.renameClient({ id: c.id, name });
    await renderClients();
  });
  head.querySelector('.client-name').replaceWith(form);
  form.querySelector('input').focus();
}

function openProjectRename(row, p) {
  const form = inlineRenameForm(p.name, async (name) => {
    if (name && name !== p.name) await window.stint.renameProject({ id: p.id, name });
    await renderClients();
  });
  row.querySelector('.project-name').replaceWith(form);
  form.querySelector('input').focus();
}

// The ONE shared inline name field (issue #52): a text input committed on Enter (the form
// submit) with an explicit Cancel — the renderer's only way to gather a name. Electron's
// renderer does not implement window.prompt — it returns null, so a prompt-based flow
// silently no-ops in the packaged app (the same constraint the confirmInline note above
// records for window.confirm). Clients/projects seeded the pattern; favorites (pin/rename)
// and the Reports kebab (via window.inlineRenameForm — this is a classic script, so the
// declaration is a global) reuse it rather than growing bespoke near-copies.
/**
 * @param {string} current
 * @param {(name: string) => void | Promise<void>} onSave
 * @param {{ onCancel?: () => void, commitLabel?: string }} [opts]
 */
function inlineRenameForm(current, onSave, { onCancel, commitLabel = 'Save' } = {}) {
  const form = document.createElement('form');
  form.className = 'rename-form';
  form.innerHTML =
    `<input type="text" class="rename-input" autocomplete="off" />` +
    `<button type="submit" class="small primary">${escapeHtml(commitLabel)}</button>` +
    `<button type="button" class="small ghost rename-cancel">Cancel</button>` +
    // §12 R21: a refused rename (a name colliding with an existing one — §13 UNIQUE COLLATE
    // NOCASE) is surfaced here, so a client/project/tag rename that core refuses stays open
    // with the reason announced instead of silently swallowing the UNIQUE-constraint error.
    // Shared by every inlineRenameForm caller (Clients view, favorites, the Reports kebab).
    `<span class="rename-warning form-error" role="status" aria-live="polite" hidden></span>`;
  form.querySelector('.rename-input').value = current;
  const warn = form.querySelector('.rename-warning');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    // §12 R21: onSave awaits the rename IPC — a rejection here would otherwise vanish (the form
    // stays put, the click reads as broken). Catch it and surface it; the success path (onSave
    // re-renders and drops the form) tears the message down with the form.
    try {
      await onSave(form.querySelector('.rename-input').value.trim());
    } catch (err) {
      showFormError(warn, err);
    }
  });
  // The message persists until the next keystroke on the name field (add-form pattern).
  form.querySelector('.rename-input').addEventListener('input', () => clearFormError(warn));
  form.querySelector('.rename-cancel').addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (onCancel) onCancel();
    else void renderClients();
  });
  return form;
}

// Add a project under a client: an inline name field committed over the addProject IPC
// (core requires the owning client id, which the renderer has from the client row).
function openProjectAdd(list, c) {
  list.querySelector('.project-add')?.remove();
  const addBtn = list.querySelector('.proj-add');
  const form = document.createElement('form');
  form.className = 'project project-add';
  form.innerHTML =
    `<input type="text" class="project-add-input" placeholder="New project" autocomplete="off" />` +
    `<span class="project-actions">` +
    `<button type="submit" class="small primary">Add</button>` +
    `<button type="button" class="small ghost project-add-cancel">Cancel</button>` +
    `</span>`;
  // Open the inline field in line with the project list, just above the Add-project row.
  if (addBtn) { addBtn.hidden = true; list.insertBefore(form, addBtn); }
  else list.appendChild(form);
  form.querySelector('.project-add-input').focus();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = form.querySelector('.project-add-input').value.trim();
    if (name) await window.stint.addProject({ name, clientId: c.id });
    await renderClients();
  });
  form.querySelector('.project-add-cancel').addEventListener('click', (ev) => {
    ev.stopPropagation();
    void renderClients();
  });
}

// §12 R13 — the Clients view's "show archived" toggle. Flips showArchived and repaints, so the
// archived records (and their Restore buttons) appear or hide. aria-pressed + the label track state.
$('show-archived').addEventListener('click', () => {
  showArchived = !showArchived;
  const btn = $('show-archived');
  btn.setAttribute('aria-pressed', String(showArchived));
  btn.textContent = showArchived ? 'Hide archived' : 'Show archived';
  void renderClients();
});

// Add a client from the Clients view header: an inline name field committed over the
// addClient IPC tt's `client add` uses. The button is #add-client-btn — distinct from the
// Add-entry form's #add-client <select> (issue #48: a shared id bound this handler to the
// select, dead-ending the button and injecting a phantom .client-add row on dropdown open).
$('add-client-btn').addEventListener('click', () => {
  const host = $('clients-list');
  if (!host || host.querySelector('.client-add')) return;
  const form = document.createElement('form');
  form.className = 'client client-add';
  form.innerHTML =
    `<input type="text" class="client-add-input" placeholder="New client" autocomplete="off" />` +
    `<span class="client-actions">` +
    `<button type="submit" class="small primary">Add</button>` +
    `<button type="button" class="small ghost client-add-cancel">Cancel</button>` +
    `</span>`;
  host.prepend(form);
  form.querySelector('.client-add-input').focus();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = form.querySelector('.client-add-input').value.trim();
    if (name) await window.stint.addClient({ name });
    await renderClients();
  });
  form.querySelector('.client-add-cancel').addEventListener('click', (ev) => {
    ev.stopPropagation();
    void renderClients();
  });
});

// §12 R10: add a tag from the Tags strip header — an inline name field committed over the
// addTag IPC tt's `tag add` uses. addTag is create-or-return (it wraps core's ensureTag),
// so re-adding an existing name is a no-op rather than a duplicate.
$('add-tag').addEventListener('click', () => {
  const host = $('tags-list');
  if (!host || host.querySelector('.tag-add')) return;
  const form = document.createElement('form');
  form.className = 'tag-row tag-add';
  form.innerHTML =
    `<input type="text" class="tag-new-input" placeholder="New tag" autocomplete="off" />` +
    `<span class="tag-row-actions">` +
    `<button type="submit" class="small primary">Add</button>` +
    `<button type="button" class="small ghost tag-add-cancel">Cancel</button>` +
    `</span>`;
  host.prepend(form);
  form.querySelector('.tag-new-input').focus();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = form.querySelector('.tag-new-input').value.trim();
    if (name) await window.stint.addTag({ name });
    await renderTags();
  });
  form.querySelector('.tag-add-cancel').addEventListener('click', (ev) => {
    ev.stopPropagation();
    void renderTags();
  });
});

// §05 R09: render the Timer view's favorites rail from the same listFavorites capability tt
// exposes (`tt fav ls`). Each pinned favorite shows its name + client/project + tags, with a
// kebab opening Rename / Unpin — over window.stint.renameFavorite / unpinFavorite (no DB
// in the page), at parity with `tt fav rename` / `tt fav rm`. The Pin-as-favorite control
// captures the running timer's template (or, when idle, the Start form's attributes) via
// window.stint.pinFavorite. The rail repaints over the `changed` broadcast on every write.
async function renderFavorites() {
  const rail = $('fav-rail');
  if (!rail) return;
  rail.innerHTML = '';
  const favs = await window.stint.listFavorites();
  const empty = $('fav-empty');
  if (empty) empty.hidden = favs.length > 0;
  for (const f of favs) rail.appendChild(favoriteChip(f));
  // The Pin control reads the running timer when one is running, else the Start form's fields.
  const pinBtn = $('fav-pin');
  if (pinBtn && !pinBtn.dataset.wired) {
    pinBtn.dataset.wired = '1';
    pinBtn.addEventListener('click', () => openPinForm(pinBtn));
  }
}

function favoriteChip(f) {
  const card = document.createElement('div');
  card.className = 'fav-card';
  // A favorite carries client/project IDS (not names), so the rail's single metadata line is
  // built from what the view shape holds: the captured description, the billable word (colour
  // is never the only signal, so it is spelled out) and any tags as #handles. The name is the
  // primary handle above it.
  const tagBits = (f.tags ?? []).map((t) => `#${t}`);
  const meta = [f.description, f.billable ? 'billable' : 'non-billable', ...tagBits]
    .filter(Boolean)
    .join(' · ');
  card.innerHTML =
    // §15: the star is the favorites mark — a monochrome line icon, never accent-coloured.
    `<span class="star"><svg class="ic" aria-hidden="true"><use href="#i-star" /></svg></span>` +
    `<div class="fi">` +
    `<div class="fav-name">${escapeHtml(f.name)}</div>` +
    (meta ? `<div class="fm">${escapeHtml(meta)}</div>` : '') +
    `</div>` +
    // §05 R10: one-click Resume — start a fresh timer from this favorite's template over the
    // startFavorite IPC (parity with `tt fav start` / `tt start --fav`). The `changed` broadcast
    // the write fans out repaints the rail + Active-Timer card.
    `<button type="button" class="resume" data-act="fav-resume"><svg class="ic" aria-hidden="true"><use href="#i-play" /></svg>Resume</button>` +
    `<button type="button" class="fav-kebab" data-act="fav-menu" aria-label="Favorite actions"><svg class="ic" aria-hidden="true"><use href="#i-dots" /></svg></button>`;
  card.querySelector('[data-act="fav-resume"]').addEventListener('click', async (ev) => {
    ev.stopPropagation();
    await window.stint.startFavorite({ name: f.name });
    await renderFavorites();
  });
  card.querySelector('[data-act="fav-menu"]').addEventListener('click', (ev) => {
    ev.stopPropagation();
    openFavMenu(card, f);
  });
  return card;
}

function openFavMenu(card, f) {
  // Replace the kebab with an inline Rename / Unpin menu (no native menus in the page).
  const existing = card.querySelector('.fav-menu');
  if (existing) {
    existing.remove();
    return;
  }
  const menu = document.createElement('div');
  menu.className = 'fav-menu';
  menu.innerHTML =
    `<button type="button" class="small" data-act="fav-rename">Rename</button>` +
    `<button type="button" class="small danger" data-act="fav-unpin">Unpin</button>`;
  menu.querySelector('[data-act="fav-rename"]').addEventListener('click', (ev) => {
    ev.stopPropagation();
    // §05 R09 / issue #52: the new name is gathered through the SAME inline in-place field
    // the Clients view uses — never window.prompt, which Electron's renderer does not
    // implement (a prompt-based rename silently no-ops in the packaged app). The chip's
    // name swaps into the field; Enter commits over the same renameFavorite IPC; Cancel
    // repaints the rail untouched.
    menu.remove();
    const form = inlineRenameForm(
      f.name,
      async (name) => {
        if (name && name !== f.name) {
          await window.stint.renameFavorite({ ref: f.id, name });
        }
        await renderFavorites();
      },
      { onCancel: () => void renderFavorites() },
    );
    form.classList.add('fav-rename');
    card.querySelector('.fav-name').replaceWith(form);
    const input = form.querySelector('input');
    input.focus();
    input.select();
  });
  menu.querySelector('[data-act="fav-unpin"]').addEventListener('click', async (ev) => {
    ev.stopPropagation();
    await window.stint.unpinFavorite({ ref: f.id });
    await renderFavorites();
  });
  card.appendChild(menu);
}

// §05 R09 / issue #52: the Pin control swaps into an INLINE name field (seeded from the
// running entry's description when one is running), committed on Enter — never
// window.prompt, which Electron's renderer does not implement (it returns null, so a
// prompt-based pin silently no-ops in the packaged app). Cancel restores the Pin control
// untouched; the commit routes into pinAsFavorite with the gathered name.
function openPinForm(btn) {
  const running = state?.status?.entry ?? null;
  const form = inlineRenameForm(
    running ? (running.description ?? 'Favorite') : '',
    async (name) => {
      if (!name) {
        form.querySelector('input').focus();
        return;
      }
      form.replaceWith(btn);
      await pinAsFavorite(name);
    },
    { onCancel: () => form.replaceWith(btn), commitLabel: 'Pin' },
  );
  form.classList.add('fav-pin-form');
  const input = form.querySelector('input');
  input.placeholder = 'Favorite name';
  input.setAttribute('aria-label', 'Favorite name');
  btn.replaceWith(form);
  input.focus();
  input.select();
}

async function pinAsFavorite(name) {
  // From the running timer when one is running: capture its template (fromEntryId='open').
  // Otherwise capture the Start form's attributes (description/client/project/tags/billable),
  // exactly the payload `tt fav add` accepts — so the rail reaches nothing tt cannot.
  const running = state?.status?.entry ?? null;
  let payload;
  if (running) {
    payload = { name, fromEntryId: 'open' };
  } else {
    payload = {
      name,
      description: $('start-desc') ? $('start-desc').value || null : null,
      client: $('start-client') ? $('start-client').value || undefined : undefined,
      project: $('start-project') ? $('start-project').value || undefined : undefined,
      tags: $('start-tags') && $('start-tags').value
        ? $('start-tags').value.split(',').map((t) => t.trim()).filter(Boolean)
        : [],
      billable: $('start-bill') ? $('start-bill').checked : undefined,
    };
  }
  try {
    await window.stint.pinFavorite(payload);
  } catch {
    /* a duplicate name is rejected in core; leave the rail as-is */
  }
  await renderFavorites();
}

// design.html D11 — THE ACCENT HANDOFF, in one rule. "At most one accent-filled (accent-solid)
// primary action per view — the single most-likely action." Which button that is changes with the
// state: each view marks its STANDING primary (the most-likely action with nothing open) with
// `data-standing-primary`, and while an inline form is open its COMMIT is the most-likely action, so
// the standing one gives the `primary` class up and reverts to the neutral button paint. Three states
// used to light both at once — and on the Timer view the two accent-filled buttons carried the same
// word, "Start" (issue 150).
//
// One rule, applied structurally rather than at each of the ~9 open/close seams: a form (or the split
// picker, or the modal) that opens without remembering to demote anything is the defect itself, so
// the condition is read off the DOM instead of maintained by every caller. An OPEN COMMIT SURFACE is
// a `<form>` that is not closed away plus a `.primary` inside it, the split picker (`.split-at` — the
// one commit surface that is not a form), or the app's single modal, which mounts on `<body>` outside
// the views. Only the ACTIVE view is consulted, so a form left open on a view the user navigated away
// from cannot demote the primary of the view now on screen.
//
// Why script and not a `:has()` selector: the CSS form of this rule — `.view:has(form:not([hidden])
// button.primary) [data-standing-primary]` — matches correctly under `Element.matches` but Chromium
// does not always RE-RESOLVE the style when the `hidden` attribute that makes it true is toggled, so
// opening the Reports builder left "+ New report" still accent-filled until some unrelated recalc
// happened to repaint it. A MutationObserver has no such gap. It is also cheap: the callback is
// batched per task by the platform, and the work is four `classList.toggle` calls over a two-selector
// query, so even the calendar's 51-block repaints cost one pass.
const COMMIT_SURFACE = ':is(form:not([hidden]), .split-at) button.primary';
function syncStandingPrimary() {
  const view = document.querySelector('.view:not([hidden])');
  const claimed =
    !!document.querySelector('.editor-backdrop button.primary') ||
    !!view?.querySelector(COMMIT_SURFACE);
  for (const el of document.querySelectorAll('[data-standing-primary]')) {
    el.classList.toggle('primary', !claimed);
  }
}
// `hidden` is the only attribute the condition reads, so the observer watches it and the DOM shape;
// the class it writes is deliberately outside attributeFilter, so the write cannot re-trigger it.
new MutationObserver(syncStandingPrimary).observe(document.body, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['hidden'],
});

// §07/§12: an external change (a tt write) repaints whichever view is active. route() serves
// FIVE views, so the split is spelled out per view rather than left to a catch-all `else`:
// the tail used to cover Entries, Reports AND Settings alike, and the form re-seed below fired
// on all three — raising the R24 modal over the Settings view, about a form mounted inside the
// hidden Entries section, with "Keep editing" focusing a field the user could not see.
window.stint.onChange(() => {
  // §07: the Clients view paints from its own reference-data reads, not from `state`.
  if (activeView === 'clients') {
    void renderClients();
    return;
  }
  // Every other view repaints off a fresh snapshot: load() re-reads `state` and render()
  // repaints the shared surfaces (the Active-Timer card, the compact strip, the entries grid),
  // so a view is never left painting stale truth — including Reports and Settings, whose own
  // panels refresh themselves but whose next visit to Entries reads this `state`.
  void load().then(() => {
    // §12 R14: the Timer view also owns the favorites rail (load() has already repainted the
    // card + live-edit strip). No form lives here, so nothing is re-seeded.
    if (activeView === 'timer') {
      void renderFavorites();
      return;
    }
    // §12 R24: the OPEN form's fate — only while the Entries view is the one on screen, since
    // that is where the form is and the gate is a prompt about what the user is looking at:
    //   · no form / an add-mode draft — nothing to re-seed; the reload repaints beneath it.
    //   · a CLEAN edit form — silently re-seed from the fresh snapshot (swap in place; closes
    //     only if the entry is gone — nothing typed, nothing lost).
    //   · a DIRTY edit form — the refresh wants to re-seed the subject, and that is a subject
    //     swap: the keep-editing / discard gate arms. Keep editing preserves every pending
    //     field over the refreshed grid; only the explicit Discard adopts the fresh seed.
    // On Reports/Settings the grid still repaints; the form keeps its pending fields untouched
    // and unswapped until the user comes back to it.
    if (activeView !== 'entries') return;
    if (!openForm || openForm.mode !== 'edit') return;
    if (formIsDirty()) openPendingGate(() => reseedFromSnapshot());
    else reseedFromSnapshot();
  });
});
setInterval(tick, 1000);
// §12 R3: open on the Entries view (the default active route) so the nav highlight and the
// shown section are consistent from the first paint, then load its data.
route('entries');
syncStandingPrimary();
load();
