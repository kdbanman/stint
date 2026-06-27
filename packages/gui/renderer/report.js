// Report-builder renderer (PRD §08 R3, §09, §12 R8). A thin shell over core: every
// control change re-runs window.stint.report (the same capability `tt report` is, and
// the same `report` IPC channel the parity matrix already covers) and repaints the
// returned Report. No arithmetic here — totals, grouping, rounding, and the billable
// filter are all core's; this view only chooses the options and paints the result.
// Classic script: display helpers come from window.SU (util.js, loaded first).
const { applyAccent, rangeLabel, lineFlags } = window.SU;

const $ = (id) => document.getElementById(id);

// The report builder's own view state. The Billable control is the §08 R3 three-way
// toggle: reports DEFAULT to billable-only, with a switch to all or non-billable.
const opts = {
  by: 'client',
  billableFilter: 'billable',
  rounding: false,
  roundingIncrementMin: 15,
};

// §09 R1: the date-range picker's own state. `preset` selects one of core's five named
// ranges (resolved by core's resolveRange via the report IPC channel — NEVER re-derived
// here); 'custom' switches to explicit from/to inputs passed straight through. The
// default is 'week' (This week — the at-a-glance figure index.html shows).
const range = {
  preset: 'week', // one of the PRESETS keys, or 'custom'
  fromUtc: null, // set only in custom mode, from #range-from
  toUtc: null, // set only in custom mode, from #range-to
};

// §09 R3: the client / project / tag filters. Like `tt report --client/--project/--tag`,
// each narrows the report to a single entity; an unset client/project means "no filter"
// (the key is omitted from the request). The renderer resolves no names — it carries the
// chosen client/project IDS straight from listClients/listProjects — and an empty tag is
// omitted. `clientId`/`projectId` are null when "All …" is selected; `tag` is '' when blank.
const filter = {
  clientId: null,
  projectId: null,
  tag: '',
};

// The five core presets the chips drive, plus their display label. 'custom' is the
// escape hatch to explicit from/to and carries no resolveRange preset.
const PRESETS = {
  today: 'Today',
  week: 'This week',
  'last-week': 'Last week',
  month: 'This month',
  'last-month': 'Last month',
};

const BILLABLE_LABEL = {
  billable: 'billable only',
  all: 'all',
  'non-billable': 'non-billable',
};

// Hours + minutes, matching the on-screen summary in the mockup ("21h 35m"). The exact
// seconds come from core; this is display-only formatting (never stored, never billed).
function fmtHM(seconds) {
  const s = Math.max(0, Math.trunc(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The displayed seconds for a line: the rounded total when rounding is on (rounding
// applies to the grouped line, never to each entry — PRD §09), the exact total otherwise.
function lineSeconds(line) {
  return opts.rounding ? line.roundedSeconds : line.totalSeconds;
}

// §09 R6: the flags a grouped line carries, shown IN CONTEXT on the affected row (not in a
// separate list). lineFlags is the pure set-membership over the core Report's overlapped /
// unreviewed-sleep id sets — the renderer derives nothing. Flags use the --flag tokens
// (the same the per-entry overlap/slept flags use), never the accent (§15 discipline).
function flagsHtml(line, report) {
  const flags = lineFlags(line, report.overlappedEntryIds, report.unreviewedSleepEntryIds);
  if (!flags.length) return '';
  return flags
    .map((f) => ` <span class="report-flag" title="${escapeHtml(f)}">${escapeHtml(f)}</span>`)
    .join('');
}

function rowHtml(line, depth, report) {
  const cls = depth === 0 ? 'report-grp' : 'report-sub';
  const indent = depth > 0 ? ' style="padding-left:30px"' : '';
  return (
    `<tr class="${cls}"><td${indent}>${escapeHtml(line.key)}${flagsHtml(line, report)}</td>` +
    `<td class="num">${fmtHM(lineSeconds(line))}</td></tr>` +
    (line.children || []).map((c) => rowHtml(c, depth + 1, report)).join('')
  );
}

// The caption for the chosen range: the preset's label, or "Custom range" when the
// explicit from/to inputs drive it.
function rangeCaption() {
  return range.preset === 'custom' ? 'Custom range' : PRESETS[range.preset];
}

function paint(report) {
  const grand = opts.rounding ? report.grandRoundedSeconds : report.grandTotalSeconds;
  $('report-rows').innerHTML = report.lines.map((l) => rowHtml(l, 0, report)).join('') || '<tr><td colspan="2" class="report-empty">No time in this range.</td></tr>';
  $('report-total').textContent = fmtHM(grand);
  $('report-grand').textContent = fmtHM(grand);
  $('report-caption').textContent = `${rangeCaption()} · ${BILLABLE_LABEL[opts.billableFilter]}`;
  // §09 R1: paint the resolved window straight off the Report core returned, so the
  // chosen range is always visible (and never re-derived in the renderer).
  $('report-range').textContent = rangeLabel(report.rangeFromUtc, report.rangeToUtc);
}

// Build the date-range half of the report request. For a preset, send the preset NAME and
// let core's resolveRange turn it into bounds (no date math here); for custom, send the
// user's explicit from/to straight through.
function rangeReq() {
  if (range.preset === 'custom') {
    return { fromUtc: range.fromUtc, toUtc: range.toUtc };
  }
  return { preset: range.preset };
}

// §09 R3: the client/project/tag half of the report request. An unset client/project is
// "no filter", so the key is omitted (mirroring `tt report` with no --client/--project);
// a blank tag is likewise omitted. The renderer sends the entity ids it already holds —
// it never resolves names — so core does the filtering exactly as it does for the CLI.
function filterReq() {
  const req = {};
  if (filter.clientId !== null) req.clientId = filter.clientId;
  if (filter.projectId !== null) req.projectId = filter.projectId;
  if (filter.tag) req.tag = filter.tag;
  return req;
}

// §09 R6: export the raw entries for the CURRENTLY shown range. The export mirrors
// `tt export` — raw entries for a range, no client/project/tag narrowing — so only the
// range half of the request travels (the same preset/custom the summary is showing). The
// renderer never touches fs: window.stint.exportEntries round-trips through the main
// process, which resolves the range, renders the bytes via core, and writes via the OS
// save dialog. A small status line confirms the write (or a cancel).
async function exportEntries(format) {
  const status = $('export-status');
  status.textContent = '';
  try {
    const res = await window.stint.exportEntries({ format, ...rangeReq() });
    if (!res || res.canceled) {
      status.textContent = 'Export canceled.';
      return;
    }
    status.textContent = `Exported ${res.written} entr${res.written === 1 ? 'y' : 'ies'} to ${res.path}.`;
  } catch (err) {
    status.textContent = `Export failed: ${String((err && err.message) || err).replace(/^Error:\s*/, '')}`;
  }
}

async function run() {
  // Custom mode needs both bounds before it can run; until then leave the last result.
  if (range.preset === 'custom' && (!range.fromUtc || !range.toUtc)) return;
  const report = await window.stint.report({
    ...rangeReq(),
    ...filterReq(),
    by: opts.by,
    billableFilter: opts.billableFilter,
    rounding: opts.rounding,
    roundingIncrementMin: opts.roundingIncrementMin,
  });
  paint(report);
}

// §09 R09: the saved reports rail. R08 persists the named definitions; this view lists
// them (window.stint.listReports) with a Run action, and Run resolves the definition
// against current data through core (window.stint.runReport) — the renderer re-derives no
// range/grouping/rounding/totals. The currently-run saved report's name is held so the
// run-output Export buttons can carry its ref (so main exports the definition's range,
// byte-identical to `tt report run <name> --csv|--json`).
let runningSavedRef = null;

// Paint the saved-report run-output panel from the core Report runReport returned. Mirrors
// paint() above (per-line + grand totals, with flags shown in context off window.SU.line
// Flags) — the saved report's own rounding is honoured via report.options.rounding.
function paintSavedRun(name, report) {
  runningSavedRef = name;
  const rounding = report.options.rounding;
  const lineSec = (l) => (rounding ? l.roundedSeconds : l.totalSeconds);
  const rowHtmlSaved = (line, depth) => {
    const cls = depth === 0 ? 'report-grp' : 'report-sub';
    const indent = depth > 0 ? ' style="padding-left:30px"' : '';
    const flags = lineFlags(line, report.overlappedEntryIds, report.unreviewedSleepEntryIds)
      .map((f) => ` <span class="report-flag" title="${escapeHtml(f)}">${escapeHtml(f)}</span>`)
      .join('');
    return (
      `<tr class="${cls}"><td${indent}>${escapeHtml(line.key)}${flags}</td>` +
      `<td class="num">${fmtHM(lineSec(line))}</td></tr>` +
      (line.children || []).map((c) => rowHtmlSaved(c, depth + 1)).join('')
    );
  };
  const grand = rounding ? report.grandRoundedSeconds : report.grandTotalSeconds;
  $('saved-run-caption').textContent = `Run · ${name}`;
  $('saved-run-rows').innerHTML =
    report.lines.map((l) => rowHtmlSaved(l, 0)).join('') ||
    '<tr><td colspan="2" class="report-empty">No time in this range.</td></tr>';
  $('saved-run-total').textContent = fmtHM(grand);
  $('saved-run-grand').textContent = fmtHM(grand);
  $('saved-run-range').textContent = rangeLabel(report.rangeFromUtc, report.rangeToUtc);
  $('saved-run').hidden = false;
}

// Run a saved definition by name. core resolves its stored range-spec and totals it
// (window.stint.runReport) — no renderer-side math — and the returned core Report is painted.
async function runSaved(name) {
  const report = await window.stint.runReport({ ref: name });
  paintSavedRun(name, report);
}

// §09 R09: export CSV / JSON FROM the currently-run saved report. The request carries the
// saved-report ref, so main resolves the definition's range and exports its raw entries
// (byte-identical to `tt report run <name> --csv|--json`); the renderer holds no export math.
async function exportSaved(format) {
  if (runningSavedRef === null) return;
  const status = $('saved-export-status');
  status.textContent = '';
  try {
    const res = await window.stint.exportEntries({ format, savedReportRef: runningSavedRef });
    if (!res || res.canceled) {
      status.textContent = 'Export canceled.';
      return;
    }
    status.textContent = `Exported ${res.written} entr${res.written === 1 ? 'y' : 'ies'} to ${res.path}.`;
  } catch (err) {
    status.textContent = `Export failed: ${String((err && err.message) || err).replace(/^Error:\s*/, '')}`;
  }
}

// List the saved definitions with a Run button each (the Run wires to runSaved). Best-effort:
// a read failure leaves the rail empty and never blocks the ad-hoc builder above.
async function renderSavedList() {
  const list = $('saved-list');
  if (!list) return;
  let defs = [];
  try {
    defs = await window.stint.listReports();
  } catch {
    /* the saved rail is best-effort; the ad-hoc builder above still runs */
  }
  if (!defs.length) {
    list.innerHTML = '<li class="report-empty">No saved reports yet.</li>';
    return;
  }
  list.innerHTML = defs
    .map(
      (d) =>
        `<li class="saved-item"><span class="saved-name">${escapeHtml(d.name)}</span>` +
        `<button type="button" class="saved-run-btn" data-run="${escapeHtml(d.name)}">Run</button></li>`,
    )
    .join('');
}

// §09 R4: the increment picker only matters when rounding is ON. When rounding is off
// the picker is disabled and de-emphasized (the .off class) so the control group reads as
// a single Off/On decision with its increment a secondary choice — exact time is shown.
function reflectRounding() {
  const inc = $('rounding-increment');
  if (!inc) return;
  inc.disabled = !opts.rounding;
  inc.classList.toggle('off', !opts.rounding);
}

// Mark exactly one segment active in a segmented control and reflect it for a11y.
function selectSegment(container, btn) {
  for (const b of container.querySelectorAll('.seg-btn')) {
    const on = b === btn;
    b.classList.toggle('on', on);
    if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(on));
  }
}

// §09 R1: mark exactly one preset chip active and toggle the custom-range inputs into
// view only for the Custom chip. Pure presentation; the run() decides what to send.
function selectPreset(chosen) {
  for (const b of $('preset-seg').querySelectorAll('.preset')) {
    const on = b.dataset.preset === chosen;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  $('custom-range').hidden = chosen !== 'custom';
}

// §09 R3: populate the project filter for the chosen client. With no client selected the
// project filter is disabled and reads "All projects" (a project filter only makes sense
// within a client, mirroring `tt report --project` resolving against --client). When a
// client is chosen, list its active projects from the same source tt uses and offer them
// by id. Re-populating clears any stale project selection (filter.projectId is reset).
async function populateProjects() {
  const sel = $('f-project');
  // Rebuild from scratch: the leading "All projects" option, then the client's projects.
  sel.innerHTML = '<option value="">All projects</option>';
  filter.projectId = null;
  if (filter.clientId === null) {
    sel.disabled = true;
    sel.value = '';
    return;
  }
  const projects = await window.stint.listProjects({ clientId: filter.clientId });
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = String(p.id);
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.disabled = false;
  sel.value = '';
}

// §09 R3: fill the client filter from the same reference data tt uses (active clients
// only; archived excluded by listClients' default). The leading "All clients" option is
// the no-filter default. The project filter starts disabled until a client is chosen.
async function populateFilters() {
  const sel = $('f-client');
  const clients = await window.stint.listClients();
  for (const c of clients) {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
  await populateProjects();
}

function wire() {
  // §09 R1: the date-range preset chips. Clicking a named preset sets range.preset and
  // re-runs immediately (core resolves the bounds); clicking Custom just reveals the
  // explicit from/to inputs — the report runs once the user Applies a complete range.
  $('preset-seg').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.preset');
    if (!btn) return;
    range.preset = btn.dataset.preset;
    selectPreset(range.preset);
    if (range.preset !== 'custom') void run();
  });

  // The custom range applies on demand: read the two local datetime inputs, convert to
  // UTC ISO, and pass them straight through (no preset). Core still owns every total.
  $('range-apply').addEventListener('click', () => {
    const from = $('range-from').value;
    const to = $('range-to').value;
    if (!from || !to) return;
    range.fromUtc = new Date(from).toISOString();
    range.toUtc = new Date(to).toISOString();
    void run();
  });

  // §08 R3: the three-way Billable toggle — clicking a segment sets billableFilter,
  // visually marks the active segment, and re-runs the report so the total changes.
  $('billable-seg').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.seg-btn');
    if (!btn) return;
    opts.billableFilter = btn.dataset.billable;
    selectSegment($('billable-seg'), btn);
    void run();
  });

  $('by-seg').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.seg-btn');
    if (!btn) return;
    opts.by = btn.dataset.by;
    selectSegment($('by-seg'), btn);
    void run();
  });

  // §09 R4: the rounding controls. The Off/On toggle and the 6/10/15/30 increment
  // picker BOTH persist the choice through the same `setSetting` channel `tt config set`
  // uses (the parity matrix already covers it — no new channel) so the rounding preference
  // is the one setting both surfaces read; each then re-runs the report so the displayed
  // billable line updates to the rounded total (rounding on) or the exact total (off).
  // Rounding never touches stored time — only the DISPLAYED line — and core rounds the
  // grouped line nearest the chosen increment (not always up, PRD §09).
  $('rounding').addEventListener('change', async () => {
    opts.rounding = $('rounding').checked;
    reflectRounding();
    await window.stint.setSetting({ key: 'rounding', value: opts.rounding });
    void run();
  });
  $('rounding-increment').addEventListener('change', async () => {
    opts.roundingIncrementMin = Number($('rounding-increment').value);
    await window.stint.setSetting({ key: 'roundingIncrementMin', value: opts.roundingIncrementMin });
    if (opts.rounding) void run();
  });

  // §09 R3: the client filter. Choosing a client sets filter.clientId (null for "All
  // clients"), repopulates the project options for that client (clearing any prior
  // project selection), and re-runs the report so the totals narrow to the client.
  $('f-client').addEventListener('change', async () => {
    const v = $('f-client').value;
    filter.clientId = v === '' ? null : Number(v);
    await populateProjects();
    void run();
  });

  // §09 R3: the project filter. Choosing a project sets filter.projectId (null for "All
  // projects") and re-runs the report so it narrows to that project's entries.
  $('f-project').addEventListener('change', () => {
    const v = $('f-project').value;
    filter.projectId = v === '' ? null : Number(v);
    void run();
  });

  // §09 R3: the tag filter. A free-text tag (a flat label, per §07) narrows the report to
  // entries carrying it; blank means "no filter". Re-runs on input so the list tracks the
  // typed tag live, mirroring `tt report --tag`.
  $('f-tag').addEventListener('input', () => {
    filter.tag = $('f-tag').value.trim();
    void run();
  });

  // §09 R6: the Export CSV / Export JSON buttons. Each writes the raw entries for the
  // currently shown range to a file (round-tripped through main → core → the OS save
  // dialog); the renderer holds no export logic beyond choosing the format and the range.
  $('export-csv').addEventListener('click', () => void exportEntries('csv'));
  $('export-json').addEventListener('click', () => void exportEntries('json'));

  // §09 R09: the saved-reports rail. Clicking a definition's Run button resolves+runs it
  // through core (runSaved → window.stint.runReport) and paints the run-output panel; the
  // run-output Export buttons export FROM the saved report (carrying its ref).
  $('saved-list').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.saved-run-btn');
    if (!btn) return;
    void runSaved(btn.dataset.run);
  });
  $('saved-export-csv').addEventListener('click', () => void exportSaved('csv'));
  $('saved-export-json').addEventListener('click', () => void exportSaved('json'));

  const back = document.querySelector('.nav-link[data-nav="index"]');
  if (back) back.addEventListener('click', () => (window.location.href = 'index.html'));

  // Reflect the initial rounding state on the increment picker (disabled/de-emphasized
  // when rounding is off) regardless of whether getState resolved the persisted setting.
  reflectRounding();
}

async function init() {
  // Parity with app.js: pull the accent from core's UiState so the report view paints
  // the same restrained system accent on its one active affordance.
  try {
    const ui = await window.stint.getState();
    applyAccent(ui.accent);
    if (ui.settings) {
      opts.rounding = !!ui.settings.rounding;
      opts.roundingIncrementMin = ui.settings.roundingIncrementMin ?? 15;
      $('rounding').checked = opts.rounding;
      $('rounding-increment').value = String(opts.roundingIncrementMin);
    }
    reflectRounding();
  } catch {
    /* getState is best-effort for accent/defaults; the report itself drives the view */
  }
  // §09 R3: fill the client/project filter selects from the same reference data tt uses
  // before the first run, so the filters are usable immediately. Best-effort — a failure
  // here leaves the "All …" defaults (no filter), and the report itself still runs.
  try {
    await populateFilters();
  } catch {
    /* reference-data read is best-effort for the filter selects; the report still runs */
  }
  // §09 R09: populate the saved-reports rail (best-effort) so saved definitions are runnable
  // and exportable from the view; a failure here leaves the ad-hoc builder fully usable.
  try {
    await renderSavedList();
  } catch {
    /* the saved rail is best-effort; the ad-hoc builder above still runs */
  }
  wire();
  await run();
}

void init();
