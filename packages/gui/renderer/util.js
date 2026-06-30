// Small display helpers shared by the main window and popover renderers.
// Classic script (no ES modules) so it loads over file:// in the packaged app.
// Display only: elapsed is always derived (now − start), never stored.
window.SU = (function () {
  function fmtDur(seconds) {
    const s = Math.max(0, Math.trunc(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(sec)}`;
  }
  function fmtHours(seconds) {
    return (seconds / 3600).toFixed(2) + 'h';
  }
  function elapsed(startUtc, excludedSeconds = 0) {
    return Math.max(0, Math.floor((Date.now() - Date.parse(startUtc)) / 1000) - excludedSeconds);
  }
  // §12 R11: the chosen date/number format. 'system' renders the runner's locale; 'iso'
  // renders an unambiguous 24h HH:MM off the instant's local wall-clock. Display only — the
  // stored instant is always UTC ISO; this only changes how a time is shown.
  let dateFormat = 'system';
  function applyDateFormat(mode) {
    dateFormat = mode === 'iso' ? 'iso' : 'system';
  }
  function localTime(iso) {
    const d = new Date(iso);
    if (dateFormat === 'iso') {
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  // §09 R1: a short local-date label for a single range endpoint, used by the report
  // view's resolved-range header. Display only — the authoritative UTC bounds come from
  // core's resolveRange; this never re-derives a range, it only formats one core returned.
  function localDateLabel(iso) {
    return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }
  // The resolved window as "From → To". The report range is half-open [from, to), so the
  // header shows the inclusive last day (to − 1ms) to read naturally (e.g. a Mon–Sun week
  // reads "Jun 22 → Jun 28", not "Jun 22 → Jun 29"). Pure formatting of core's bounds.
  function rangeLabel(fromUtc, toUtc) {
    const lastInclusive = new Date(Date.parse(toUtc) - 1).toISOString();
    return `${localDateLabel(fromUtc)} → ${localDateLabel(lastInclusive)}`;
  }
  // §09 R6: which report flags a grouped line carries. A line is flagged when any of its
  // entries appears in the report's overlapped / unreviewed-sleep id sets — so the flag
  // shows IN CONTEXT on the affected summary row (not in a separate list). Pure set
  // membership over ids the core Report already computed; the renderer derives no flags.
  function lineFlags(line, overlappedIds, unreviewedSleepIds) {
    const ids = line.entryIds || [];
    const over = new Set(overlappedIds || []);
    const slept = new Set(unreviewedSleepIds || []);
    const flags = [];
    if (ids.some((id) => over.has(id))) flags.push('overlap');
    if (ids.some((id) => slept.has(id))) flags.push('unreviewed sleep');
    return flags;
  }
  function friendlyHotkey(accel) {
    return accel.replace('CommandOrControl', 'Ctrl').replace('Command', 'Cmd');
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
    '</defs></svg>';
  // The set of ids the sprite defines — the canonical icon vocabulary. Renderers
  // pass one of these to icon(); an unknown id is a programming error, not a glyph.
  const ICON_IDS = [
    'clock', 'list', 'users', 'chart', 'settings', 'search', 'play', 'stop', 'swap',
    'plus', 'star', 'cal', 'flag', 'moon', 'check', 'download', 'x', 'down', 'right',
    'left', 'dots', 'edit', 'info', 'arrow', 'grip', 'restore', 'archive',
  ];
  // Render one line icon by id as an <svg class="ic"><use href="#i-<id>"/></svg>
  // string the renderers can drop into innerHTML. Always class="ic" so it picks up
  // the shared stroke/size rule; pass `cls` for extra classes (e.g. a size modifier)
  // and `title` for an accessible label (decorative icons stay aria-hidden).
  function icon(id, opts) {
    opts = opts || {};
    const cls = opts.cls ? 'ic ' + opts.cls : 'ic';
    const a11y = opts.title
      ? ' role="img" aria-label="' + String(opts.title).replace(/"/g, '&quot;') + '"'
      : ' aria-hidden="true"';
    return '<svg class="' + cls + '"' + a11y + '><use href="#i-' + id + '"/></svg>';
  }
  // Inject the icon sprite into the document once (idempotent), so every <use href>
  // in the renderer resolves. Call this on load before painting any icons.
  function injectSprite(doc) {
    doc = doc || document;
    if (doc.getElementById('stint-icon-sprite')) return;
    const host = doc.createElement('div');
    host.id = 'stint-icon-sprite';
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    host.innerHTML = ICON_SPRITE;
    (doc.body || doc.documentElement).appendChild(host);
  }
  // §07: the pure tag-edit decision — diff the entry's current tags against the user's
  // edited chip set into the minimal addTags/removeTags the `edit` patch carries. A thin
  // mirror of src/tags.ts (the asserted, unit-tested contract) so app.js — a classic
  // script with no module imports — can drive the same decision. Case-insensitive,
  // trimmed, empties dropped, de-duplicated keeping first-seen spelling; a tag present on
  // both sides (any case) is untouched.
  function tagDiff(original, next) {
    const normalize = (tags) => {
      const out = [];
      const seen = new Set();
      for (const raw of tags || []) {
        const name = String(raw).trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(name);
      }
      return out;
    };
    const before = normalize(original);
    const after = normalize(next);
    const beforeKeys = new Set(before.map((t) => t.toLowerCase()));
    const afterKeys = new Set(after.map((t) => t.toLowerCase()));
    return {
      addTags: after.filter((t) => !beforeKeys.has(t.toLowerCase())),
      removeTags: before.filter((t) => !afterKeys.has(t.toLowerCase())),
    };
  }
  // §12 R9 / §17 R11: the pure live-view derivation — recompute the Entries view's visible
  // list AND its report totals from the in-memory UiState snapshot alone, so a search /
  // filter / group selection reflects LIVE in both the list and the totals without an IPC
  // round-trip. A thin mirror of src/liveview.ts (the asserted, unit-tested contract) so
  // app.js — a classic script with no module imports — drives the same decision. Sums the
  // snapshot's core-owned billableSeconds, so the live totals equal what `tt report` shows:
  // listTotalSeconds is every visible row's billable seconds, reportTotalSeconds is the
  // billable-only sum. No selection → both equal the full snapshot totals.
  function deriveView(state, sel) {
    sel = sel || {};
    const needle = (sel.search || '').trim().toLowerCase();
    const matchesSearch = (e) =>
      [e.description, e.clientLabel, ...(e.tags || [])].some(
        (h) => h != null && String(h).toLowerCase().includes(needle),
      );
    const matchesBillable = (e) =>
      sel.billable === 'billable' ? e.billable : sel.billable === 'non-billable' ? !e.billable : true;
    const matchesClient = (e) =>
      sel.clientLabel === undefined
        ? true
        : sel.clientLabel === null
          ? e.clientLabel == null
          : e.clientLabel === sel.clientLabel;
    const rows = state.days
      .flatMap((d) => d.entries)
      .filter((e) => (needle === '' || matchesSearch(e)) && matchesClient(e) && matchesBillable(e));

    const by = sel.group === 'client' ? 'client' : 'day';
    const keyOf = (e) => (by === 'client' ? e.clientLabel || '(no client)' : e.startUtc.slice(0, 10));
    const order = [];
    const buckets = new Map();
    for (const e of rows) {
      const k = keyOf(e);
      if (!buckets.has(k)) {
        buckets.set(k, []);
        order.push(k);
      }
      buckets.get(k).push(e);
    }
    if (by === 'day') order.sort((a, b) => b.localeCompare(a));
    const groups = order.map((key) => {
      const entries = buckets.get(key);
      return {
        key,
        entries,
        billableSeconds: entries.reduce((s, e) => s + (e.billable ? e.billableSeconds : 0), 0),
      };
    });
    return {
      groups,
      listTotalSeconds: rows.reduce((s, e) => s + e.billableSeconds, 0),
      reportTotalSeconds: rows.filter((e) => e.billable).reduce((s, e) => s + e.billableSeconds, 0),
    };
  }

  return { fmtDur, fmtHours, elapsed, localTime, localDateLabel, rangeLabel, lineFlags, friendlyHotkey, applyDateFormat, tagDiff, deriveView, ICON_SPRITE, ICON_IDS, icon, injectSprite };
})();
