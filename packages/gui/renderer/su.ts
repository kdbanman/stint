/**
 * The renderer's shared display helpers — `window.SU`, consumed by the classic renderer
 * scripts (app.js, reports.js, settings.js, timepicker.js, popover.js). TypeScript,
 * bundled by esbuild into the classic script `dist/su.js` (IIFE output loads over
 * `file://` under the CSP's `script-src 'self'`; see scripts/build-renderer.mjs and the
 * decision record in context/architecture.html), so it IMPORTS the display rules the old
 * util.js hand-mirrored (issue #83) instead of restating them:
 *
 *   - fmtDur     → core `formatDuration` — SIGNED: a negative duration reads `-HH:MM:SS`,
 *                  parity with `tt` (the old mirror clamped to 0 and masked the state).
 *   - fmtHours   → core `formatHours` + the view's `h` suffix (view chrome, not a rule).
 *   - elapsed    → timerview.ts `countUpSeconds` — the ONE live count-up rule (§12 R2).
 *   - deriveView → src/liveview.ts — the asserted, unit-tested §12 R9 / §17 R11 derivation.
 *   - tagDiff    → src/tags.ts — the asserted, unit-tested §07 tag-edit decision.
 *   - localInputValue / parseLocalInput
 *                → src/localtime.ts — the exact-times FIELD vocabulary (§12 R14/R15/R17).
 *                  The format and its inverse parse live together one level deeper because
 *                  `timerview.ts`'s byte gate and the `add` IPC handler need them too, and a
 *                  renderer-only home would fork the pair the moment they did (issue #159).
 *
 * Everything below those imports is renderer-only display chrome with no other home.
 * Display only: elapsed is always derived (now − start), never stored.
 *
 * It is also the ONE home for a helper more than one renderer script needs. popover.html is
 * a SEPARATE document and can reach nothing app.js defines, so this file is the only route
 * that serves every page — a helper re-typed in a second file is a fork by construction, and
 * the copies diverge silently (issue #168). `renderer-static.test.ts` fails the second copy.
 */
import { DEFAULT_SETTINGS, formatDuration, formatHours, localDay, resolveTimeZone, wallClockOf, wallClockToUtc } from '@stint/core';
import { countUpSeconds } from '../src/timerview.js';
import { deriveView } from '../src/liveview.js';
import { tagDiff } from '../src/tags.js';
import { localInputValue, parseLocalInput } from '../src/localtime.js';

/** Format a duration in seconds as HH:MM:SS — core's rule verbatim (signed negatives). */
const fmtDur = formatDuration;

/** Decimal hours to two places with the view's `h` suffix over core's bare number. */
function fmtHours(seconds: number): string {
  return formatHours(seconds) + 'h';
}

/** The live count-up for an open entry — timerview.ts's rule with `now` taken here. */
function elapsed(startUtc: string, excludedSeconds = 0): number {
  return countUpSeconds(startUtc, new Date(), excludedSeconds);
}

// Electron's `ipcRenderer.invoke` rejection format — the transport's own words wrapped around
// the reason: "Error invoking remote method 'edit': StoreError: start time is in the future".
const IPC_WRAPPER = /^Error invoking remote method '[^']*':\s*/;
// The thrown class name a serialized rejection carries in front of its message: "StoreError: ",
// "TimeParseError: ", "RangeError: ", plain "Error: ". Applied repeatedly because the wrapper
// and the throw each contribute one.
const THROWN_CLASS = /^[A-Za-z]*Error:\s*/;

// §12 R21: a refused core write is surfaced where it was attempted, never silently swallowed.
// `errMessage` normalizes whatever the write path threw — a StoreError forwarded over IPC
// (e.g. "entry end must be after its start") or a locally-thrown parse RangeError — to the
// human string the message region shows. EVERY rejection surface reads through this one
// function (the entry forms, the split confirm, the inline rename, the report builder, the
// exports, the popover's toggle), so "how a refused write reads to the user" has a single
// definition: unwrap `.message`, then strip everything the transport added.
//
// The strip is the point (issue 138). What crossed the IPC boundary is the WHOLE Electron
// string, and the app used to paint it: users met "Error invoking remote method 'edit':
// StoreError: start time is in the future" in the Timer view. The kernel of the message is
// what they can act on; the invoke wrapper and the exception class name a transport and a
// class they cannot. Both come off here, at the one boundary, so no surface can forget.
// The report builder's own version skipped the unwrap and rendered `[object Object]` (#168).
function errMessage(err: unknown): string {
  let message = String((err as { message?: unknown })?.message || err).replace(IPC_WRAPPER, '');
  while (THROWN_CLASS.test(message)) message = message.replace(THROWN_CLASS, '');
  return message;
}

// The ONE HTML escape for renderer text interpolated into innerHTML. FIVE characters,
// including the single quote: the renderers write both `"…"` and `'…'` attribute values, so
// an escape that spares `'` is an injection through user text the moment someone writes
// `title='${escapeHtml(name)}'`. Two dialects existed (a 4-char one in app.js over 20 call
// sites, this 5-char one in reports.js) and the popover escaped nothing at all — issue #168.
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// §04 R06 / §14: the configured time zone every zone-sensitive helper below reads. The raw
// SETTING is held ('system' or an IANA zone) and resolved per call, so the 'system'
// sentinel follows an OS zone change without a reload; settings.js re-applies it from
// fresh state on startup and on every settings change, exactly like applyDateFormat.
let timeZoneSetting: string = 'system';
function applyTimeZone(setting: string): void {
  timeZoneSetting = typeof setting === 'string' && setting !== '' ? setting : 'system';
}
/** The configured zone, resolved now ('system' → the OS zone at this read). */
function zone(): string {
  return resolveTimeZone(timeZoneSetting);
}

// The ONE local minutes-of-day derivation (0–1440) in the CONFIGURED zone — every timeline
// surface positions against it: the picker's seeds and reseeds, the entries calendar's
// event geometry, and this file's own window math. Display only; the stored instant is
// always UTC ISO. Takes a Date or an ISO string because both call shapes exist and neither
// should re-type the arithmetic (issue #168).
function localMinuteOfDay(when: Date | string): number {
  const d = when instanceof Date ? when : new Date(when);
  const w = wallClockOf(d, zone());
  return w.hour * 60 + w.minute;
}

// §12 R15 (issue #49): the EXACT minute-of-day, seconds riding the fraction (09:07:33 →
// 547.55). The picker seeds and reseeds with THIS — never a snapped minute — so the painted
// block and any value written back (dateAtMinute inverts the fraction) preserve the stored
// instant to the second.
function exactMinuteOfDay(when: Date | string): number {
  const d = when instanceof Date ? when : new Date(when);
  const w = wallClockOf(d, zone());
  return w.hour * 60 + w.minute + w.second / 60;
}

// The configured zone's calendar-day token of an instant — core's one localDay vocabulary
// (glossary "Group key"), so the calendar's day columns can never disagree with the day
// buckets core's getState/listEntries grouping keys (§12 R16).
function localDayOf(when: Date | string): string {
  const iso = when instanceof Date ? when.toISOString() : when;
  return localDay(iso, timeZoneSetting);
}

// The configured zone's midnight of the day `when` falls on — the timeline column anchor.
// Calendar arithmetic through core's wallClockToUtc (never `+ 24h`), DST-compatible.
function startOfDay(when: Date | string): Date {
  const d = when instanceof Date ? when : new Date(when);
  const w = wallClockOf(d, zone());
  return wallClockToUtc({ year: w.year, month: w.month, day: w.day }, zone());
}

// The configured-zone midnight of a civil 'YYYY-MM-DD' token — the mini calendar's
// click-to-column mapping (a cell is a civil date, not an instant, so this is the one
// conversion that turns it into the column's anchor instant).
function dayStartOfToken(token: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(token ?? ''));
  if (!m) return new Date(NaN);
  return wallClockToUtc({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }, zone());
}

// The instant at wall-clock `minutes` (fraction = seconds, issue #49) on `day`'s
// configured-zone calendar day — the inverse the picker's write-backs use. Resolved
// through wallClockToUtc so a DST-transition day maps its wall minutes compatibly.
function dateAtMinute(day: Date | string, minutes: number): Date {
  const d = day instanceof Date ? day : new Date(day);
  const w = wallClockOf(d, zone());
  const whole = Math.floor(minutes);
  const seconds = Math.round((minutes - whole) * 60);
  return wallClockToUtc(
    {
      year: w.year,
      month: w.month,
      day: w.day,
      hour: Math.floor(whole / 60),
      minute: whole % 60,
      second: seconds,
    },
    zone(),
  );
}

// §12 R11: the chosen date/number format. 'system' renders the runner's locale; 'iso'
// renders an unambiguous 24h HH:MM off the instant's wall-clock in the CONFIGURED zone
// (§04 R06). Display only — the stored instant is always UTC ISO; these only change how a
// time is shown.
let dateFormat: 'system' | 'iso' = 'system';
function applyDateFormat(mode: string): void {
  dateFormat = mode === 'iso' ? 'iso' : 'system';
}
function localTime(iso: string): string {
  const d = new Date(iso);
  if (dateFormat === 'iso') {
    const w = wallClockOf(d, zone());
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(w.hour)}:${p(w.minute)}`;
  }
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone() });
}

// §09 R1: a short local-date label for a single range endpoint, used by the report
// view's resolved-range header. Display only — the authoritative UTC bounds come from
// core's resolveRange; this never re-derives a range, it only formats one core returned.
function localDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: zone(),
  });
}

// The resolved window as "From → To". The report range is half-open [from, to), so the
// header shows the inclusive last day (to − 1ms) to read naturally (e.g. a Mon–Sun week
// reads "Jun 22 → Jun 28", not "Jun 22 → Jun 29"). Pure formatting of core's bounds.
function rangeLabel(fromUtc: string, toUtc: string): string {
  const lastInclusive = new Date(Date.parse(toUtc) - 1).toISOString();
  return `${localDateLabel(fromUtc)} → ${localDateLabel(lastInclusive)}`;
}

// §09 R6: which report flags a grouped line carries. A line is flagged when any of its
// entries appears in the report's overlapped / unreviewed-sleep id sets — so the flag
// shows IN CONTEXT on the affected summary row (not in a separate list). Pure set
// membership over ids the core Report already computed; the renderer derives no flags.
function lineFlags(
  line: { entryIds?: number[] },
  overlappedIds?: number[],
  unreviewedSleepIds?: number[],
): string[] {
  const ids = line.entryIds || [];
  const over = new Set(overlappedIds || []);
  const slept = new Set(unreviewedSleepIds || []);
  const flags: string[] = [];
  if (ids.some((id) => over.has(id))) flags.push('overlap');
  if (ids.some((id) => slept.has(id))) flags.push('unreviewed sleep');
  return flags;
}

function friendlyHotkey(accel: string): string {
  return accel.replace('CommandOrControl', 'Ctrl').replace('Command', 'Cmd');
}

/** §14's strict zero-padded HH:MM — the shape core validates on write ('07:00', never '7:00'). */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** An HH:MM setting as local minutes-of-day, or null when it is not a readable HH:MM. */
function hhmmToMin(hhmm: string | undefined | null): number | null {
  const s = String(hhmm ?? '');
  return HHMM.test(s) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)) : null;
}

// §14 — the window every timeline fallback lands on. CORE owns the working-hours default
// (settings.ts DEFAULT_SETTINGS), so it is READ from there: a re-typed 7/18 in the renderer
// hands a user who moved their working hours the right window from timelineWindow and the
// wrong one from every fallback path (issue #168). Core's own defaults are validated HH:MM,
// so hhmmToMin never returns null here — the track edges only satisfy the type.
const DEFAULT_WINDOW = {
  startMin: hhmmToMin(DEFAULT_SETTINGS.workingHoursStart) ?? 0,
  endMin: hhmmToMin(DEFAULT_SETTINGS.workingHoursEnd) ?? 1440,
};

/** The settings fields the timeline-viewport derivation reads (a stale/partial snapshot tolerated). */
interface TimelineSettings {
  workingHoursStart?: string;
  workingHoursEnd?: string;
  pickerWindowMode?: string;
  pickerAroundHours?: number;
}

// §14 / G16 — the ONE default-viewport derivation for the timeline surfaces: the inline
// interval picker (§12 R15) and the readonly entries calendar (§12 R16) both consume THIS
// helper and must never re-derive the window math themselves. It returns a scroll window
// { startMin, endMin } in LOCAL minutes-of-day over the full 24h track (0–1440) — a scroll
// default, never a clipped one (the track itself always spans the whole day):
//   • editedInterval present ({ startUtc, endUtc|null }) → the window keeps the mode's
//     span but re-centers on the edited interval (a running entry centers on its start);
//   • else pickerWindowMode 'working_hours' → [workingHoursStart, workingHoursEnd];
//   • else 'around_now' → now ± pickerAroundHours/2, clamped to [0, 1440].
// The entries calendar always defaults to working hours (§12 R16): it passes settings with
// pickerWindowMode forced to 'working_hours'. Display only — core owns and validates the
// stored settings; the fallbacks here only shield against a stale/partial snapshot.
function timelineWindow(
  settings: TimelineSettings | null | undefined,
  nowUtcIso: string,
  editedInterval?: { startUtc?: string; endUtc?: string | null } | null,
): { startMin: number; endMin: number } {
  const s = settings || {};
  let start = hhmmToMin(s.workingHoursStart) ?? DEFAULT_WINDOW.startMin;
  let end = hhmmToMin(s.workingHoursEnd) ?? DEFAULT_WINDOW.endMin;
  if (end <= start) {
    start = DEFAULT_WINDOW.startMin;
    end = DEFAULT_WINDOW.endMin;
  }
  if (s.pickerWindowMode === 'around_now') {
    const hours =
      Number.isInteger(s.pickerAroundHours) && s.pickerAroundHours! >= 1 && s.pickerAroundHours! <= 24
        ? s.pickerAroundHours!
        : 8;
    const nowMin = localMinuteOfDay(nowUtcIso);
    start = nowMin - (hours * 60) / 2;
    end = nowMin + (hours * 60) / 2;
  }
  if (editedInterval && editedInterval.startUtc) {
    const a = localMinuteOfDay(editedInterval.startUtc);
    const b = editedInterval.endUtc ? localMinuteOfDay(editedInterval.endUtc) : a;
    const span = end - start;
    const mid = (a + b) / 2;
    start = mid - span / 2;
    end = mid + span / 2;
  }
  // Clamp into the 24h track: the window is a viewport over the day column, so its edges
  // never leave [0, 1440] (an around-now window near midnight simply meets the day edge).
  const clamp = (m: number) => Math.max(0, Math.min(1440, Math.round(m)));
  let startMin = clamp(start);
  let endMin = clamp(end);
  if (endMin <= startMin) {
    // Degenerate after clamping (should not happen off validated settings) — fall back to
    // core's working-hours default rather than a zero-height viewport.
    startMin = DEFAULT_WINDOW.startMin;
    endMin = DEFAULT_WINDOW.endMin;
  }
  return { startMin, endMin };
}

// The single line-icon family — the SVG <symbol> sprite from the design system,
// the one sanctioned icon source for both the main window and the popover. Drawn
// at 1.6px stroke in currentColor (see the shared `.ic` rule), so an icon inherits
// the colour of its context — never a second hardcoded fill. NEVER emoji/glyphs.
// Lifted verbatim from context/mockups/design-system.html.
const ICON_SPRITE =
  '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
  '<symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></symbol>' +
  '<symbol id="i-list" viewBox="0 0 24 24"><path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01"/></symbol>' +
  '<symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.6 19a5.4 5.4 0 0 1 10.8 0"/><path d="M16 5.6a3.1 3.1 0 0 1 0 5.8"/><path d="M16.6 13.4a5.4 5.4 0 0 1 3.8 5.6"/></symbol>' +
  '<symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 20h16"/><path d="M7.5 20v-6M12 20v-10M16.5 20v-4"/></symbol>' +
  '<symbol id="i-settings" viewBox="0 0 24 24"><path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2.2"/><circle cx="9" cy="16" r="2.2"/></symbol>' +
  '<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.2-4.2"/></symbol>' +
  '<symbol id="i-play" viewBox="0 0 24 24"><path d="M8 6l10 6-10 6z"/></symbol>' +
  '<symbol id="i-stop" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2.2"/></symbol>' +
  '<symbol id="i-swap" viewBox="0 0 24 24"><path d="M7 9h11l-3-3M17 15H6l3 3"/></symbol>' +
  '<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>' +
  '<symbol id="i-star" viewBox="0 0 24 24"><path d="M12 4l2.5 5 5.5.8-4 3.9.95 5.5L12 16.6 6.05 19.2 7 13.7l-4-3.9 5.5-.8z"/></symbol>' +
  '<symbol id="i-cal" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="16" rx="2.2"/><path d="M4 9.5h16M9 3v4M15 3v4"/></symbol>' +
  '<symbol id="i-flag" viewBox="0 0 24 24"><path d="M6 21V4M6 4.5h11l-2.2 3.2L17 11H6"/></symbol>' +
  '<symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.2A8 8 0 1 1 10.8 5a6.4 6.4 0 0 0 9.2 9.2z"/></symbol>' +
  '<symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></symbol>' +
  '<symbol id="i-download" viewBox="0 0 24 24"><path d="M12 4v11M7.5 11L12 15.5 16.5 11M5 20h14"/></symbol>' +
  '<symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>' +
  '<symbol id="i-down" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></symbol>' +
  '<symbol id="i-right" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></symbol>' +
  '<symbol id="i-left" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></symbol>' +
  '<symbol id="i-dots" viewBox="0 0 24 24"><path d="M6 12h.01M12 12h.01M18 12h.01"/></symbol>' +
  '<symbol id="i-edit" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></symbol>' +
  '<symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></symbol>' +
  '<symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></symbol>' +
  '<symbol id="i-grip" viewBox="0 0 24 24"><path d="M9 7h.01M15 7h.01M9 12h.01M15 12h.01M9 17h.01M15 17h.01"/></symbol>' +
  '<symbol id="i-restore" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 1 2.3 5.6M4 12V7M4 12h5"/></symbol>' +
  '<symbol id="i-archive" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/></symbol>' +
  '<symbol id="i-split" viewBox="0 0 24 24"><path d="M4 12h16"/><path d="M12 4v5M12 15v5"/></symbol>' +
  '</defs></svg>';

// The set of ids the sprite defines — the canonical icon vocabulary. Renderers
// pass one of these to icon(); an unknown id is a programming error, not a glyph.
const ICON_IDS = [
  'clock', 'list', 'users', 'chart', 'settings', 'search', 'play', 'stop', 'swap',
  'plus', 'star', 'cal', 'flag', 'moon', 'check', 'download', 'x', 'down', 'right',
  'left', 'dots', 'edit', 'info', 'arrow', 'grip', 'restore', 'archive', 'split',
];

// Render one line icon by id as an <svg class="ic"><use href="#i-<id>"/></svg>
// string the renderers can drop into innerHTML. Always class="ic" so it picks up
// the shared stroke/size rule; pass `cls` for extra classes (e.g. a size modifier)
// and `title` for an accessible label (decorative icons stay aria-hidden).
function icon(id: string, opts?: { cls?: string; title?: string }): string {
  opts = opts || {};
  const cls = opts.cls ? 'ic ' + opts.cls : 'ic';
  const a11y = opts.title
    ? ' role="img" aria-label="' + String(opts.title).replace(/"/g, '&quot;') + '"'
    : ' aria-hidden="true"';
  return '<svg class="' + cls + '"' + a11y + '><use href="#i-' + id + '"/></svg>';
}

// Inject the icon sprite into the document once (idempotent), so every <use href>
// in the renderer resolves. Call this on load before painting any icons.
function injectSprite(doc?: Document): void {
  doc = doc || document;
  if (doc.getElementById('stint-icon-sprite')) return;
  const host = doc.createElement('div');
  host.id = 'stint-icon-sprite';
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  host.innerHTML = ICON_SPRITE;
  (doc.body || doc.documentElement).appendChild(host);
}

const SU = {
  fmtDur,
  fmtHours,
  elapsed,
  localTime,
  localDateLabel,
  rangeLabel,
  lineFlags,
  friendlyHotkey,
  // The field vocabulary, bound to the configured zone (§04 R06): the renderer scripts render
  // and parse the raw Start/Stop fields through these, so seed and reparse share one zone.
  localInputValue: (date: Date) => localInputValue(date, timeZoneSetting),
  parseLocalInput: (value: string) => parseLocalInput(value, timeZoneSetting),
  localMinuteOfDay,
  exactMinuteOfDay,
  localDayOf,
  startOfDay,
  dayStartOfToken,
  dateAtMinute,
  /** The configured zone, resolved now — for Intl formatting options in renderer scripts. */
  currentZone: () => zone(),
  timelineWindow,
  applyDateFormat,
  applyTimeZone,
  errMessage,
  escapeHtml,
  tagDiff,
  deriveView,
  ICON_SPRITE,
  ICON_IDS,
  icon,
  injectSprite,
};

declare global {
  interface Window {
    SU: typeof SU;
  }
}

window.SU = SU;
