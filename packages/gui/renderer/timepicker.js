// §12 R15 (G8) — the START-ONLY interval picker (window.STP): the running entry's
// start-adjustment surface where no week grid exists — the Timer view's inline start-only
// disclosure below the Start field (#le-start, §05 R06). It renders IN FLOW (there is NO
// modal, no backdrop, no Apply) and binds ONE authoritative local-time text input
// (`YYYY-MM-DD HH:mm:ss`), letting the user DRAG the running block's start grip on a
// single-day hour column instead of typing. The Entries view mounts NO picker (§12 R15):
// closed entries' spans are adjusted on the week grid itself (R06/R16) or typed in the
// unified form's Start/Stop fields (R17) — the two-ended STP.openInline variant left with
// that redesign (issue #266).
//
// It adds ZERO capabilities: it only ever writes localInputValue-formatted strings BACK into
// the existing text input (and dispatches `input`/`change`), so the unchanged edit IPC path
// stays the single source of truth and the text field stays authoritative. No new IPC
// channel, no parity row — the picker never talks to core, the DB, or the network.
//
// Classic script (window.STP) loaded alongside the bundled SU entry (dist/su.js) and
// app.js. Pure DOM: no Node imports, no core-package import, no network (the renderer-static
// guard asserts this). Accent discipline (design.html D11 / V3): the running "me" block is
// accent-OUTLINED over the weak accent fill (solid accent is reserved for primary actions);
// every other control is monochrome.
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

  // Write a Date back into a bound text input as a local YYYY-MM-DD HH:mm:ss string, and fire an
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


  return { openStartOnly, snapTo5, minutesToY, yToMinutes, TRACK_H };
})();
