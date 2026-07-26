// Main window renderer (PRD §12). Paints the same truth tt would show — entries
// grouped by day with flags in context, a one-tap subtract on slept entries, an
// instructing empty state, and a live count-up on the running entry.
// Classic script: helpers come from window.SU (the bundled su.ts entry — dist/su.js,
// loaded first; the tooling decision is recorded in context/architecture.html §08).
const {
  fmtDur, fmtHours, elapsed, localTime, friendlyHotkey, localInputValue, parseLocalInput,
  tagDiff, deriveView, errMessage, escapeHtml, localMinuteOfDay,
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

// §12 R9: the Entries TOOLBAR state — range/filter/search over the readonly entries
// calendar (R16). `entryQuery` holds the live control values (range preset/custom,
// client/project/tag/billable). There is NO grouping here — grouped breakdowns moved to
// Reports (§09 R02 / `tt report --by`, G11); the toolbar only narrows which entries the
// calendar lays into its day columns. `entryGroups` is the flat, day-laid result of the
// last window.stint.listEntries call, or null when the toolbar is idle (This-week-or-wider
// window, no filters) — in which case render() paints the default getState entries so the
// existing empty-state facts hold. A control change or search keystroke re-queries + repaints.
// §09 R01: fromDate/toDate are the custom range's two PLAIN DATES (raw `YYYY-MM-DD` field
// strings, no time component) — main resolves them to the inclusive-end-day local window.
/** @type {{ preset: string | null, billable: 'all' | 'billable' | 'non-billable', clientId: any, projectId: any, tag: string, fromDate: string | null, toDate: string | null }} */
const entryQuery = { preset: 'week', billable: 'all', clientId: null, projectId: null, tag: '', fromDate: null, toDate: null };
let entryGroups = null;

// True once the user touches any control (range/filter) — the search box alone does not
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

// §12 R21: paint a refused write into an INLINE message region at the point of action (the add
// form's #add-warning is the seed pattern). The region is announced (role=status/aria-live) and
// stays until the next input on that form clears it. `showFormError`/`clearFormError` are the
// shared primitives the edit form, split confirm and inline rename all use; the report builder
// and the popover own their own regions but read the message through the same SU.errMessage.
//
// design.html D15: a refusal is a BLOCK, so the region it lands in must read in the --danger
// palette — never the --flag advisory one. The dedicated `.form-error` regions are danger by
// construction; a region that serves BOTH kinds (the add form's #add-warning, whose base chrome is
// the warn advisory) takes danger from the `error` state class these two set and clear, the same
// modifier showWriteError puts on #overlap-banner. Setting it on an always-danger region is inert.
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

  // §17 R11 / §12 R16 (issue #55): the report total reflects the active selection LIVE.
  // When the toolbar is active and the queried set is in hand (entryGroups), the total is
  // that result's billable-only sum — the SELECTED RANGE's billable total, exactly what the
  // calendar shows; while a query is still in flight it is the snapshot-derived estimate
  // for the selection (deriveView — instant, but unbounded by the range). Idle, it is the
  // week-bounded billable total (weekTotal, the "This week" default). The estimate + idle
  // figures come from the in-memory snapshot — no IPC round-trip — so the figure tracks
  // the selection on every keystroke, then settles on the authoritative range sum.
  $('week-total').textContent = fmtHours(
    entryCtrlActive
      ? entryGroups
        ? entryGroupsTotal()
        : deriveView(state, liveSelection()).reportTotalSeconds
      : weekTotal(),
  );

  renderEntries();
}

// §12 R16 — the readonly entries CALENDAR geometry (G10/G16). One fixed comfortable-width day
// column per day in range over a FULL 24h track: the track is always the whole day so nothing
// clips; the viewport scrolls to the working-hours default. HOUR_PX drives both the vertical
// pixels-per-hour and the event positioning, so an entry's top/height is a pure function of its
// local minutes-of-day — the SAME window math the picker uses (window.SU.timelineWindow), never
// re-derived here.
// 44 is NOT free to change here alone (#174): styles.css `.dt` paints the hour rules with a
// repeating-linear-gradient hard-coded at 43px/44px — CSS cannot read this constant — so the
// two must move together or the painted hour lines drift off the positioned events. The value
// itself is chosen so the 24h track (1056px) overflows `.cstrip`'s 60vh viewport at any ordinary
// window height, which is what makes the working-hours default a real SCROLL, never a clip (G16).
const CAL_HOUR_PX = 44;
const CAL_DAY_PX = CAL_HOUR_PX * 24; // the full 24h track height (scroll, never clip)
const CAL_PX_PER_MIN = CAL_HOUR_PX / 60;
const CAL_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// An instant's LOCAL day as a 'YYYY-MM-DD' token — the same local-day vocabulary core's localDay
// gives the snapshot's day keys (localTodayDay does this for `now`), so the two compare directly.
// Used to detect a cross-midnight span (§12 R16 / issue #71): a closed entry whose local end day
// differs from its local start day.
function calLocalDayOf(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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
  const startDow = state.settings && state.settings.weekStart === 'sunday' ? 0 : 1;
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
// per-day billable total. Every in-range day is present — including EMPTY days (present-but-empty
// `.dcol`) — so the calendar reads as a continuous range, not a sparse list. The entries come from
// the SAME two sources render() already distinguishes: the toolbar's day-laid listEntries result
// when active (R09), else the getState day grouping. The default view pads to the whole week (G13);
// a custom range spans exactly its two plain dates (§09 R01), so empty in-range days still show.
function calendarModel() {
  const present = entryGroups
    ? entryGroups.map((g) => ({ day: g.key, entries: g.entries }))
    : state.days.map((d) => ({ day: d.day, entries: d.entries }));
  const map = new Map(present.map((p) => [p.day, p.entries]));
  const dayKeys = [...map.keys()].sort();
  let minDay;
  let maxDay;
  if (entryGroups && entryQuery.preset === 'custom' && entryQuery.fromDate && entryQuery.toDate) {
    minDay = entryQuery.fromDate;
    maxDay = entryQuery.toDate;
  } else {
    const anchor = dayKeys.length ? dayKeys[dayKeys.length - 1] : new Date().toISOString().slice(0, 10);
    const [ws, we] = calWeekBounds(anchor);
    minDay = dayKeys.length && dayKeys[0] < ws ? dayKeys[0] : ws;
    maxDay = dayKeys.length && dayKeys[dayKeys.length - 1] > we ? dayKeys[dayKeys.length - 1] : we;
  }
  const days = calEnumerateDays(minDay, maxDay);
  // §12 R16 (issue #71): fan each entry out into a rendering segment per day column it touches
  // (calEntrySegments). Keyed by day so a cross-midnight end/middle segment lands in the right
  // column even though that column's own `entries` (its totals below) never gained the entry — the
  // fan-out is pure rendering, attribution stays start-day. Out-of-range segments (a stop beyond
  // maxDay) are dropped: their column is not painted.
  const segsByDay = new Map(days.map((d) => [d, []]));
  for (const p of present) {
    for (const e of p.entries) {
      for (const seg of calEntrySegments(e, p.day)) {
        const bucket = segsByDay.get(seg.day);
        if (bucket) bucket.push({ ...seg, entry: e });
      }
    }
  }
  return days.map((day) => {
    const entries = map.get(day) || [];
    // The day-header total is the billable-only sum (empty day → 0), matching what `tt report`
    // sums for that day — the same billableSeconds core owns; the renderer never re-derives it.
    // Start-day attribution: a cross-midnight span counts only in its start-day column, so the
    // end/middle columns can show its segment without inflating their totals.
    const billableSeconds = entries.reduce((s, e) => s + (e.billable ? e.billableSeconds : 0), 0);
    return { day, entries, billableSeconds, segments: segsByDay.get(day) || [] };
  });
}

// §12 R9/R16: paint the Entries view. The default (toolbar idle) and the toolbar-active query
// both flow into the SAME readonly calendar (R16); only the never-tracked / no-match empty states
// short-circuit to their instructive `.empty` block (so the existing empty-state facts hold).
function renderEntries() {
  // Repainting the calendar closes any open edit form (its host is view-level, so it would
  // otherwise outlive the events it edited). Save/Delete/Split reloads and external refreshes all
  // funnel through here.
  closeEntryForm();
  const host = $('entries');
  host.innerHTML = '';
  if (entryGroups) {
    if (entryGroups.length === 0) {
      host.appendChild(emptyEntries());
      renderMergeBar();
      return;
    }
    renderCalendar(host);
    renderMergeBar();
    return;
  }
  if (state.days.length === 0) {
    host.appendChild(emptyState());
    renderMergeBar();
    return;
  }
  renderCalendar(host);
  renderMergeBar();
}

// §12 R16: build the calendar — a horizontally-scrolling strip of fixed-width day columns over a
// shared hour gutter, then default the viewport to the working-hours window (scroll, never clip).
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
  host.appendChild(wrap);
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
  strip.scrollTop = Math.round(win.startMin * CAL_PX_PER_MIN);
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

// One fixed-width day column: a header carrying the weekday/date + that day's billable total
// (§12 R16 / G13), then a 24h track holding the day's positioned events + any overlap warn bands.
function calColumn(d, isEnd) {
  const col = document.createElement('div');
  col.className = 'dcol' + (isEnd ? ' end' : '');
  const { dw, dd } = calDayParts(d.day);
  const head = document.createElement('div');
  head.className = 'dh';
  head.innerHTML =
    `<span class="dw">${dw}</span><b class="dd">${dd}</b>` +
    `<span class="ds tnum">${fmtHours(d.billableSeconds)}</span>`;
  col.appendChild(head);
  const track = document.createElement('div');
  track.className = 'dt';
  track.style.height = CAL_DAY_PX + 'px';
  // §06 R4 / §12 R10: overlap renders as a yellow warn BAND behind the events (detail lives in
  // the editor). Painted first so the events sit above it. Overlap is a same-day concept, so the
  // band iterates the column's own start-day entries.
  for (const e of d.entries) if (e.overlapped) track.appendChild(calOverlapBand(e));
  // §12 R16 (issue #71): paint one calendar event per SEGMENT — a same-day entry has exactly one,
  // a cross-midnight span has a segment in each touched column (all sharing the entry id, so
  // selection/click/hover act on the one entry). calEvent positions from the segment's bounds.
  for (const seg of d.segments) track.appendChild(calEvent(seg.entry, seg));
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

// The card's attribute row: the billable/non-billable badge plus a slept flag when the
// running entry's machine slept. Monochrome --flag tokens only (the accent is reserved
// for the running clock/state and the primary Stop button, §15); the billable badge reads
// as a quiet label, not an accent fill.
function cardFlagsHtml(e) {
  const flags = [];
  flags.push(
    e.billable
      ? '<span class="flag" title="billable time">billable</span>'
      : '<span class="flag" title="non-billable time">non-billable</span>',
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

// §12 R9: the empty state when the toolbar query matches nothing (a narrow range /
// filter / search excludes everything). Distinct from the never-tracked empty state —
// here there IS history, just nothing in the current view — so it instructs widening.
function emptyEntries() {
  const div = document.createElement('div');
  div.className = 'empty';
  div.innerHTML =
    `<div class="big">No matching entries</div>` +
    `<div>Widen the range or clear the filters to see more.</div>`;
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
  // struck raw-vs-trimmed duration all live in the unified editor (openEntryForm), not on the
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
  // §12 R06: Edit opens the UNIFIED ENTRY FORM in edit mode (openEntryForm) inline in the Entries
  // view — one form surfacing EVERY tt-editable field plus the footer Split + two-step Delete, the
  // GUI counterpart to `tt edit` / `tt split` / `tt rm`. A click anywhere on the entry opens the
  // same form (wired below); tags edit inside it (§12 R06/G6), so no separate per-row Edit-tags
  // control or modal is needed (there is no consolidated modal editor; the unified form owns editing).
  actions.push('<button class="op-btn" type="button" tabindex="-1" data-act="edit" title="Edit" aria-label="Edit entry fields"><svg class="ic" aria-hidden="true"><use href="#i-edit" /></svg></button>');
  return actions.join('');
}

function wire(row, e) {
  row.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'select') return toggleSelect(e.id, btn.checked); // multi-select for merge
      else if (act === 'edit') return openEntryForm(row, e); // §12 R06: unified form (edit mode), inline
      else if (act === 'split') return openSplitForm(btn, e); // inline; resolves on Split
      else if (act === 'delete') return armDelete(btn, e); // two-step; first click only arms
      else return;
    });
  });
  // §12 R06 (R16 wiring): a click anywhere on the entry — not on one of its action controls —
  // opens the unified entry form in edit mode INLINE, the same form the Edit affordance opens.
  // The action buttons/inputs above stopPropagation, so a click on them never also opens the
  // form; a click on the inert body (time / description / duration) does.
  row.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-act], input, button, a, .confirm, .split-at')) return;
    if (row.classList.contains('editing')) return; // already the form
    void openEntryForm(row, e);
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
      if (!row.classList.contains('editing')) void openEntryForm(row, e);
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

// §12 R06 (G5): tear down the open edit-mode form. It lives in the view-level #entry-form-host
// (not inside the calendar event), so closing it means removing the mounted form and dropping the
// .editing selection state from whichever calendar event carried it. Called on Cancel, whenever the
// calendar repaints (renderEntries — a Save/Delete/Split reload, or an external refresh, replaces
// the form), and before opening a new form so only one unified form (add or edit) is ever on
// screen. Idempotent when nothing is open.
function closeEntryForm() {
  const host = $('entry-form-host');
  const form = host?.querySelector('.entry-form');
  if (form) form.remove();
  document.querySelectorAll('.entry.editing').forEach((el) => el.classList.remove('editing'));
}

// §12 R06 (G5/G6/G7): the UNIFIED ENTRY FORM in EDIT MODE — the single in-window editor for
// an existing entry, opened INLINE in the Entries view (no modal, no backdrop, position:static
// in flow) from an entry's Edit affordance OR a click on the entry itself. It is the same form
// the manual-add uses (add mode is §12 R07), so editing an entry is identical to creating one.
// It seeds EVERY tt-editable field from the entry — the multiline description (a 3-line
// textarea, §05 R10), client + project selects (pre-selected), the tag chips (G6), the billable
// toggle, and the start/stop instants via the inline interval picker (§12 R15) over the collapsed
// Start/Stop expander (§12 R17, the exact / overnight path). On Save it sends ONLY the changed
// fields as { id, patch } over the same `edit` IPC tt uses — the sole commit (G7). The edit-mode
// FOOTER carries a Split control (window.stint.split) and a two-step Delete gate (confirmInline
// → window.stint.remove), so split + delete are reachable from the form itself (§06 R1/R2);
// merge stays the corner-checkbox multi-select path (§06 R3). Editing the RUNNING entry must NOT
// stop it: the open row's form omits End (start-only), so the patch never carries endUtc and the
// row stays open (§05 R6).
async function openEntryForm(row, e) {
  const running = e.endUtc === null;
  // The current client / project (the two halves of "Client / Project") so the selects can
  // pre-select them without the renderer ever resolving names itself.
  const currentClient = e.clientLabel ? e.clientLabel.split(' / ')[0] : '';
  const currentProject =
    e.clientLabel && e.clientLabel.includes(' / ')
      ? e.clientLabel.split(' / ').slice(1).join(' / ')
      : '';

  const form = document.createElement('form');
  // §12 R06 (G5): ONE unified entry form — edit mode uses the SAME two-column `.uf-body`
  // structure add mode does (mockup edit-entry.html shows the two-column card for BOTH modes),
  // so the form carries `unified-form` and reuses its `.uf-*` layout CSS verbatim. `edit-form`
  // + `entry-form` stay as the behavioural hooks the JUDGE UNIFIED_FORM scene and the tests
  // target; the per-field `.edit-*`/`.ef-*` hooks ride alongside the shared `.uf-*` styling
  // classes, so the two modes are one layout with two seedings.
  form.className = 'entry-form unified-form edit-form';
  form.dataset.mode = 'edit';
  // The edited entry's id, so the JUDGE/tests can target this form (only one is ever open) and
  // closeEntryForm can tie it back to the calendar event carrying the .editing selection state.
  form.dataset.id = String(e.id);
  // End is omitted for the open entry (§05 R6/§12 R06): editing the running entry's start must
  // not require an end, so the open row stays open. The Start/Stop expander is the exact /
  // overnight path (§12 R17); it holds RAW text fields (localInputValue format, NOT native
  // datetime-local, G1) — the same fields the inline picker writes and a typed overnight span uses.
  const endField = running
    ? ''
    : `<label class="uf-field"><span>Stop</span>` +
      `<input type="text" class="edit-end edit-time uf-time" autocomplete="off" spellcheck="false" ` +
      `placeholder="YYYY-MM-DD HH:mm:ss" aria-label="Entry stop time" /></label>`;
  form.innerHTML =
    // §12 R06 (G5): the two-column body — LEFT column = the attribute fields, RIGHT column = the
    // inline interval picker over the collapsed Start/Stop expander. Identical shape to add mode.
    `<div class="uf-body">` +
    `<div class="uf-fields">` +
    // §05 R10 — the description is a 3-line scrollable textarea, so a multiline description is
    // shown (and edited) with its newlines intact. The submit reads .value.trim(), which strips
    // only the OUTER whitespace and preserves every interior newline, so the stored record stays
    // verbatim. design.html D13 (issue 136): it carries the same visible `.uf-field` label its
    // Client / Project / Tags siblings below do — edit mode had the add form's exact defect, the
    // one unlabelled field in an otherwise labelled column. The placeholder stays: "(no
    // description)" describes the EMPTY state, it does not repeat the label.
    `<label class="uf-field uf-desc"><span>Description</span>` +
    `<textarea class="edit-desc desc-field" rows="3" placeholder="(no description)"></textarea></label>` +
    `<label class="uf-field"><span>Client</span>` +
    `<select class="edit-client uf-select"></select></label>` +
    // §12 R06 (G6): project is editable in the same form; it is populated for the chosen client
    // and pre-selected to the entry's project. Disabled until a client is chosen.
    `<label class="uf-field"><span>Project</span>` +
    `<select class="edit-project uf-select" disabled></select></label>` +
    // §12 R06 (G6): tags edit in the unified form as removable chips + an add input.
    `<label class="uf-field uf-tags"><span>Tags</span>` +
    `<span class="chips uf-tag-chips ef-tag-chips"></span></label>` +
    `<label class="uf-bill"><input type="checkbox" class="edit-bill-box" /> Billable</label>` +
    // §12 R10 (G12): the in-context flags region — the overlap detail (amount + neighbour) and the
    // reversible sleep subtract/restore control + struck raw-vs-trimmed billable. Always in the DOM
    // (hidden when the entry carries neither flag); filled + rewired by renderFlags() below.
    `<div class="ef-flags" hidden></div>` +
    `</div>` +
    `<div class="uf-picker">` +
    // §12 R15 (G5/G7): the inline interval picker — the primary picking surface. Mounted in flow
    // into this host (below), bound to THIS form's raw Start/Stop fields (in the expander below).
    `<div class="edit-picker uf-picker-mount"></div>` +
    // §12 R17: the collapsed Start/Stop expander — the exact-time escape hatch and the only path
    // for overnight spans. Collapsed by default; the raw fields it holds are the SAME values the
    // inline picker above writes, so expander and picker drive one set of form values.
    `<div class="uf-times ef-times">` +
    `<button type="button" class="ef-times-toggle" aria-expanded="false">Start / Stop (exact times)</button>` +
    `<div class="ef-times-body" hidden>` +
    `<label class="uf-field"><span>Start</span>` +
    `<input type="text" class="edit-start edit-time uf-time" autocomplete="off" spellcheck="false" ` +
    `placeholder="YYYY-MM-DD HH:mm:ss" aria-label="Entry start time" /></label>` +
    endField +
    `</div></div>` +
    `</div>` +
    `</div>` +
    // §12 R21: a refused Save is surfaced HERE, inline at the point of action — a core
    // StoreError (Stop-before-Start, split-in-span, etc.) or a locally-thrown parse error
    // (unparseable Start/Stop text). Announced (role=status/aria-live); the form stays open
    // and the message persists until the next input on it (see the .ef-warning input wiring).
    `<div class="ef-warning form-error" role="status" aria-live="polite" hidden></div>` +
    // §12 R06: the edit-mode footer, laid out by the shared `.uf-foot` grid. Only Save entry
    // carries the accent (§15); Split, Cancel and the two-step Delete are quiet. Split leads, then
    // a flexible spacer pushes Save / Cancel / Delete to the trailing edge.
    `<div class="uf-foot edit-foot">` +
    (running
      ? ''
      : `<button type="button" class="small ghost ef-split" data-act="split">Split</button>`) +
    `<span class="uf-foot-spacer ef-foot-spacer"></span>` +
    `<button type="submit" class="small primary">Save entry</button>` +
    `<button type="button" class="small ghost edit-cancel">Cancel</button>` +
    `<button type="button" class="small ghost ef-delete" data-act="delete">Delete</button>` +
    `</div>`;
  form.querySelector('.edit-desc').value = e.description ?? '';
  // §12 R15 (issue #49): seed the raw Start/Stop fields with the entry's EXACT stored instants —
  // localInputValue always renders seconds, so a 09:07:33 start reads 09:07:33, never a 5-min-
  // snapped 09:05 (and never a `T` the user has to edit around, issue #159). Keep the seeded
  // strings: the submit handler treats a byte-identical
  // field as UNTOUCHED and sends no time patch, so open-then-Save round-trips start/stop unchanged.
  const seededStart = localInputValue(new Date(e.startUtc));
  form.querySelector('.edit-start').value = seededStart;
  const seededEnd = running ? '' : localInputValue(new Date(e.endUtc));
  if (!running) form.querySelector('.edit-end').value = seededEnd;
  form.querySelector('.edit-bill-box').checked = !!e.billable;

  const select = form.querySelector('.edit-client');
  const projectSelect = form.querySelector('.edit-project');
  // currentClientId/currentProjectId are filled once the reference data resolves; they stay
  // null until then, and the save handler reads them lazily (the user cannot submit before the
  // selects populate).
  let currentClientId = null;
  let currentProjectId = null;

  // §12 R06 (G6): the in-form tag chip editor. `nextTags` is the working set the chips mutate;
  // Save diffs it against the entry's original tags via the pure window.SU.tagDiff and sends the
  // minimal { addTags, removeTags } inside the one patch — the renderer holds no tag logic.
  const originalTags = (e.tags ?? []).slice();
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
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${escapeHtml(t)} <b class="chip-x" title="Remove tag">×</b>`;
      chip.querySelector('.chip-x').addEventListener('click', (ev) => {
        ev.stopPropagation();
        const i = nextTags.indexOf(t);
        if (i >= 0) nextTags.splice(i, 1);
        renderTagChips();
        tagInput.focus();
      });
      chipHost.appendChild(chip);
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

  // §12 R17: the Start/Stop expander toggle reveals / hides the raw exact-time fields in flow.
  const timesToggle = form.querySelector('.ef-times-toggle');
  const timesBody = form.querySelector('.ef-times-body');
  timesToggle.addEventListener('click', () => {
    const open = timesBody.hidden;
    timesBody.hidden = !open;
    timesToggle.setAttribute('aria-expanded', String(open));
  });

  // §12 R10 (G12): paint the in-context flags region and (re)bind its reversible sleep control.
  // Subtracting excludes the recorded slept span from billable; subtracting again restores it —
  // core owns the toggle (store.subtractSleep, reached over the existing subtractSleep IPC, NO new
  // channel). After the write we re-read the entry off the fresh snapshot and repaint the region in
  // place so the editor stays open: the button flips Subtract slept ↔ Restore and durHtml's struck
  // raw-vs-trimmed billable appears / disappears. Called once on open, then after each toggle.
  const flagsRow = form.querySelector('.ef-flags');
  function renderFlags() {
    flagsRow.innerHTML = editorFlagsInnerHtml(e);
    flagsRow.hidden = flagsRow.innerHTML === '';
    const subtractBtn = flagsRow.querySelector('.ef-subtract');
    if (subtractBtn) {
      subtractBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await window.stint.subtractSleep({ id: e.id });
        // Re-read the toggled entry off core's snapshot (subtractSleep returns nothing; refreshAll
        // pushes new state in production, getState reads it here) — the editor owns no sleep math.
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
  }
  renderFlags();

  form.querySelector('.edit-cancel').addEventListener('click', () => closeEntryForm());
  // §12 R06 / §06 R2: the footer Split control cuts a closed span in two. It reuses the same
  // inline instant picker + `split` IPC the (retiring) row affordance used — offered only on a
  // closed entry (an open row has no end to cut). Absent for the running entry.
  const splitBtn = form.querySelector('.ef-split');
  if (splitBtn) {
    splitBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openSplitForm(ev.currentTarget, e);
    });
  }
  // §12 R06 / §06 R1 / §12 R13: the footer's two-step Delete gate. The first click ARMS an
  // explicit confirm affordance; only the explicit confirm removes the entry (window.stint.remove).
  form.querySelector('.ef-delete').addEventListener('click', (ev) => {
    ev.stopPropagation();
    armDelete(ev.currentTarget, e);
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    addTypedTag(); // fold any half-typed tag still in the add input
    const desc = form.querySelector('.edit-desc').value.trim();
    const startLocal = form.querySelector('.edit-start').value;
    const endLocal = running ? '' : form.querySelector('.edit-end').value;
    const billable = form.querySelector('.edit-bill-box').checked;
    const clientSel = select.value === '' ? null : Number(select.value);
    const projectSel = projectSelect.value === '' ? null : Number(projectSelect.value);

    // §12 R21: catch BOTH failure modes so a refused Save is surfaced, never silently swallowed —
    // (a) a locally-thrown parse error (unparseable Start/Stop text makes `new Date(...).toISOString()`
    // throw a RangeError while the patch is assembled) and (b) a core StoreError forwarded over the
    // `edit` IPC (Stop-before-Start, §05 R11). On either, the form stays open and the message region
    // shows the reason; the entry is unchanged. Only the success path reloads + closes.
    const warn = form.querySelector('.ef-warning');
    try {
      // §12 R06 (G7): Save is the sole commit — send ONLY the changed fields. For the open entry
      // the form has no End input, so the patch never carries endUtc and editing cannot close it.
      // §12 R15 (issue #49): a Start/Stop field whose text is byte-identical to what the form
      // seeded is UNTOUCHED — it contributes nothing to the patch, so Save after merely opening
      // the editor (no drag, no typing) preserves the stored start/stop exactly, to the second.
      const patch = {};
      const nextDesc = desc || null;
      if (nextDesc !== (e.description ?? null)) patch.description = nextDesc;
      if (startLocal && startLocal !== seededStart) {
        const nextStart = parseLocalInput(startLocal).toISOString();
        if (nextStart !== new Date(e.startUtc).toISOString()) patch.startUtc = nextStart;
      }
      if (!running && endLocal && endLocal !== seededEnd) {
        const nextEnd = parseLocalInput(endLocal).toISOString();
        if (nextEnd !== new Date(e.endUtc).toISOString()) patch.endUtc = nextEnd;
      }
      if (billable !== !!e.billable) patch.billable = billable;
      if (clientSel !== currentClientId) patch.clientId = clientSel;
      // Project only rides along when the client is unchanged or the project actually differs;
      // a null clears it. (Changing the client resets the project select, so a stale id never leaks.)
      if (projectSel !== currentProjectId) patch.projectId = projectSel;
      const { addTags, removeTags } = tagDiff(originalTags, nextTags);
      if (addTags.length) patch.addTags = addTags;
      if (removeTags.length) patch.removeTags = removeTags;

      // §06 R4: an edit can move the entry onto an overlapping span; capture the WriteAck, reload
      // to repaint the per-row flags, then raise the inline banner (after load(), which clears it).
      // The write already committed — the banner is advisory.
      const ack = await window.stint.edit({ id: e.id, patch });
      await load();
      applyAck(ack);
    } catch (err) {
      showFormError(warn, err);
    }
  });
  // §12 R21: the message persists until the next input on the form — any keystroke / field
  // change clears it, so a corrected value starts from a clean slate (the add-form pattern).
  form.addEventListener('input', () => clearFormError(form.querySelector('.ef-warning')));

  // §12 R06 (G5): mount the form in the SAME view-level host add mode uses (#entry-form-host), in
  // the view flow — NOT inside the clicked calendar event (a ~124px day column would crush the
  // wide two-column card and push its footer under the neighbouring columns). The event keeps its
  // content and gains a subtle .editing selection state; only ONE form (add or edit) shows at a
  // time, so close any open add/edit form first. Scroll the card into view on open. The form is in
  // the DOM before the async reference-data fetch, so the seeded fields (description/tags/billable/
  // times) are visible immediately while the selects are still populating.
  closeAddForm();
  closeEntryForm();
  row.classList.add('editing');
  const host = $('entry-form-host');
  host.appendChild(form);
  // design.html D10/A06: the courtesy scroll is motion, so reduced-motion collapses it to a jump
  // (the CSS half — the reduced-motion media block in styles.css — cannot reach a JS scroll).
  host.scrollIntoView({
    block: 'nearest',
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
  form.querySelector('.edit-desc').focus();

  // §12 R15 (G5/G7): mount the inline interval picker into the form's picker host, bound to THIS
  // form's Start/Stop fields (the §12 R17 expander inputs) — mounted AFTER the form is in the DOM
  // so the column geometry measures correctly. A closed entry binds both fields (body-drag moves
  // the whole span, the bottom grip resizes the stop); the running (open) entry — whose form has
  // only a Start field — gets the START-ONLY variant, structurally unable to write a stop, so
  // editing it cannot close the row (§05 R06). The picker writes the fields LIVE; Save entry stays
  // the sole commit (G7). Text stays authoritative — the picker only ever sets the inputs' value.
  mountIntervalPicker({
    host: form.querySelector('.edit-picker'),
    startInput: form.querySelector('.edit-start'),
    endInput: running ? null : form.querySelector('.edit-end'),
    excludeId: e.id,
  });

  // §12 R06 (G6): populate the project select from the same source tt uses, for the given
  // client id, and pre-select the entry's project by name. "(no project)" maps to null.
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

  // Populate the client select from the same source tt uses; pre-select the current client by
  // name. "(no client)" maps to a null clientId on save. Changing the client repopulates the
  // project select (dropping any stale pre-selection).
  const clients = await window.stint.listClients();
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '(no client)';
  select.appendChild(none);
  for (const c of clients) {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = c.name;
    if (c.name === currentClient) currentClientId = c.id;
    select.appendChild(opt);
  }
  select.value = currentClientId === null ? '' : String(currentClientId);
  await fillProjects(currentClientId, currentProject);
  select.addEventListener('change', () => {
    const cid = select.value === '' ? null : Number(select.value);
    void fillProjects(cid, null); // a client change resets the project (no stale pre-selection)
  });
}

// Today as a LOCAL 'YYYY-MM-DD' day string — the same local-day vocabulary core's
// localDay gives the snapshot's day keys, so the two compare directly.
function localTodayDay() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function weekTotal() {
  // §12 R16 / §17 R11 (issue #55): the "This week" chip is the CURRENT WEEK's billable
  // sum — bounded to the week containing today by the weekStart setting (calWeekBounds,
  // the same rule the calendar's default view pads to), never the whole in-memory window.
  // The renderer's at-a-glance figure; the report builder owns the authoritative one.
  const [ws, we] = calWeekBounds(localTodayDay());
  return state.days
    .filter((d) => d.day >= ws && d.day <= we)
    .flatMap((d) => d.entries)
    .filter((e) => e.billable)
    .reduce((s, e) => s + e.billableSeconds, 0);
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
    const e = state?.status?.running ? state.status.entry : null;
    if (!e) return;
    route('entries'); // render() repaints the Entries calendar, including the running event
    const row = document.querySelector(`.entry[data-id="${e.id}"]`);
    if (row) void openEntryForm(row, e);
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

// True when any non-search Entries toolbar control departs from its default (a non-default
// range/preset, or a client/project/tag/billable filter). Used to decide whether clearing
// the search box reverts to the plain default getState calendar view.
function hasEntryFilter() {
  return (
    entryQuery.preset !== 'week' ||
    entryQuery.clientId != null ||
    entryQuery.projectId != null ||
    !!entryQuery.tag ||
    entryQuery.billable !== 'all'
  );
}

// ----------------------------------------------------------- §12 R9 Entries toolbar

// §17 R11: the live toolbar selection as a ViewSelection the pure deriveView consumes.
// Built from the SAME live control values entryQuery/searchQuery hold, mapped to the
// snapshot's row shape: the search query, the chosen client by its row label (the
// #el-client option text is the client name, the prefix of the row's "Name / Project"
// label), and the billable narrowing. There is no user grouping in the entries calendar
// (grouping moved to Reports, G11), so the selection is always day-laid — the range-total
// chip + per-day header totals need only day layout. Used only to keep the totals live off
// the in-memory snapshot — the authoritative flat rows still come from listEntries (parity
// with tt), but the totals never wait on that round-trip.
function liveSelection() {
  /** @type {import('../src/liveview.js').ViewSelection} */
  const sel = { billable: entryQuery.billable, group: 'day' };
  if (searchQuery) sel.search = searchQuery;
  if (entryQuery.clientId != null && elClient) {
    const opt = elClient.options[elClient.selectedIndex];
    const name = opt ? opt.textContent.trim() : '';
    // The snapshot row labels read "Client / Project"; match the chosen client's name as the
    // leading segment so the live total narrows to that client without resolving names itself.
    const row = state.days.flatMap((d) => d.entries).find((e) => e.clientLabel && e.clientLabel.split(' / ')[0] === name);
    if (row) sel.clientLabel = row.clientLabel;
  }
  return sel;
}

// §17 R11: repaint #week-total LIVE from the in-memory snapshot for the current selection,
// with NO IPC round-trip (no getState) — so a search keystroke / filter / group change is
// reflected in the report total the instant it is made, alongside the list rows. The total
// is the billable-only reportTotalSeconds the pure deriveView sums from the snapshot's
// core-owned billableSeconds (equal to what `tt report` produces for the same selection).
function updateLiveTotal() {
  if (!state) return;
  const derived = deriveView(state, liveSelection());
  $('week-total').textContent = fmtHours(derived.reportTotalSeconds);
}

// §12 R16 / §17 R11 (issue #55): the billable-only sum of the LAST AUTHORITATIVE
// listEntries result — the selected range's report total (what `tt report` sums for the
// same selection). Only meaningful while entryGroups holds a queried set; render() falls
// back to the live snapshot estimate (or the idle week total) otherwise.
function entryGroupsTotal() {
  return entryGroups
    .flatMap((g) => g.entries)
    .filter((e) => e.billable)
    .reduce((s, e) => s + e.billableSeconds, 0);
}

// Run the current toolbar query through window.stint.listEntries (the read-only entries
// calendar read, parity with `tt list --range/--client/--project/--tag/--search`), store the
// flat, day-laid result, and repaint. Pure read — no write, no refreshAll. The search box
// rides inside the same query so range + filters + search all compose in one core call; the
// calendar (R16) lays the returned entries into its day columns intrinsically — no grouping.
async function applyEntryQuery() {
  // §17 R11: reflect the selection in the report total LIVE off the snapshot first, so the
  // total updates on the same keystroke/selection — it never waits on the async list query.
  updateLiveTotal();
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
  const q = { by: 'day', billable: entryQuery.billable };
  if (entryQuery.preset === 'custom') {
    if (!entryQuery.fromDate || !entryQuery.toDate) return; // wait for a complete date pair
    // §09 R01 (G3): a custom range is a pair of PLAIN DATES — the two fields' raw
    // `YYYY-MM-DD` strings travel verbatim; main resolves the inclusive-end-day local
    // window (the renderer constructs no Date and derives no window).
    q.fromDate = entryQuery.fromDate;
    q.toDate = entryQuery.toDate;
  } else {
    q.preset = entryQuery.preset;
  }
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

// The one-active-segment helper the report controls use: flips `.on` + aria-pressed onto
// the clicked segment and off the rest within the group.
function selectSegment(group, btn) {
  for (const b of group.querySelectorAll('.seg-btn, .preset')) {
    const on = b === btn;
    b.classList.toggle('on', on);
    if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(on));
  }
}

// Range presets (parity with `tt list --today/--week/…/--range`). A preset sends its name
// (resolved through core's resolveRange in main); Custom reveals the two plain date
// fields (§09 R01 / G3) which apply LIVE once both are set — there is no Apply button.
// This-week is the default active chip.
const elPresetSeg = $('el-preset-seg');
const elCustomRange = $('el-custom-range');
if (elPresetSeg) {
  elPresetSeg.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.preset');
    if (!btn) return;
    selectSegment(elPresetSeg, btn);
    entryQuery.preset = btn.dataset.preset;
    const custom = entryQuery.preset === 'custom';
    if (elCustomRange) elCustomRange.hidden = !custom;
    // A named preset queries immediately; Custom marks the bar active and waits for a
    // complete date pair (the two date fields below apply live) — applyEntryQuery no-ops
    // until both dates are set.
    activateEntryQuery();
  });
}
// §09 R01: the two plain date fields. Each change stores the field's raw `YYYY-MM-DD`
// string (no Date construction — main owns the plain-date → window rule) and re-queries
// LIVE once both dates are populated.
for (const id of ['el-range-from', 'el-range-to']) {
  const field = $(id);
  if (!field) continue;
  field.addEventListener('change', () => {
    entryQuery.fromDate = $('el-range-from').value || null;
    entryQuery.toDate = $('el-range-to').value || null;
    if (entryQuery.fromDate && entryQuery.toDate) activateEntryQuery();
  });
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

// §12 R08 (G7): the Entries toolbar's "This week" opens the in-shell Reports view — the
// saved-reports surface (reports.js owns it). It routes client-side via the shell router
// (route('reports')); the standalone report.html page is retired, so this never navigates
// out of the window shell. No new IPC, so no new parity row.
$('report-btn').addEventListener('click', () => route('reports'));

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

// §12 R07 (G5/G7) — manual backfill through the ONE unified entry form in ADD mode: an inline,
// two-column form (no modal) in the Entries view. The left column holds the same attributes
// `tt add` accepts (multiline description, client/project, tags, billable); the right column
// mounts the inline interval picker (§12 R15) over the collapsed Start/Stop expander (§12 R17).
// The picker updates the form's start/stop state LIVE and "Save entry" is the SOLE commit. The
// renderer stays a thin shell — it resolves nothing itself; client/project names and the
// local→UTC conversion happen in the `add` IPC handler over core, exactly like tt.
const addForm = $('add-form');

// §12 R07 (G5/G6): the add form's live tag working set — the chips mutate this array and Save
// reads it (parity with the edit form's in-form chip editor). Reset on each open so a fresh form
// never inherits a prior draft's tags.
let addFormTags = [];

function renderAddTagChips() {
  const host = $('add-tag-chips');
  if (!host) return;
  host.innerHTML = '';
  for (const t of addFormTags) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${escapeHtml(t)} <b class="chip-x" title="Remove tag">×</b>`;
    chip.querySelector('.chip-x').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const i = addFormTags.indexOf(t);
      if (i >= 0) addFormTags.splice(i, 1);
      renderAddTagChips();
      $('add-tag-input')?.focus();
    });
    host.appendChild(chip);
  }
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'add-tag-input';
  input.className = 'tag-add-input uf-tag-add';
  input.placeholder = 'add a tag…';
  input.autocomplete = 'off';
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ',') {
      ev.preventDefault();
      const name = input.value.trim();
      input.value = '';
      if (name && !addFormTags.some((t) => t.toLowerCase() === name.toLowerCase())) addFormTags.push(name);
      renderAddTagChips();
      $('add-tag-input')?.focus();
    }
  });
  host.appendChild(input);
}

// §12 R06 (G6): fill the add form's project select for the chosen client, from the same source
// tt uses (window.stint.listProjects). Disabled with a "(no project)" default until a client is
// chosen — the renderer resolves no names itself; Save sends the chosen project NAME.
async function fillAddProjects(clientId) {
  const sel = $('add-project');
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '(no project)';
  sel.appendChild(none);
  if (clientId == null) {
    sel.disabled = true;
    sel.value = '';
    return;
  }
  sel.disabled = false;
  const projects = (await window.stint.listProjects({ clientId })) || [];
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = String(p.id);
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
}

// §12 R15 (G5/G7): the ONE inline-interval-picker mount both unified-form modes (add + edit) and
// the running variant consume. It renders the picker IN FLOW into `host`, bound to the form's raw
// Start/Stop text fields — the authoritative form state "Save entry" reads — and writes them back
// LIVE on every drag (no Apply, no commit of its own). A closed span binds both inputs via
// STP.openInline (body-drag moves start+stop together; the bottom grip resizes only the stop, both
// 5-min snap); the running/open case passes endInput null and gets STP.openStartOnly — the
// START-ONLY variant, structurally incapable of computing or writing a stop (§05 R06 / G8), so it
// paints the future-fade block with a start grip only. `excludeId` drops the edited entry from the
// gray other-entry blocks (its own span is the "me" rectangle). Settings feed the ONE window
// derivation (SU.timelineWindow). Degrades to plain text entry when the picker script is absent.
function mountIntervalPicker({ host, startInput, endInput, excludeId }) {
  if (!host || !startInput || typeof window.STP === 'undefined') return;
  const common = {
    host,
    startInput,
    otherEntries: snapshotEntries(excludeId ?? null),
    settings: state?.settings ?? null,
  };
  if (!endInput) {
    if (typeof window.STP.openStartOnly === 'function') window.STP.openStartOnly(common);
    return;
  }
  if (typeof window.STP.openInline === 'function') window.STP.openInline({ ...common, endInput, onChange: () => {} });
}

// §12 R07 / §12 R15 (G7): mount the inline interval picker into the add form's right column. It
// reads the raw Start/Stop text fields (#add-from/#add-to) as its seed and writes them back LIVE on
// every drag — those fields are the authoritative form state "Save entry" reads, so the picker
// updating them IS the form-state update (no separate model). The collapsed Start/Stop expander
// drives the same fields (§12 R17). Consumes the shared mountIntervalPicker helper.
function mountAddPicker() {
  mountIntervalPicker({
    host: $('add-picker'),
    startInput: $('add-from'),
    endInput: $('add-to'),
    excludeId: null,
  });
}

async function openAddForm() {
  // One unified form at a time — close any open edit-mode form sharing this host (§12 R06/G5).
  closeEntryForm();
  // Populate the client select from the same source tt uses; a "(no client)" default keeps the
  // clientless-internal path reachable (§05 R3).
  const clients = (await window.stint.listClients()) || [];
  const clientSel = $('add-client');
  clientSel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '(no client)';
  clientSel.appendChild(none);
  for (const c of clients) {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = c.name;
    clientSel.appendChild(opt);
  }
  clientSel.value = '';
  await fillAddProjects(null);
  // A fresh attribute draft each open.
  addFormTags = [];
  renderAddTagChips();
  $('add-bill').checked = true;
  // Default the span to a sensible recent hour the user can adjust by dragging or typing.
  // Seconds are zeroed: this is a fresh DEFAULT (there is no stored truth to preserve), and the
  // picker no longer rewrites seeded fields on mount (§12 R15 / issue #49), so the default should
  // read as a clean whole-minute suggestion.
  const now = new Date();
  now.setSeconds(0, 0);
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  $('add-from').value = localInputValue(hourAgo);
  $('add-to').value = localInputValue(now);
  // Through the shared primitive, so a refusal's `error` state class cannot outlive the message
  // and leave the next OVERLAP ADVISORY wearing the block palette (design.html D15, issue 139).
  clearFormError($('add-warning'));
  // Collapse the Start/Stop expander — the inline picker is the primary picking surface (G2).
  const timesBody = $('add-times-body');
  if (timesBody) timesBody.hidden = true;
  $('add-times-toggle')?.setAttribute('aria-expanded', 'false');
  addForm.hidden = false;
  $('add-toggle').setAttribute('aria-expanded', 'true');
  // Mount the inline picker AFTER the form is visible so its column geometry measures correctly.
  mountAddPicker();
  $('add-desc').focus();
}

function closeAddForm() {
  addForm.hidden = true;
  $('add-toggle').setAttribute('aria-expanded', 'false');
  $('add-desc').value = '';
  $('add-from').value = '';
  $('add-to').value = '';
  $('add-bill').checked = true;
  addFormTags = [];
  const chips = $('add-tag-chips');
  if (chips) chips.innerHTML = '';
  const picker = $('add-picker');
  if (picker) picker.innerHTML = ''; // drop the mounted inline picker
  const timesBody = $('add-times-body');
  if (timesBody) timesBody.hidden = true;
  $('add-times-toggle')?.setAttribute('aria-expanded', 'false');
  clearFormError($('add-warning'));
}

async function submitAddForm() {
  const desc = $('add-desc').value.trim();
  const clientSel = $('add-client');
  const projectSel = $('add-project');
  // The selects carry the entity id as value + the NAME as option text; Save sends the NAME, so
  // core resolves it through the SAME single rule tt add uses (the renderer resolves nothing).
  const clientName =
    clientSel.value === '' ? '' : (clientSel.options[clientSel.selectedIndex]?.textContent || '').trim();
  const projectName =
    projectSel.value === '' ? '' : (projectSel.options[projectSel.selectedIndex]?.textContent || '').trim();
  // Fold any half-typed tag still in the add input into the working set before Save.
  const pending = $('add-tag-input');
  if (pending && pending.value.trim()) {
    const name = pending.value.trim();
    pending.value = '';
    if (!addFormTags.some((t) => t.toLowerCase() === name.toLowerCase())) addFormTags.push(name);
    renderAddTagChips();
  }
  const payload = {
    // §12 R07 (G7): Save entry is the SOLE commit — the from/to come from the raw Start/Stop
    // fields the inline picker (and the expander) keep in sync, so the `add` IPC payload shape
    // is unchanged (fromLocal/toLocal + attributes), exactly what `tt add` sends.
    fromLocal: $('add-from').value,
    toLocal: $('add-to').value,
    billable: $('add-bill').checked,
  };
  if (desc) payload.description = desc;
  if (clientName) payload.client = clientName;
  if (projectName) payload.project = projectName;
  if (addFormTags.length) payload.tags = addFormTags.slice();

  const warn = $('add-warning');
  try {
    // §06 R4: a backfill that lands on an overlapping span is warned, not blocked — the
    // entry still saves. The `add` IPC returns the uniform WriteAck (overlap warnings as
    // {kind,message,overlapsWith} objects, exactly like start/edit), so we close the form,
    // reload to repaint the durable per-row flags, then raise the SAME non-blocking inline
    // overlap banner the other write paths use (load() clears it, so applyAck runs after).
    const ack = await window.stint.add(payload);
    closeAddForm();
    await load();
    applyAck(ack);
  } catch (err) {
    // Validation rejection from core (e.g. "stop time must be after start time"): show it in
    // the form rather than throwing, so the user can correct the times. This is a
    // BLOCK (the entry did not save), distinct from the overlap WARNING above — so
    // showFormError flips the region to the --danger block palette (design.html D15).
    showFormError(warn, err);
  }
}

$('add-toggle').addEventListener('click', () => {
  if (addForm.hidden) void openAddForm();
  else closeAddForm();
});
$('add-cancel').addEventListener('click', () => closeAddForm());
addForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  await submitAddForm();
});
// §12 R06 (G6): the client select drives the project options for the chosen client (same source
// tt uses); changing the client refills the projects and clears any stale selection.
$('add-client').addEventListener('change', () =>
  void fillAddProjects($('add-client').value === '' ? null : Number($('add-client').value)),
);
// §12 R17: the collapsed Start/Stop expander toggle reveals / hides the raw exact-time fields in
// flow — the exact / overnight escape hatch. Both the picker and these fields drive the same span.
{
  const toggle = $('add-times-toggle');
  const body = $('add-times-body');
  if (toggle && body) {
    toggle.addEventListener('click', () => {
      const open = body.hidden;
      body.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    });
  }
}

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
      window.STP.openStartOnly({
        host: leStartDisc,
        startInput: leStart, // the ONLY binding — this variant takes no end input at all
        otherEntries: snapshotEntries(state?.status?.entry?.id ?? null),
        settings: state?.settings ?? null,
      });
      leStartDisc.hidden = false;
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

// §07/§12: an external change (a tt write) repaints whichever view is active.
window.stint.onChange(() => {
  if (activeView === 'clients') void renderClients();
  // §12 R14: on the Timer view a tt write repaints both the favorites rail AND the
  // Active-Timer card + live-edit strip (a tt start/stop/edit changes the running state), so
  // the in-window timer surface tracks the other surface (parity). load() refreshes `state`
  // (→ render() repaints the card + live-edit strip); renderFavorites repaints the rail.
  else if (activeView === 'timer') void load().then(() => renderFavorites());
  // §12 R10 / §06 R06: on the Entries view, don't blow away an OPEN unified editor on a refresh.
  // The form's own writes repaint the affected region in place — the reversible sleep subtract/
  // restore (§12 R10) re-reads the toggled entry and repaints its flags region without leaving the
  // editor — and a mid-edit reload would also discard the user's unsaved field edits. Once the form
  // closes (Cancel / Save / Delete each reload themselves), the next refresh repaints normally.
  else if (document.querySelector('.entry.editing')) return;
  else void load();
});
setInterval(tick, 1000);
// §12 R3: open on the Entries view (the default active route) so the nav highlight and the
// shown section are consistent from the first paint, then load its data.
route('entries');
syncStandingPrimary();
load();
