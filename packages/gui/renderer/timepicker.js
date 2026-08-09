// §12 R15 (G5/G7) — the inline interval picker (window.STP). A pure renderer affordance that
// binds a pair of authoritative local-time text inputs (`YYYY-MM-DD HH:mm:ss`) and lets the user
// DRAG a span on a single-day calendar column instead of typing it. It exposes two INLINE forms
// (there is NO modal — the picker only ever renders IN FLOW, never over a backdrop):
//   • STP.openInline — the unified entry form's INLINE start+stop picker (mounted in flow into
//     the form's picker host over the raw Start/Stop text fields, add mode §12 R07 / edit mode R06);
//   • STP.openStartOnly — the running entry's INLINE start-only disclosure (#le-start, §05 R06).
// It adds ZERO capabilities: it only ever writes localInputValue-formatted strings BACK into those
// existing text inputs (and dispatches `input`/`change`), so the unchanged add/edit IPC paths stay
// the single source of truth and the text fields stay authoritative. No new IPC channel, no parity
// row — the picker never talks to core, the DB, or the network.
//
// Classic script (window.STP) loaded alongside the bundled SU entry (dist/su.js) and
// app.js. Pure DOM: no Node imports, no core-package import, no network (the renderer-static
// guard asserts this). Accent discipline (design.html D11 / V3): the dragged "me" block is
// accent-OUTLINED over the weak accent fill with ink labels (solid accent is reserved for
// primary actions; the accent signal rides the block's outline and grips), and the selected
// calendar day is a raised paper chip (design.html D12); every other control is monochrome.
// There is no primary "Apply" button — the picker writes live and the surrounding form's
// "Save entry" is the sole commit (G7).
//
// Mirrors context/mockups/edit-entry.html: a month calendar (pick the day) + a single-day
// column with hour lines; the edited entry is a draggable accent-outlined rectangle (drag the BODY
// moves start+stop together, drag the BOTTOM handle resizes the stop, both 5-min snap);
// other entries render gray, overlap regions render yellow (warn-only, never blocks the save).
// Overnight (stop on a later day) is handled only via the text fields / the Start/Stop expander —
// the visual column is single-day.
//
// §05 R06 / §12 R14 (G8) — the START-ONLY variant for the RUNNING entry. Opened with no end
// binding, the picker renders the running block with a START drag grip ONLY: no bottom
// resize grip, no end time label, no end echo field. The block carries the `open` class and
// dissolves toward the future via a transparency mask (mockups/timer.html .block.me.open) —
// the end does not exist until the timer is stopped, so nothing may paint or write one. The
// start-only write path is STRUCTURALLY incapable of producing an end value: there is no end
// binding, no end minute is ever computed, defaulted to "now", or written — drags move only
// the bound start. STP.openStartOnly() is the Timer view's inline disclosure form of the same
// variant (in flow below the Start field — no backdrop, no modal chrome, no Apply): every
// grip drag 5-min-snaps and writes the bound start input LIVE, riding the surrounding form's
// existing input/change listeners.
window.STP = (function () {
  // ---- pure geometry / snap helpers (deterministic, no DOM) ------------------------
  // Exposed on window.STP so the renderer-static guard and JUDGE can drive them directly.
  const MS_PER_MIN = 60 * 1000;
  const SNAP_MIN = 5;
  const DAY_MIN = 24 * 60;
  // The single-day column geometry: TRACK_H px tall, top = 00:00, bottom = 24:00.
  const TRACK_H = 24 * 30; // 720px = 30px/hour, so 1 minute = 0.5px (deterministic).

  // Round a minute-of-day to the nearest 5-minute grid step, clamped to [0, 1440].
  // §12 R15 (issue #49): snapTo5 applies ONLY to a handle the user is actively dragging (and to
  // drag clamps) — NEVER to a seeded/stored value. Opening the picker over an entry must paint
  // (and leave in the bound fields) the entry's exact stored times, to the second.
  function snapTo5(minutes) {
    const snapped = Math.round(minutes / SNAP_MIN) * SNAP_MIN;
    return Math.max(0, Math.min(DAY_MIN, snapped));
  }
  // Minute-of-day → y pixel on the track (linear; 00:00 at the top).
  function minutesToY(minutes) {
    return (minutes / DAY_MIN) * TRACK_H;
  }
  // y pixel on the track → minute-of-day (the inverse of minutesToY; not snapped).
  function yToMinutes(y) {
    return (y / TRACK_H) * DAY_MIN;
  }

  // Zero-pad to two digits (the one padding helper for this module).
  function pad(n) {
    return String(n).padStart(2, '0');
  }
  // The shared display helpers, off window.SU (dist/su.js loads first in index.html — the
  // picker never reaches core itself). localInputValue is the single local-time seed format
  // (`YYYY-MM-DD HH:mm:ss`, no timezone) written back into the bound text inputs, and
  // parseLocalInput is its ONE inverse — the same pair the byte gate and the add IPC use — so the
  // picker, the raw Start/Stop fields, and the split instant agree byte-for-byte; localMinuteOfDay
  // / exactMinuteOfDay are the ONE minutes-of-day derivation every timeline surface positions
  // against, so a timezone or DST fix has a single site to find (issue #168).
  const {
    localInputValue, parseLocalInput, localMinuteOfDay, exactMinuteOfDay, timelineWindow,
    localDayOf, startOfDay,
  } = window.SU;
  function hhmm(minutes) {
    // Floor, not round: an exact seed carries fractional minutes (seconds ride the fraction,
    // issue #49), and 09:07:33 must label as 09:07 — the minute the bound field shows — not 09:08.
    // Dragged values are whole grid minutes, for which floor and round agree.
    const m = Math.floor(minutes);
    return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  }
  // The CONFIGURED zone's Y-M-D the column is drawn against (§04 R06 — SU.localDayOf is
  // core's localDay in the configured zone); the calendar selection sets this.
  function sameLocalDay(a, b) {
    return localDayOf(a) === localDayOf(b);
  }
  // The configured zone's midnight of the day an instant falls on (SU.startOfDay —
  // calendar arithmetic via core's wallClockToUtc, DST-compatible).
  function startOfLocalDay(date) {
    return startOfDay(date);
  }
  // Build the instant on `day`'s configured-zone calendar day at `minute` of that day
  // (minute may exceed the column for labels; the geometry clamps before this is called).
  // `minute` may be FRACTIONAL (an exact seed carries seconds in the fraction, issue #49) —
  // SU.dateAtMinute rounds to whole seconds so 547.55 min inverts to exactly 09:07:33,
  // never a float-drifted 09:07:32.999.
  function dateAtMinute(day, minute) {
    return window.SU.dateAtMinute(day, minute);
  }
  // The configured zone's civil {y, m (0-based), d} of an instant — the mini calendar's
  // month arithmetic works in civil numbers (via localDayOf), never OS-zone Date getters,
  // so a pinned zone across the dateline from the OS still selects the right cells.
  function civilParts(date) {
    const [y, m, d] = localDayOf(date).split('-').map(Number);
    return { y, m: m - 1, d };
  }

  // Other entries clamped to `day`, as [from,to] minute pairs (drawn gray, warn-only).
  // Shared by the popover column and the inline start-only disclosure.
  function othersOnDayFor(day, others) {
    const out = [];
    const dayStart = startOfLocalDay(day);
    const dayEnd = new Date(dayStart.getTime() + DAY_MIN * MS_PER_MIN);
    for (const e of others) {
      if (!e || e.startUtc == null) continue;
      const s = new Date(e.startUtc);
      const t = e.endUtc != null ? new Date(e.endUtc) : new Date();
      if (t <= dayStart || s >= dayEnd) continue; // entirely off this day
      const from = s <= dayStart ? 0 : localMinuteOfDay(s);
      const to = t >= dayEnd ? DAY_MIN : localMinuteOfDay(t);
      out.push({ from, to, label: e.description || '(no description)' });
    }
    return out;
  }

  // §05 R06 — the VISIBLE bottom edge of the running block on `day`: the current wall-clock
  // minute (the block runs start → "so far"), or the end of the column day when the entry
  // started on an earlier day. Painting only — this minute is NEVER an end value: the
  // start-only paths carry no end binding, so no end can be computed, defaulted, or written.
  function runningEdgeMin(day, startMin) {
    const now = new Date();
    if (sameLocalDay(now, day)) return Math.max(startMin + SNAP_MIN, localMinuteOfDay(now));
    return DAY_MIN;
  }

  // Paint the 25 hour lines/labels onto a fresh track element (00:00 … 24:00).
  function paintHourLabels(track) {
    for (let h = 0; h <= 24; h++) {
      const lbl = document.createElement('span');
      lbl.className = 'stp-hour';
      lbl.style.top = `${minutesToY(h * 60)}px`;
      lbl.textContent = `${pad(h % 24)}:00`;
      track.appendChild(lbl);
    }
  }

  // Paint the gray other-entry blocks for `day` onto a track element.
  function paintOtherBlocks(track, day, others) {
    for (const o of othersOnDayFor(day, others)) {
      const block = document.createElement('div');
      block.className = 'stp-block other';
      block.style.top = `${minutesToY(o.from)}px`;
      block.style.height = `${Math.max(2, minutesToY(o.to) - minutesToY(o.from))}px`;
      block.textContent = o.label;
      track.appendChild(block);
    }
  }

  // Read a bound field's local text as a Date (null when blank/unreadable) through the ONE
  // inverse of the seed format — so a user who typed the `T` spelling still re-anchors the
  // column (issue #159).
  function parseInput(input) {
    if (!input || !input.value) return null;
    const d = parseLocalInput(input.value);
    return isNaN(d.getTime()) ? null : d;
  }

  // §12 R17 — guard so the picker's OWN write-backs don't re-trigger openInline's expander-reflect
  // listeners (which watch the same bound fields for EXTERNAL edits). True only for the synchronous
  // span of a writeBack dispatch; the reseed listener ignores events fired while it is set, so a
  // drag never feeds itself back through the reflect path.
  let writingBack = false;

  // Write a Date back into a bound text input as a local YYYY-MM-DD HH:mm:ss string, and fire an
  // `input` event so the surrounding form's listeners (e.g. the running live-edit's change /
  // the add form's submit read) see it exactly as if the user typed it. The text stays
  // authoritative — the picker only ever sets `.value` here.
  function writeBack(input, date) {
    if (!input) return;
    input.value = localInputValue(date);
    writingBack = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    writingBack = false;
  }

  /**
   * §05 R06 / §12 R14 (G8) — STP.openStartOnly({ host, startInput, otherEntries, settings })
   * — the Timer view's INLINE start-only disclosure. Renders the single-day track IN FLOW
   * into `host` (no backdrop, no dialog/modal chrome, no Apply): the running entry is the
   * accent-outlined block fading into the future (`.stp-block.me.open`), with a START drag grip only
   * — no bottom resize grip, no end label, no end echo field. Every grip drag 5-min-snaps
   * and writes the bound start input LIVE (writeBack fires input+change, so the live-edit
   * strip's existing debounced commit path picks it up). This path is STRUCTURALLY incapable
   * of producing an end value: it takes no end binding and computes no end minute — the
   * running block's painted extent is the wall clock, never a value.
   *
   * The default scroll viewport comes from SU.timelineWindow (§14/G16 — the ONE window
   * derivation; never re-derived here), centered on the edited (running) interval. The
   * viewport carries the `data-timeline-track` hook the TIMELINE_WINDOW judge scene probes.
   */
  function openStartOnly(opts = {}) {
    const host = opts.host || null;
    const startInput = opts.startInput || null;
    if (!host || !startInput) return null;
    const others = Array.isArray(opts.otherEntries) ? opts.otherEntries : [];
    host.innerHTML = '';

    // Seed from the bound start input (the running entry's start); drags stay on its day.
    // EXACT, never snapped (issue #49): the painted block shows the stored start as-is; the
    // 5-min snap applies only once the user actually drags the grip.
    const startDate = parseInput(startInput) || new Date();
    const columnDay = startOfLocalDay(startDate);
    let startMin = exactMinuteOfDay(startDate);

    const box = document.createElement('div');
    box.className = 'stp stp-inline stp-start-only';
    box.innerHTML =
      `<div class="stp-dayview" data-timeline-track><div class="stp-track"></div></div>` +
      `<div class="stp-snaphint"><span class="stp-snap">snap · 5 min</span>` +
      `<span>Drag the grip to adjust the start — the running entry has no end until you stop it</span></div>`;
    host.appendChild(box);
    const viewport = box.querySelector('.stp-dayview');
    const track = box.querySelector('.stp-track');

    function pointerMin(clientY) {
      return yToMinutes(clientY - track.getBoundingClientRect().top);
    }
    function wireGrip(grip) {
      grip.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        const grabMin = pointerMin(ev.clientY);
        const base = startMin;
        grip.setPointerCapture?.(ev.pointerId);
        const onMove = (mv) => {
          const next = snapTo5(base + (pointerMin(mv.clientY) - grabMin));
          startMin = Math.max(0, Math.min(runningEdgeMin(columnDay, 0), next));
          // LIVE write-back of the START only — the sole write this variant can make.
          writeBack(startInput, dateAtMinute(columnDay, startMin));
          renderTrack();
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    }
    function renderTrack() {
      track.innerHTML = '';
      paintHourLabels(track);
      paintOtherBlocks(track, columnDay, others);
      // The running block: start → "so far", dissolving into the future (class `open`).
      const me = document.createElement('div');
      me.className = 'stp-block me open';
      const top = minutesToY(startMin);
      me.style.top = `${top}px`;
      me.style.height = `${Math.max(18, minutesToY(runningEdgeMin(columnDay, startMin)) - top)}px`;
      track.appendChild(me);
      // Time label + start grip live at TRACK level so the fade never hides them (mockup).
      const lab = document.createElement('span');
      lab.className = 'stp-tlabel';
      lab.style.top = `${top + 4}px`;
      lab.textContent = hhmm(startMin);
      track.appendChild(lab);
      const grip = document.createElement('span');
      grip.className = 'stp-grip';
      grip.style.top = `${top - 3}px`;
      grip.setAttribute('aria-label', 'Drag to adjust start');
      track.appendChild(grip);
      wireGrip(grip);
    }
    renderTrack();

    // Default scroll window (§14/G16): SU.timelineWindow centered on the running interval.
    // Unguarded, like every other SU call: dist/su.js is loaded first, so a local fallback
    // window would be dead code that re-hardcodes a working-hours default core owns (#168).
    const win = timelineWindow(opts.settings || null, new Date().toISOString(), {
      startUtc: startDate.toISOString(),
      endUtc: null,
    });
    viewport.scrollTop = Math.round(minutesToY(win.startMin));
    return box;
  }

  /**
   * §12 R07 / §12 R15 (G5/G7) — STP.openInline({ host, startInput, endInput, otherEntries,
   * settings, onChange }) — the UNIFIED ENTRY FORM's inline interval picker (add + edit modes).
   * Renders a month calendar + a scrollable single-day column IN FLOW into `host` (no backdrop,
   * no dialog/modal chrome, no Apply): the edited span is a draggable accent "me" rectangle —
   * drag the BODY moves start+stop together, drag the BOTTOM grip resizes the stop, both 5-min
   * snap. Other entries paint gray; the overlapping span paints yellow (warn-only, never blocks).
   *
   * §12 R15 (issue #49) — EXACT stored times: the picker seeds from the bound inputs WITHOUT
   * snapping (seconds preserved) and never writes back on mount, so opening an editor shows the
   * entry's stored start/stop to the second and Save with no drag round-trips them unchanged.
   * Snapping applies ONLY to a handle the user actively drags: a body drag snaps the start and
   * preserves the exact duration; a bottom-grip drag snaps the stop the user is dragging.
   *
   * Every drag AND every calendar day-pick writes the picked LOCAL instants BACK into the bound
   * start+stop text inputs LIVE (writeBack fires input+change) AND calls onChange — so the form's
   * start/stop state tracks the picker live (G7) and "Save entry" (which reads those inputs) is
   * the sole commit. Text stays authoritative: the picker only ever sets the inputs' `.value`.
   * Overnight spans can't be dragged on the single-day column — the collapsed Start/Stop expander
   * (§12 R17) is the exact/overnight path, and it drives the SAME bound inputs. No IPC, no network.
   *
   * The default scroll viewport comes from SU.timelineWindow (§14/G16 — the ONE window derivation,
   * never re-derived here), centered on the seeded interval; the viewport carries the
   * `data-timeline-track` hook the TIMELINE_WINDOW judge scene probes.
   */
  function openInline(opts = {}) {
    const host = opts.host || null;
    const startInput = opts.startInput || null;
    const endInput = opts.endInput || null;
    if (!host || !startInput) return null;
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};
    const others = Array.isArray(opts.otherEntries) ? opts.otherEntries : [];
    host.innerHTML = '';

    // Seed the span from the bound inputs, else last-stop→now (the same default open() uses).
    // Remember which inputs were BLANK: mounting may seed those, but a POPULATED field is stored
    // truth — the mount never rewrites it (issue #49); only a user drag / day-pick writes back.
    const now = new Date();
    let startDate = parseInput(startInput);
    let endDate = parseInput(endInput);
    const startWasBlank = !startDate;
    const endWasBlank = !endDate;
    if (!startDate) {
      let lastStop = null;
      for (const e of others) {
        if (!e || e.endUtc == null) continue;
        const t = new Date(e.endUtc);
        if (!lastStop || t > lastStop) lastStop = t;
      }
      startDate = lastStop && lastStop < now ? lastStop : new Date(now.getTime() - 60 * MS_PER_MIN);
    }
    if (!endDate) endDate = new Date(Math.max(startDate.getTime() + 30 * MS_PER_MIN, now.getTime()));

    // EXACT seed, never snapped (issue #49): the column paints the bound fields' instants to the
    // second (seconds ride the minute fraction). snapTo5 fires only inside the drag handlers.
    let columnDay = startOfLocalDay(startDate);
    let startMin = exactMinuteOfDay(startDate);
    let endMin = exactMinuteOfDay(endDate);
    // §12 R17 — a stop on a LATER local day than the start is an OVERNIGHT span. The single-day
    // drag column can't draw it, so it stays on the START's day (endMin painted to the column foot)
    // and the bound stop TEXT field — the collapsed Start/Stop expander — stays authoritative for the
    // real cross-midnight stop. `overnightActive` tracks that state; commit() then leaves the stop
    // field untouched (never flattening it to same-day), and a drag (inherently same-day) clears it.
    let overnightActive = false;
    if (!sameLocalDay(startDate, endDate)) {
      endMin = DAY_MIN;
      overnightActive = true;
    }
    if (endMin <= startMin) endMin = Math.min(DAY_MIN, startMin + SNAP_MIN);

    const box = document.createElement('div');
    box.className = 'stp stp-inline stp-range';
    box.innerHTML =
      `<div class="stp-body">` +
      `<div class="stp-cal">` +
      `<div class="stp-cal-head"><span class="stp-month"></span>` +
      `<span class="stp-nav">` +
      `<button type="button" class="stp-prev" aria-label="Previous month"><svg class="ic" aria-hidden="true"><use href="#i-left" /></svg></button>` +
      `<button type="button" class="stp-next" aria-label="Next month"><svg class="ic" aria-hidden="true"><use href="#i-right" /></svg></button>` +
      `</span></div>` +
      `<div class="stp-grid"></div>` +
      `</div>` +
      `<div class="stp-day">` +
      `<div class="stp-day-lbl"></div>` +
      `<div class="stp-dayview" data-timeline-track><div class="stp-track"></div></div>` +
      `</div>` +
      `</div>` +
      `<div class="stp-snaphint"><span class="stp-snap">snap · 5 min</span>` +
      `<span>Drag the span to set start &amp; stop — or type exact times below</span></div>`;
    host.appendChild(box);
    const track = box.querySelector('.stp-track');
    const viewport = box.querySelector('.stp-dayview');

    // §12 R17 — a tabular ECHO of the current shared interval, mounted beneath the calendar in the
    // calcol (mockup edit-entry.html .xp): "HH:MM – HH:MM", or "HH:MM –" when the stop is empty (an
    // open/running entry). It is a passive readout of the ONE shared interval — the SAME values the
    // collapsed Start/Stop expander's raw text fields and the drag both drive — refreshed by
    // updateEcho() on every render (below) and on every external edit of the bound fields, so the
    // collapsed echo, the picker column, and the expander text never disagree.
    const echoEl = document.createElement('div');
    echoEl.className = 'stp-echo tnum';
    box.querySelector('.stp-cal').appendChild(echoEl);
    function updateEcho() {
      const startTxt = hhmm(startMin);
      let stopTxt = '';
      if (overnightActive) {
        // The real stop lives in the bound field (a later day than the column); echo it verbatim.
        const e = parseInput(endInput);
        stopTxt = e ? hhmm(localMinuteOfDay(e)) : '';
      } else if (endInput && parseInput(endInput)) {
        stopTxt = hhmm(endMin);
      }
      echoEl.textContent = stopTxt ? `${startTxt} – ${stopTxt}` : `${startTxt} –`;
    }

    // The sole write path: push the picked instants into the bound inputs LIVE and notify the
    // form. Called on every drag and on a calendar day change — NEVER on mount (issue #49):
    // mounting must not rewrite the entry's exact stored times (a day-pick preserves the exact
    // time-of-day, seconds included; only the dragged handle itself lands on the 5-min grid).
    function commit() {
      writeBack(startInput, dateAtMinute(columnDay, startMin));
      // §12 R17: while an OVERNIGHT stop stands in the bound field, the column's same-day endMin is
      // only a paint — writing it back would flatten the cross-midnight stop, so the stop field is
      // left untouched (authoritative). A drag clears overnightActive first, so a dragged span
      // writes BOTH ends and commits identically to a same-day one.
      if (endInput && !overnightActive) writeBack(endInput, dateAtMinute(columnDay, endMin));
      onChange({ startMin, endMin });
    }

    // ---- month calendar (pick the day) --------------------------------------------
    // The calendar works in CIVIL {y, m} numbers of the CONFIGURED zone (civilParts —
    // never OS-zone Date getters, which read the wrong civil day when the configured zone
    // sits across midnight from the OS). Cell dates render/compare through UTC-anchored
    // civil math and become instants only on click, via SU.dateAtMinute's day mapping.
    let calMonth = (({ y, m }) => ({ y, m }))(civilParts(columnDay));
    // A representative instant of a civil day, for the zone-free label/dow math below.
    const civilUtc = (y, m, d) => new Date(Date.UTC(y, m, d));
    const dayToken = (y, m, d) =>
      `${y}-${pad(m + 1)}-${pad(d)}`;
    function renderCalendar() {
      box.querySelector('.stp-month').textContent = civilUtc(calMonth.y, calMonth.m, 1)
        .toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const grid = box.querySelector('.stp-grid');
      grid.innerHTML = '';
      for (const dow of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) {
        const h = document.createElement('span');
        h.className = 'stp-dow';
        h.textContent = dow;
        grid.appendChild(h);
      }
      const lead = (civilUtc(calMonth.y, calMonth.m, 1).getUTCDay() + 6) % 7;
      const daysInMonth = civilUtc(calMonth.y, calMonth.m + 1, 0).getUTCDate();
      for (let i = 0; i < lead; i++) {
        const blank = document.createElement('span');
        blank.className = 'stp-d stp-mut';
        grid.appendChild(blank);
      }
      const todayToken = localDayOf(new Date());
      const selectedToken = localDayOf(columnDay);
      for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'stp-d';
        const token = dayToken(calMonth.y, calMonth.m, day);
        if (token === selectedToken) cell.classList.add('stp-sel');
        if (token === todayToken) cell.classList.add('stp-today');
        cell.textContent = String(day);
        cell.addEventListener('click', () => {
          // The clicked civil day's configured-zone midnight becomes the new column anchor.
          columnDay = window.SU.dayStartOfToken(token);
          renderCalendar();
          renderTrack();
          commit(); // moving the span to another day is a live form-state change
        });
        grid.appendChild(cell);
      }
    }
    box.querySelector('.stp-prev').addEventListener('click', () => {
      calMonth = calMonth.m === 0 ? { y: calMonth.y - 1, m: 11 } : { y: calMonth.y, m: calMonth.m - 1 };
      renderCalendar();
    });
    box.querySelector('.stp-next').addEventListener('click', () => {
      calMonth = calMonth.m === 11 ? { y: calMonth.y + 1, m: 0 } : { y: calMonth.y, m: calMonth.m + 1 };
      renderCalendar();
    });

    // ---- single-day column --------------------------------------------------------
    function overlapsOnDay() {
      const out = [];
      for (const o of othersOnDayFor(columnDay, others)) {
        const from = Math.max(startMin, o.from);
        const to = Math.min(endMin, o.to);
        if (to > from) out.push({ from, to });
      }
      return out;
    }
    function renderTrack() {
      box.querySelector('.stp-day-lbl').textContent = columnDay.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: window.SU.currentZone(), // the column IS a configured-zone day (§04 R06)
      });
      track.innerHTML = '';
      paintHourLabels(track);
      paintOtherBlocks(track, columnDay, others);
      const me = document.createElement('div');
      me.className = 'stp-block me';
      me.style.top = `${minutesToY(startMin)}px`;
      me.style.height = `${Math.max(6, minutesToY(endMin) - minutesToY(startMin))}px`;
      me.innerHTML =
        `<span class="stp-lab-top">${hhmm(startMin)}</span>` +
        `<span class="stp-lab-bot">${hhmm(endMin)}</span>` +
        `<span class="stp-resize" aria-label="Resize stop"><i></i></span>`;
      track.appendChild(me);
      for (const ov of overlapsOnDay()) {
        const o = document.createElement('div');
        o.className = 'stp-overlap';
        o.style.top = `${minutesToY(ov.from)}px`;
        o.style.height = `${Math.max(2, minutesToY(ov.to) - minutesToY(ov.from))}px`;
        o.innerHTML = `<span class="stp-otag">overlap ${Math.round(ov.to - ov.from)}m</span>`;
        track.appendChild(o);
      }
      wireDrag(me);
      updateEcho(); // keep the collapsed echo in lockstep with the column on every repaint
    }

    // ---- dragging (5-min snap, live commit) ---------------------------------------
    function pointerMinutes(clientY) {
      return yToMinutes(clientY - track.getBoundingClientRect().top);
    }
    function wireDrag(me) {
      const resize = me.querySelector('.stp-resize');
      const startDrag = (ev) => {
        if (resize && (ev.target === resize || resize.contains(ev.target))) return;
        ev.preventDefault();
        const grabMin = pointerMinutes(ev.clientY);
        const span = endMin - startMin;
        const baseStart = startMin;
        me.setPointerCapture?.(ev.pointerId);
        const onMove = (mv) => {
          const delta = pointerMinutes(mv.clientY) - grabMin;
          let nextStart = snapTo5(baseStart + delta);
          nextStart = Math.max(0, Math.min(DAY_MIN - span, nextStart));
          startMin = nextStart;
          endMin = nextStart + span;
          overnightActive = false; // a drag is inherently same-day — it supersedes any typed overnight stop
          renderTrack();
          commit(); // §12 R07 (G7): the form's start/stop state updates on every drag step
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      };
      me.addEventListener('pointerdown', startDrag);
      if (resize) {
        resize.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          resize.setPointerCapture?.(ev.pointerId);
          const onMove = (mv) => {
            let nextEnd = snapTo5(pointerMinutes(mv.clientY));
            nextEnd = Math.max(startMin + SNAP_MIN, Math.min(DAY_MIN, nextEnd));
            endMin = nextEnd;
            overnightActive = false; // resizing the stop on the single-day column makes it same-day
            renderTrack();
            commit();
          };
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        });
      }
    }

    renderCalendar();
    renderTrack();
    // §12 R15 (issue #49): mounting is NOT an edit. A field that arrived POPULATED holds the
    // entry's exact stored instant (to the second) and stays byte-untouched — so Save with no
    // drag round-trips start/stop unchanged. Only a field that arrived BLANK is seeded, from the
    // same derived default span the column paints. The form is still notified either way.
    if (startWasBlank) writeBack(startInput, dateAtMinute(columnDay, startMin));
    if (endInput && endWasBlank && !overnightActive) writeBack(endInput, dateAtMinute(columnDay, endMin));
    onChange({ startMin, endMin });

    // §12 R17 — reflect an EXTERNAL edit of the bound Start/Stop fields (the collapsed expander's raw
    // text inputs) back into the picker: re-anchor the single-day column + span on the typed start,
    // detect an overnight stop (a later local day), and repaint — WITHOUT writing back, so the typed
    // text stays authoritative and a cross-midnight stop is never flattened. This is the ONE shared
    // interval state the drag also mutates — there is no second source of truth. A half-typed /
    // unparseable value contributes nothing (the column simply holds its last valid state).
    function reseedFromInputs() {
      const s = parseInput(startInput);
      if (!s) return; // need a valid start to anchor the single-day column
      // EXACT, never snapped (issue #49): the typed text is authoritative and the column paints
      // it as-is — snapping a typed 09:12:44 to the grid would misrepresent the field.
      columnDay = startOfLocalDay(s);
      startMin = exactMinuteOfDay(s);
      const e = parseInput(endInput);
      if (!e) {
        overnightActive = false;
        endMin = Math.min(DAY_MIN, startMin + SNAP_MIN);
      } else if (!sameLocalDay(s, e)) {
        overnightActive = true; // stop on a later day → overnight; column stays on the start's day
        endMin = DAY_MIN;
      } else {
        overnightActive = false;
        endMin = exactMinuteOfDay(e);
        if (endMin <= startMin) endMin = Math.min(DAY_MIN, startMin + SNAP_MIN);
      }
      calMonth = (({ y, m }) => ({ y, m }))(civilParts(columnDay));
      renderCalendar();
      renderTrack(); // repaints the column AND refreshes the echo (updateEcho at its foot)
    }
    // The picker's own writeBack fires input/change (guarded by `writingBack`); only a GENUINE
    // external edit — the user typing in the expander — reseeds the column + echo.
    for (const input of [startInput, endInput]) {
      if (!input) continue;
      const reflect = () => {
        if (!writingBack) reseedFromInputs();
      };
      input.addEventListener('input', reflect);
      input.addEventListener('change', reflect);
    }

    // Default scroll window (§14/G16): SU.timelineWindow centered on the seeded interval.
    const win = timelineWindow(opts.settings || null, new Date().toISOString(), {
      startUtc: dateAtMinute(columnDay, startMin).toISOString(),
      endUtc: dateAtMinute(columnDay, endMin).toISOString(),
    });
    viewport.scrollTop = Math.round(minutesToY(win.startMin));
    return box;
  }

  return { openStartOnly, openInline, snapTo5, minutesToY, yToMinutes, TRACK_H };
})();
