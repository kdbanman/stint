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
  // Apply the system accent ONLY to the --accent variable (PRD §15).
  function applyAccent(accent) {
    if (accent) document.documentElement.style.setProperty('--accent', accent);
  }
  // §12 R11: honour the accent-usage setting. 'system' paints the system accent on the
  // primary action / running state (the §15 default); 'monochrome' suppresses it by mapping
  // --accent onto the ink colour, so the primary action and running indicator stop standing
  // out — the whole chrome reads monochrome — without scattering a second hardcoded colour.
  // Always drives the single --accent variable, so the §15 accent-discipline scan still sees
  // exactly one sanctioned fill (the primary action), now inked rather than coloured.
  function applyAccentMode(mode, accent) {
    if (mode === 'monochrome') {
      const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#15151a';
      document.documentElement.style.setProperty('--accent', ink);
    } else {
      applyAccent(accent);
    }
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

  return { fmtDur, fmtHours, elapsed, localTime, localDateLabel, rangeLabel, lineFlags, friendlyHotkey, applyAccent, applyAccentMode, applyDateFormat, tagDiff, deriveView };
})();
