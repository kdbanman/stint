// §12 R15 (G9) — the visual time-range picker (window.STP). A pure renderer affordance
// that opens over a pair of authoritative datetime-local text inputs (#add-from/#add-to,
// the inline .edit-start/.edit-end, or the running #le-start) and lets the user DRAG a
// span on a single-day calendar column instead of typing it. It adds ZERO capabilities:
// it only ever writes localInputValue-formatted strings BACK into those existing text
// inputs (and dispatches an `input` event), so the unchanged add/edit IPC paths stay the
// single source of truth and the text fields stay authoritative. No new IPC channel, no
// parity row — the picker never talks to core, the DB, or the network.
//
// Classic script (window.STP, no ES modules) so it loads over file:// alongside util.js /
// editor.js / app.js. Pure DOM: no Node imports, no core-package import, no network (the
// renderer-static guard asserts this). Accent discipline (§15): only the primary
// "Apply range" button and the dragged "me" rectangle carry the accent; every other
// control is monochrome — the JUDGE ACCENT_DISCIPLINE probe sanctions `.stp .primary`
// and `.stp-block.me` so the picker does not trip the accent scan.
//
// Mirrors context/mockups/time-range-picker.html: a month calendar (pick the day) + a single-day
// column with hour lines; the edited entry is a draggable accent rectangle (drag the BODY
// moves start+stop together, drag the BOTTOM handle resizes the stop, both 5-min snap);
// other entries render gray, overlap regions render yellow (warn-only, never blocks Apply).
// Overnight (stop on a later day) is handled only via the text fields, with a footer note —
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
  // datetime-local wants `YYYY-MM-DDTHH:mm` in *local* time (no timezone suffix). Mirrors
  // app.js / editor.js localInputValue so the picker writes back byte-identical strings.
  function localInputValue(date) {
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }
  function hhmm(minutes) {
    const m = Math.round(minutes);
    return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  }
  // Minute-of-day for a Date in local time.
  function localMinuteOfDay(date) {
    return date.getHours() * 60 + date.getMinutes();
  }
  // The local Y-M-D the column is drawn against; the calendar selection sets this.
  function sameLocalDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }
  function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  }
  // Build a local Date on `day` at `minute` of that day (minute may exceed the column for
  // labels; the geometry clamps before this is called).
  function dateAtMinute(day, minute) {
    const d = startOfLocalDay(day);
    d.setMinutes(minute);
    return d;
  }

  // Remove any open picker popover (only one at a time). Used by close + before re-open.
  function closePicker() {
    document.querySelector('.stp-backdrop')?.remove();
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

  // Parse a datetime-local text input value into a local Date (null when blank/invalid).
  function parseInput(input) {
    if (!input || !input.value) return null;
    const d = new Date(input.value);
    return isNaN(d.getTime()) ? null : d;
  }

  // Write a Date back into a bound text input as a local datetime-local string, and fire an
  // `input` event so the surrounding form's listeners (e.g. the running live-edit's change /
  // the add form's submit read) see it exactly as if the user typed it. The text stays
  // authoritative — the picker only ever sets `.value` here.
  function writeBack(input, date) {
    if (!input) return;
    input.value = localInputValue(date);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * STP.open({ startInput, endInput, otherEntries, onApply }) — open the picker over a pair
   * of bound text inputs.
   *   startInput  — the authoritative start datetime-local input (required).
   *   endInput    — the authoritative stop datetime-local input. Omit (null) for the
   *                 running start-only case (edit-running-start): the picker never writes a
   *                 stop and shows only a start handle (no resize, no end label).
   *   otherEntries — the snapshot's entries ({startUtc,endUtc,description}) to draw gray on
   *                 the column; overlaps with the "me" span paint yellow (warn-only).
   *   onApply     — invoked after Apply writes the inputs (so app.js can react if needed).
   *
   * Default span = the values currently parsed from the bound inputs, else last-stop→now
   * (the latest other-entry stop → now, or an hour ago → now when there is none). Apply
   * writes the inputs and fires onApply; Cancel / backdrop dismiss without writing.
   */
  function open(opts = {}) {
    closePicker();
    const startInput = opts.startInput || null;
    const endInput = opts.endInput || null;
    const startOnly = !endInput; // the running-start case: no stop, no resize
    const onApply = typeof opts.onApply === 'function' ? opts.onApply : () => {};
    const others = Array.isArray(opts.otherEntries) ? opts.otherEntries : [];

    // ---- default span (G9) --------------------------------------------------------
    const now = new Date();
    let startDate = parseInput(startInput);
    let endDate = startOnly ? null : parseInput(endInput);
    if (!startDate) {
      // last-stop → now: the latest other-entry stop, else an hour ago.
      let lastStop = null;
      for (const e of others) {
        if (!e || e.endUtc == null) continue;
        const t = new Date(e.endUtc);
        if (!lastStop || t > lastStop) lastStop = t;
      }
      startDate = lastStop && lastStop < now ? lastStop : new Date(now.getTime() - 60 * MS_PER_MIN);
    }
    if (!startOnly && !endDate) endDate = new Date(Math.max(startDate.getTime() + 30 * MS_PER_MIN, now.getTime()));

    // The single-day column is drawn against the start's local day. Overnight spans (stop on
    // a later day) cannot be expressed by dragging — the footer note steers the user to text.
    let columnDay = startOfLocalDay(startDate);

    // The "me" span as minutes-of-day on the column day, snapped to the 5-min grid. For a
    // stop on a different (later) day the column clamps the visible stop to end-of-day; the
    // authoritative value still comes from the text field on Apply only when same-day.
    let startMin = snapTo5(localMinuteOfDay(startDate));
    let endMin = startOnly ? null : snapTo5(localMinuteOfDay(endDate));
    // Overnight when the stop's local day is after the start's local day.
    const overnight = !startOnly && endDate && !sameLocalDay(startDate, endDate);
    if (!startOnly && !overnight && endMin <= startMin) endMin = Math.min(DAY_MIN, startMin + SNAP_MIN);

    // ---- popover chrome -----------------------------------------------------------
    const backdrop = document.createElement('div');
    backdrop.className = 'stp-backdrop';
    const pop = document.createElement('div');
    pop.className = 'stp';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'true');
    pop.setAttribute('aria-label', 'Pick start and stop');

    pop.innerHTML =
      `<div class="stp-head"><h2>Pick start &amp; stop</h2></div>` +
      `<div class="stp-textfields">` +
      `<label class="stp-tf"><span>Start</span><input class="stp-echo-start" type="text" readonly /></label>` +
      (startOnly
        ? ''
        : `<label class="stp-tf"><span>Stop</span><input class="stp-echo-end" type="text" readonly /></label>`) +
      `</div>` +
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
      `<div class="stp-track"></div>` +
      `</div>` +
      `</div>` +
      `<div class="stp-foot">` +
      `<span class="stp-overnight" hidden>Stop is on the next day</span>` +
      `<span class="stp-actions">` +
      `<button type="button" class="stp-cancel">Cancel</button>` +
      `<button type="button" class="primary stp-apply">Apply range</button>` +
      `</span></div>`;
    backdrop.appendChild(pop);
    document.body.appendChild(backdrop);

    const track = pop.querySelector('.stp-track');
    const echoStart = pop.querySelector('.stp-echo-start');
    const echoEnd = pop.querySelector('.stp-echo-end');
    const overnightNote = pop.querySelector('.stp-overnight');

    // ---- month calendar (pick the day) --------------------------------------------
    let calMonth = new Date(columnDay.getFullYear(), columnDay.getMonth(), 1);
    function renderCalendar() {
      const monthLbl = pop.querySelector('.stp-month');
      monthLbl.textContent = calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      const grid = pop.querySelector('.stp-grid');
      grid.innerHTML = '';
      for (const dow of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) {
        const h = document.createElement('span');
        h.className = 'stp-dow';
        h.textContent = dow;
        grid.appendChild(h);
      }
      const first = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
      // Monday-first leading blanks (getDay(): 0=Sun .. 6=Sat → Mon-index 0..6).
      const lead = (first.getDay() + 6) % 7;
      const daysInMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
      for (let i = 0; i < lead; i++) {
        const blank = document.createElement('span');
        blank.className = 'stp-d stp-mut';
        grid.appendChild(blank);
      }
      const today = new Date();
      for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'stp-d';
        const cellDate = new Date(calMonth.getFullYear(), calMonth.getMonth(), day);
        if (sameLocalDay(cellDate, columnDay)) cell.classList.add('stp-sel');
        if (sameLocalDay(cellDate, today)) cell.classList.add('stp-today');
        cell.textContent = String(day);
        cell.addEventListener('click', () => {
          columnDay = startOfLocalDay(cellDate);
          renderCalendar();
          renderTrack();
        });
        grid.appendChild(cell);
      }
    }
    pop.querySelector('.stp-prev').addEventListener('click', () => {
      calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
      renderCalendar();
    });
    pop.querySelector('.stp-next').addEventListener('click', () => {
      calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
      renderCalendar();
    });

    // ---- single-day column --------------------------------------------------------
    // Overlap of the me-span with the other-entry spans, as minute pairs (yellow, warn-only).
    function overlapsOnDay() {
      if (startOnly || endMin == null) return [];
      const out = [];
      for (const o of othersOnDayFor(columnDay, others)) {
        const from = Math.max(startMin, o.from);
        const to = Math.min(endMin, o.to);
        if (to > from) out.push({ from, to });
      }
      return out;
    }

    function syncEchoes() {
      echoStart.value = localInputValue(dateAtMinute(columnDay, startMin));
      if (echoEnd) {
        // When overnight, the stop echo reflects the (later-day) text value, not the column.
        echoEnd.value = overnightActive && endDate ? localInputValue(endDate) : localInputValue(dateAtMinute(columnDay, endMin));
      }
      overnightNote.hidden = !overnightActive;
    }

    function renderTrack() {
      pop.querySelector('.stp-day-lbl').textContent = columnDay.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
      track.innerHTML = '';
      paintHourLabels(track);
      paintOtherBlocks(track, columnDay, others);
      // The "me" rectangle (accent). §05 R06: for start-only (the RUNNING entry) it is the
      // running block — start → "so far", class `open` (the future-fade mask), a start GRIP
      // only: no bottom resize grip, no end label. Its extent is painting only; no end value
      // exists anywhere on this path.
      const me = document.createElement('div');
      me.className = startOnly ? 'stp-block me open' : 'stp-block me';
      const top = minutesToY(startMin);
      const height = startOnly
        ? Math.max(18, minutesToY(runningEdgeMin(columnDay, startMin)) - top)
        : Math.max(6, minutesToY(endMin) - minutesToY(startMin));
      me.style.top = `${top}px`;
      me.style.height = `${height}px`;
      me.innerHTML =
        `<span class="stp-lab-top">${hhmm(startMin)}</span>` +
        (startOnly
          ? ''
          : `<span class="stp-lab-bot">${hhmm(endMin)}</span>` +
            `<span class="stp-resize" aria-label="Resize stop"><i></i></span>`);
      track.appendChild(me);
      // The start-only grip sits at track level (nothing hides it — mockups/timer.html).
      let grip = null;
      if (startOnly) {
        grip = document.createElement('span');
        grip.className = 'stp-grip';
        grip.style.top = `${top - 3}px`;
        grip.setAttribute('aria-label', 'Drag to adjust start');
        track.appendChild(grip);
      }
      // Overlap regions (yellow, warn-only — pointer-events: none, never blocks Apply).
      for (const ov of overlapsOnDay()) {
        const o = document.createElement('div');
        o.className = 'stp-overlap';
        o.style.top = `${minutesToY(ov.from)}px`;
        o.style.height = `${Math.max(2, minutesToY(ov.to) - minutesToY(ov.from))}px`;
        o.innerHTML = `<span class="stp-otag">overlap ${Math.round(ov.to - ov.from)}m</span>`;
        track.appendChild(o);
      }
      // Wire dragging on the freshly-built "me" rectangle (and the start grip, if any).
      wireDrag(me, grip);
      syncEchoes();
    }

    // ---- dragging (5-min snap) ----------------------------------------------------
    // Drag the BODY → move start+stop together (preserves the span). Drag the BOTTOM resize
    // grip → move the stop only. Both snap to the 5-min grid. Overnight spans are never
    // produced by dragging (the column is single-day); the footer steers those to text.
    function pointerMinutes(clientY) {
      const rect = track.getBoundingClientRect();
      return yToMinutes(clientY - rect.top);
    }
    function wireDrag(me, grip) {
      const resize = me.querySelector('.stp-resize');
      // BODY drag = move both; the start-only GRIP moves the start (skip a press that
      // started on the resize grip — that one moves the stop below).
      const startDrag = (ev) => {
        if (resize && (ev.target === resize || resize.contains(ev.target))) return;
        ev.preventDefault();
        const grabMin = pointerMinutes(ev.clientY);
        const span = startOnly ? 0 : endMin - startMin;
        const baseStart = startMin;
        me.setPointerCapture?.(ev.pointerId);
        const onMove = (mv) => {
          const delta = pointerMinutes(mv.clientY) - grabMin;
          let nextStart = snapTo5(baseStart + delta);
          if (!startOnly) {
            // Keep the whole span on the column day.
            nextStart = Math.max(0, Math.min(DAY_MIN - span, nextStart));
            startMin = nextStart;
            endMin = nextStart + span;
          } else {
            // §05 R06: only the START moves — there is no end to drag, compute, or write.
            startMin = Math.max(0, Math.min(runningEdgeMin(columnDay, 0), nextStart));
          }
          // Dragging on the column day resolves any prior overnight state (single-day span).
          overnightActive = false;
          renderTrack();
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      };
      me.addEventListener('pointerdown', startDrag);
      if (grip) grip.addEventListener('pointerdown', startDrag);
      // BOTTOM resize = move the stop only (closed entries only).
      if (resize && !startOnly) {
        resize.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          resize.setPointerCapture?.(ev.pointerId);
          const onMove = (mv) => {
            let nextEnd = snapTo5(pointerMinutes(mv.clientY));
            nextEnd = Math.max(startMin + SNAP_MIN, Math.min(DAY_MIN, nextEnd));
            endMin = nextEnd;
            // Resizing the stop on the column day resolves any prior overnight state.
            overnightActive = false;
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
    }
    // Any drag lands on the column's single day, so an overnight stop (from a seeded text
    // value) is resolved away once the user drags (set in the drag handlers below).
    let overnightActive = overnight;

    // ---- Apply / Cancel -----------------------------------------------------------
    pop.querySelector('.stp-apply').addEventListener('click', () => {
      // Write the picked instants BACK into the authoritative text inputs (text stays the
      // source of truth). When the seeded span was overnight and untouched, keep the
      // original stop (text-only); otherwise the stop comes from the column.
      writeBack(startInput, dateAtMinute(columnDay, startMin));
      if (!startOnly) {
        const endWrite = overnightActive && endDate ? endDate : dateAtMinute(columnDay, endMin);
        writeBack(endInput, endWrite);
      }
      closePicker();
      onApply({ startMin, endMin: startOnly ? null : endMin });
    });
    pop.querySelector('.stp-cancel').addEventListener('click', () => closePicker());
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) closePicker(); // click the dim backdrop to dismiss
    });

    renderCalendar();
    renderTrack();
    return pop;
  }

  /**
   * §05 R06 / §12 R14 (G8) — STP.openStartOnly({ host, startInput, otherEntries, settings })
   * — the Timer view's INLINE start-only disclosure. Renders the single-day track IN FLOW
   * into `host` (no backdrop, no dialog/modal chrome, no Apply): the running entry is the
   * accent block fading into the future (`.stp-block.me.open`), with a START drag grip only
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
    const startDate = parseInput(startInput) || new Date();
    const columnDay = startOfLocalDay(startDate);
    let startMin = snapTo5(localMinuteOfDay(startDate));

    const box = document.createElement('div');
    box.className = 'stp stp-inline stp-start-only';
    box.innerHTML =
      `<div class="stp-dayview" data-timeline-track><div class="stp-track"></div></div>` +
      `<div class="stp-snaphint"><span class="stp-pill">snap · 5 min</span>` +
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
    const win =
      window.SU && typeof window.SU.timelineWindow === 'function'
        ? window.SU.timelineWindow(opts.settings || null, new Date().toISOString(), {
            startUtc: startDate.toISOString(),
            endUtc: null,
          })
        : { startMin: 7 * 60, endMin: 18 * 60 };
    viewport.scrollTop = Math.round(minutesToY(win.startMin));
    return box;
  }

  // Compatibility shim for the existing add-form wiring (app.js openAddRangePicker, the
  // ADD_FORM_PICKER JUDGE scene). Maps the {fromUtc,toUtc,onConfirm} contract onto STP.open
  // by binding to the two add-form inputs and translating Apply into onConfirm. The picker
  // remains the SAME component — this is just the older call shape.
  function openRangePicker(opts = {}) {
    const startInput = document.getElementById('add-from');
    const endInput = document.getElementById('add-to');
    if (opts.fromUtc && startInput) startInput.value = localInputValue(new Date(opts.fromUtc));
    if (opts.toUtc && endInput) endInput.value = localInputValue(new Date(opts.toUtc));
    open({
      startInput,
      endInput,
      otherEntries: Array.isArray(opts.otherEntries) ? opts.otherEntries : [],
      onApply: () => {
        if (typeof opts.onConfirm === 'function') {
          opts.onConfirm({
            fromUtc: new Date(startInput.value).toISOString(),
            toUtc: new Date(endInput.value).toISOString(),
          });
        }
      },
    });
  }

  return { open, openStartOnly, closePicker, openRangePicker, snapTo5, minutesToY, yToMinutes, localInputValue, TRACK_H };
})();
// Expose the compat shim at the top level too (the add-form path calls window.openRangePicker).
window.openRangePicker = window.STP.openRangePicker;
