// Reports view renderer (PRD §12 R08, §09 R08–R09 — saved reports / G11). The in-shell
// Reports view is the PRIMARY surface for SAVED, named report definitions (it replaces the
// retired standalone report.html, so no view escapes the sidebar). A thin shell over core:
// every saved-report capability is the parity twin of `tt report save|ls|show|rename|edit|
// rm|run` — the renderer resolves no names (it sends client/project IDS) and re-derives no
// range / grouping / rounding / total. CRUD goes over window.stint.{saveReport,listReports,
// renameReport,editReport,removeReport}; Run resolves a definition against current data
// through core (window.stint.runReport), which re-resolves the stored relative range-spec
// on every run (the SAME core resolveRange the ad-hoc report uses), so a saved report and
// an ad-hoc report over the same window can never diverge.
//
// Classic script (no ES modules) so it loads over file:// in the packaged app; display
// helpers come from window.SU (util.js, loaded first). Loaded AFTER app.js so it can rely
// on the shell + the global router, but it owns the Reports section entirely (app.js never
// renders it).
(function () {
  const { rangeLabel, lineFlags, icon } = window.SU;
  const $ = (id) => document.getElementById(id);

  // The five core presets the range chips drive, plus their display label. 'custom' is the
  // escape hatch to an explicit absolute from/to and carries no resolveRange preset.
  const PRESETS = {
    today: 'Today',
    week: 'This week',
    'last-week': 'Last week',
    month: 'This month',
    'last-month': 'Last month',
  };
  const BILLABLE_LABEL = { billable: 'billable only', all: 'all entries', 'non-billable': 'non-billable' };
  const BY_LABEL = { client: 'client', project: 'project', day: 'day', tag: 'tag' };

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

  // The builder's edit state. `editing` is null for a fresh New report, or the name of the
  // saved definition being edited (so Save routes to editReport not saveReport). The range
  // half is EITHER a preset name (re-resolved on each run by core) OR a custom absolute
  // from/to passed straight through — the renderer never derives a window.
  const draft = {
    editing: null,
    preset: 'week', // a PRESETS key, or 'custom'
    fromUtc: null,
    toUtc: null,
    by: 'client',
    billableFilter: 'billable',
    clientId: null,
    projectId: null,
    tag: '',
    rounding: false,
    roundingIncrementMin: 15,
  };

  // The saved definition whose run-output is currently shown (so the Export buttons carry
  // its ref — main exports the definition's range, byte-identical to `tt report run --csv`).
  let runningRef = null;

  // ----------------------------------------------------------------- spec summary

  // A one-line human summary of a saved definition's spec, painted on its card. The range
  // half reads the stored relative preset OR the absolute custom window; the rest mirrors
  // the def's group-by / client-or-tag filter / billable / rounding. Pure formatting of the
  // stored def — no range resolution here (that is core's, at run time).
  function rangeSummary(spec) {
    if (spec.kind === 'preset') return PRESETS[spec.preset] || spec.preset;
    return `Custom: ${rangeLabel(spec.fromUtc, spec.toUtc)}`;
  }
  function specSummary(def) {
    const parts = [
      `<span class="k">${escapeHtml(rangeSummary(def.rangeSpec))}</span>`,
      `by <span class="k">${escapeHtml(BY_LABEL[def.by] || def.by)}</span>`,
    ];
    if (def.tag) parts.push(escapeHtml(`#${def.tag}`));
    parts.push(escapeHtml(BILLABLE_LABEL[def.billableFilter] || def.billableFilter));
    parts.push(def.rounding ? `round ${def.roundingIncrementMin} min` : 'no rounding');
    return parts.join(' · ');
  }

  // ----------------------------------------------------------------- defs list (§09 R08)

  // Paint the saved-definition list (window.stint.listReports, parity with `tt report ls`).
  // Each card carries the name + spec summary and the Run / Edit / kebab affordances; the
  // kebab opens Rename / Delete in place. The renderer holds no state beyond the painted
  // dataset — every action re-reads through core. Best-effort: a read failure leaves the
  // empty state and never blocks the builder.
  async function renderDefs() {
    const host = $('rep-defs');
    const empty = $('rep-defs-empty');
    if (!host) return;
    let defs = [];
    try {
      defs = await window.stint.listReports();
    } catch {
      /* the saved-defs list is best-effort; the builder still opens */
    }
    if (!defs.length) {
      host.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    host.innerHTML = defs
      .map((d) => {
        const sel = draft.editing === d.name ? ' sel' : '';
        return (
          `<div class="def${sel}" data-name="${escapeHtml(d.name)}">` +
          `<div class="di"><div class="dname">${escapeHtml(d.name)}</div>` +
          `<div class="dspec">${specSummary(d)}</div></div>` +
          `<div class="dactions">` +
          `<button type="button" class="def-run" data-act="run">${icon('play')}Run</button>` +
          `<button type="button" class="def-edit" data-act="edit">${icon('edit')}Edit</button>` +
          `<button type="button" class="def-kebab" data-act="menu" aria-label="Rename or delete">${icon('dots')}</button>` +
          `</div></div>`
        );
      })
      .join('');
  }

  // ----------------------------------------------------------------- builder (§09 R08)

  // The three segmented controls, single-sourced: the draft field each drives, the container
  // it lives in, the button class it holds, and the data-* attribute that names each option.
  // selectSegment, paintBuilder, and the click wiring all read this one map — so the field ↔
  // attribute pairing is stated once, not re-inlined as a near-identical predicate at each site.
  const SEGMENTS = {
    preset: { container: 'rep-preset-seg', btn: '.preset', attr: 'preset' },
    by: { container: 'rep-by-seg', btn: '.seg-btn', attr: 'by' },
    billableFilter: { container: 'rep-billable-seg', btn: '.seg-btn', attr: 'billable' },
  };

  // Reflect exactly one active segment in a segmented control (and its aria-pressed): the
  // button whose data-<attr> equals the current draft value is the chosen one.
  function selectSegment(field) {
    const seg = SEGMENTS[field];
    const container = $(seg.container);
    for (const b of container.querySelectorAll(seg.btn)) {
      const on = b.dataset[seg.attr] === draft[field];
      b.classList.toggle('on', on);
      if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(on));
    }
  }

  // The increment picker only matters when rounding is ON — disabled + de-emphasized when
  // off, so the control group reads as a single Off/On decision first (§09 R4).
  function reflectRounding() {
    const inc = $('rep-rounding-increment');
    if (!inc) return;
    inc.disabled = !draft.rounding;
    inc.classList.toggle('off', !draft.rounding);
  }

  // Paint the builder controls from the current draft (after opening New or Edit).
  function paintBuilder() {
    $('rep-builder-title').textContent = draft.editing ? `Edit “${draft.editing}”` : 'New report';
    $('rep-name').value = draft.editing ?? '';
    selectSegment('preset');
    $('rep-custom-range').hidden = draft.preset !== 'custom';
    selectSegment('by');
    selectSegment('billableFilter');
    $('rep-tag').value = draft.tag;
    $('rep-rounding').checked = draft.rounding;
    $('rep-rounding-increment').value = String(draft.roundingIncrementMin);
    reflectRounding();
    $('rep-delete').hidden = draft.editing === null;
    $('rep-client').value = draft.clientId === null ? '' : String(draft.clientId);
  }

  // Reset the draft to a fresh New-report state (a This-week, billable, client-grouped def).
  function resetDraft() {
    draft.editing = null;
    draft.preset = 'week';
    draft.fromUtc = null;
    draft.toUtc = null;
    draft.by = 'client';
    draft.billableFilter = 'billable';
    draft.clientId = null;
    draft.projectId = null;
    draft.tag = '';
    draft.rounding = false;
    draft.roundingIncrementMin = 15;
  }

  // Load an existing saved definition into the draft for editing. The range-spec maps back
  // to the preset/custom inputs; the rest is carried verbatim (the renderer holds the ids).
  function loadDraft(def) {
    draft.editing = def.name;
    if (def.rangeSpec.kind === 'preset') {
      draft.preset = def.rangeSpec.preset;
      draft.fromUtc = null;
      draft.toUtc = null;
    } else {
      draft.preset = 'custom';
      draft.fromUtc = def.rangeSpec.fromUtc;
      draft.toUtc = def.rangeSpec.toUtc;
    }
    draft.by = def.by;
    draft.billableFilter = def.billableFilter;
    draft.clientId = def.clientId ?? null;
    draft.projectId = def.projectId ?? null;
    draft.tag = def.tag ?? '';
    draft.rounding = def.rounding;
    draft.roundingIncrementMin = def.roundingIncrementMin;
  }

  // Open the inline builder (filling the client/project filter selects first so they are
  // usable immediately) and reveal it. `forName` edits that def; null opens a New report.
  async function openBuilder(forName) {
    if (forName) {
      let def = null;
      try {
        def = await window.stint.showReport({ name: forName });
      } catch {
        /* fall back to a fresh draft if the show fails */
      }
      if (def) loadDraft(def);
      else resetDraft();
    } else {
      resetDraft();
    }
    await populateClients();
    paintBuilder();
    await populateProjects();
    $('rep-builder').hidden = false;
    $('rep-name').focus();
    void renderDefs(); // re-mark the selected card
  }

  function closeBuilder() {
    $('rep-builder').hidden = true;
    resetDraft();
    void renderDefs();
  }

  // §09 R08: build the renderer-safe SavedReportInput half from the draft. The range-spec is
  // EITHER a relative preset (re-resolved on each run) or an absolute custom window; an unset
  // client/project is omitted (no filter) and a blank tag is dropped. The renderer sends the
  // entity IDS it already holds — it never resolves names — so core filters exactly as for tt.
  function draftToInput() {
    const rangeSpec =
      draft.preset === 'custom'
        ? { kind: 'absolute', fromUtc: draft.fromUtc, toUtc: draft.toUtc }
        : { kind: 'preset', preset: draft.preset };
    const input = {
      name: $('rep-name').value.trim(),
      rangeSpec,
      by: draft.by,
      billableFilter: draft.billableFilter,
      rounding: draft.rounding,
      roundingIncrementMin: draft.roundingIncrementMin,
    };
    if (draft.clientId !== null) input.clientId = draft.clientId;
    if (draft.projectId !== null) input.projectId = draft.projectId;
    if (draft.tag) input.tag = draft.tag;
    return input;
  }

  // Save the builder: create a NEW definition (window.stint.saveReport, parity with `tt
  // report save`) or amend the one being edited (editReport / renameReport, parity with `tt
  // report edit` / `tt report rename`). All persistence + validation (duplicate-name, range
  // resolution) lives in core; the renderer only assembles the payload.
  async function saveBuilder() {
    const input = draftToInput();
    if (!input.name) {
      $('rep-name').focus();
      return;
    }
    // Custom range needs both bounds before it can save.
    if (input.rangeSpec.kind === 'absolute' && (!input.rangeSpec.fromUtc || !input.rangeSpec.toUtc)) {
      return;
    }
    try {
      if (draft.editing === null) {
        await window.stint.saveReport(input);
      } else {
        // Rename first (if the name changed), then amend the rest by the (new) name.
        if (input.name !== draft.editing) {
          await window.stint.renameReport({ name: draft.editing, newName: input.name });
        }
        const { name, ...patch } = input;
        await window.stint.editReport({ name, patch });
      }
    } catch (err) {
      // A duplicate name / invalid range is core's to reject; surface it on the name field.
      $('rep-name').setCustomValidity(String((err && err.message) || err).replace(/^Error:\s*/, ''));
      $('rep-name').reportValidity();
      $('rep-name').setCustomValidity('');
      return;
    }
    closeBuilder();
    await renderDefs();
  }

  // Delete the definition being edited (window.stint.removeReport, parity with `tt report
  // rm`). Confirmed in-window (§12 R13). Clears the run-output if it was showing this def.
  async function deleteBuilder() {
    if (draft.editing === null) return;
    const name = draft.editing;
    if (!window.confirm(`Delete the saved report “${name}”? This cannot be undone.`)) return;
    await window.stint.removeReport({ name });
    if (runningRef === name) hideRun();
    closeBuilder();
    await renderDefs();
  }

  // Rename a definition from a card's kebab (window.stint.renameReport, parity with `tt
  // report rename`). A blank/unchanged name is a no-op.
  async function renameDef(name) {
    const next = window.prompt(`Rename “${name}” to:`, name);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === name) return;
    await window.stint.renameReport({ name, newName: trimmed });
    if (draft.editing === name) draft.editing = trimmed;
    if (runningRef === name) runningRef = trimmed;
    await renderDefs();
  }

  // Delete a definition from a card's kebab (parity with `tt report rm`), confirmed in-window.
  async function deleteDef(name) {
    if (!window.confirm(`Delete the saved report “${name}”? This cannot be undone.`)) return;
    await window.stint.removeReport({ name });
    if (runningRef === name) hideRun();
    if (draft.editing === name) closeBuilder();
    await renderDefs();
  }

  // ----------------------------------------------------------------- run-output (§09 R09)

  function hideRun() {
    runningRef = null;
    $('rep-run').hidden = true;
    $('rep-run-export').hidden = true;
  }

  // §09 R09: the flags a grouped line carries, shown IN CONTEXT on the affected row (not in
  // a separate list). lineFlags is the pure set-membership over the core Report's overlapped
  // / unreviewed-sleep id sets — the renderer derives nothing. Flags use the --flag tokens,
  // never the accent (§15 discipline).
  function flagsHtml(line, report) {
    return lineFlags(line, report.overlappedEntryIds, report.unreviewedSleepEntryIds)
      .map((f) => ` <span class="report-flag" title="${escapeHtml(f)}">${escapeHtml(f)}</span>`)
      .join('');
  }
  function rowHtml(line, depth, report, rounding) {
    // Depth-0 group rows vs indented sub-rows; the sub-row indent + muted colour live in CSS
    // (.report-sub td), not an inline style, so the table reads from one place.
    const cls = depth === 0 ? 'report-grp' : 'report-sub';
    const secs = rounding ? line.roundedSeconds : line.totalSeconds;
    return (
      `<tr class="${cls}"><td>${escapeHtml(line.key)}${flagsHtml(line, report)}</td>` +
      `<td class="num">${fmtHM(secs)}</td></tr>` +
      (line.children || []).map((c) => rowHtml(c, depth + 1, report, rounding)).join('')
    );
  }

  // Paint the run-output panel from the core Report runReport returned. The saved def's own
  // rounding rides report.options.rounding (so the displayed line is the rounded total when
  // the def rounds, the exact total otherwise) — the renderer chooses which core-owned
  // seconds to show and re-derives no total.
  function paintRun(name, report) {
    runningRef = name;
    const rounding = report.options.rounding;
    const grand = rounding ? report.grandRoundedSeconds : report.grandTotalSeconds;
    $('rep-run-caption').textContent = `Run · ${name}`;
    $('rep-run-rows').innerHTML =
      report.lines.map((l) => rowHtml(l, 0, report, rounding)).join('') ||
      '<tr><td colspan="2" class="report-empty">No time in this range.</td></tr>';
    $('rep-run-total').textContent = fmtHM(grand);
    $('rep-run-grand').textContent = fmtHM(grand);
    $('rep-run-range').textContent = rangeLabel(report.rangeFromUtc, report.rangeToUtc);
    $('rep-run').hidden = false;
    $('rep-run-export').hidden = false;
    $('rep-export-status').textContent = '';
  }

  // Run a saved definition by name. core resolves its stored range-spec and totals it
  // (window.stint.runReport, parity with `tt report run`) — no renderer-side math — and the
  // returned core Report is painted.
  async function runDef(name) {
    const report = await window.stint.runReport({ ref: name });
    paintRun(name, report);
  }

  // §09 R09 / R06: export CSV / JSON FROM the currently-run saved report. The request carries
  // the saved-report ref, so main resolves the definition's range and exports its raw entries
  // (byte-identical to `tt report run <name> --csv|--json`); the renderer holds no export math.
  async function exportRun(format) {
    if (runningRef === null) return;
    const status = $('rep-export-status');
    status.textContent = '';
    try {
      const res = await window.stint.exportEntries({ format, savedReportRef: runningRef });
      if (!res || res.canceled) {
        status.textContent = 'Export canceled.';
        return;
      }
      status.textContent = `Exported ${res.written} entr${res.written === 1 ? 'y' : 'ies'} to ${res.path}.`;
    } catch (err) {
      status.textContent = `Export failed: ${String((err && err.message) || err).replace(/^Error:\s*/, '')}`;
    }
  }

  // ----------------------------------------------------------------- filter selects

  // §09 R03: populate the project filter for the chosen client. With no client selected the
  // project filter is disabled and reads "All projects" (a project filter only makes sense
  // within a client). When a client is chosen, list its active projects from the same source
  // tt uses and offer them by id. The renderer carries the id straight from listProjects.
  async function populateProjects() {
    const sel = $('rep-project');
    if (!sel) return;
    sel.innerHTML = '<option value="">All projects</option>';
    if (draft.clientId === null) {
      draft.projectId = null;
      sel.disabled = true;
      sel.value = '';
      return;
    }
    let projects = [];
    try {
      projects = await window.stint.listProjects({ clientId: draft.clientId });
    } catch {
      /* best-effort */
    }
    for (const p of projects) {
      const opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = p.name;
      sel.appendChild(opt);
    }
    sel.disabled = false;
    sel.value = draft.projectId === null ? '' : String(draft.projectId);
  }

  // §09 R03: fill the client filter from the same reference data tt uses (active clients
  // only). The leading "All clients" option is the no-filter default.
  async function populateClients() {
    const sel = $('rep-client');
    if (!sel) return;
    sel.innerHTML = '<option value="">All clients</option>';
    let clients = [];
    try {
      clients = await window.stint.listClients();
    } catch {
      /* best-effort */
    }
    for (const c of clients) {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = c.name;
      sel.appendChild(opt);
    }
  }

  // ----------------------------------------------------------------- wiring

  function wire() {
    // The single accent primary action of the view: open the inline builder for a New report.
    $('rep-new').addEventListener('click', () => void openBuilder(null));

    // The saved-definition cards: Run / Edit / kebab (Rename / Delete). One delegated handler.
    $('rep-defs').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const card = ev.target.closest('.def');
      const name = card && card.dataset.name;
      if (!name) return;
      const act = btn.dataset.act;
      if (act === 'run') void runDef(name);
      else if (act === 'edit') void openBuilder(name);
      else if (act === 'menu') {
        // A minimal kebab: choose Rename or Delete (the in-window destructive confirm follows).
        const choice = window.prompt(`“${name}” — type "rename" or "delete":`, 'rename');
        if (choice === null) return;
        const c = choice.trim().toLowerCase();
        if (c === 'rename') void renameDef(name);
        else if (c === 'delete') void deleteDef(name);
      }
    });

    // Wire one segmented control: a click on an option writes the named draft field from the
    // option's data-<attr>, reflects the selection, then runs an optional after-effect. All
    // three segments share this — no per-control copy of the find-closest / set-draft / repaint
    // dance (the field ↔ container ↔ attribute mapping comes from SEGMENTS).
    function wireSegment(field, after) {
      const seg = SEGMENTS[field];
      $(seg.container).addEventListener('click', (ev) => {
        const btn = ev.target.closest(seg.btn);
        if (!btn) return;
        draft[field] = btn.dataset[seg.attr];
        selectSegment(field);
        if (after) after();
      });
    }

    // §09 R01: the range preset chips. A named preset sets draft.preset; Custom reveals the
    // explicit from/to inputs. No run here — Save persists, Run resolves later.
    wireSegment('preset', () => {
      $('rep-custom-range').hidden = draft.preset !== 'custom';
    });
    // §09 R02/R03: group-by and billable-filter segments.
    wireSegment('by');
    wireSegment('billableFilter');
    // Custom from/to → absolute UTC bounds carried verbatim into the saved range-spec.
    $('rep-range-from').addEventListener('change', () => {
      const v = $('rep-range-from').value;
      draft.fromUtc = v ? new Date(v).toISOString() : null;
    });
    $('rep-range-to').addEventListener('change', () => {
      const v = $('rep-range-to').value;
      draft.toUtc = v ? new Date(v).toISOString() : null;
    });

    // §09 R03: the client filter sends an ID (never a name) and repopulates the project
    // options for that client (clearing any stale project selection).
    $('rep-client').addEventListener('change', async () => {
      const v = $('rep-client').value;
      draft.clientId = v === '' ? null : Number(v);
      draft.projectId = null;
      await populateProjects();
    });
    $('rep-project').addEventListener('change', () => {
      const v = $('rep-project').value;
      draft.projectId = v === '' ? null : Number(v);
    });
    $('rep-tag').addEventListener('input', () => {
      draft.tag = $('rep-tag').value.trim();
    });

    // §09 R04: rounding rides the saved DEFINITION (stored per-def, not the global setting):
    // the toggle + the 6/10/15/30 increment picker update the draft, persisted by Save.
    $('rep-rounding').addEventListener('change', () => {
      draft.rounding = $('rep-rounding').checked;
      reflectRounding();
    });
    $('rep-rounding-increment').addEventListener('change', () => {
      draft.roundingIncrementMin = Number($('rep-rounding-increment').value);
    });

    // Builder footer: Save / Cancel / Delete.
    $('rep-builder').addEventListener('submit', (ev) => {
      ev.preventDefault();
      void saveBuilder();
    });
    $('rep-cancel').addEventListener('click', () => closeBuilder());
    $('rep-delete').addEventListener('click', () => void deleteBuilder());

    // §09 R06 / R09: the run-output Export CSV / JSON buttons (export FROM the saved report).
    $('rep-export-csv').addEventListener('click', () => void exportRun('csv'));
    $('rep-export-json').addEventListener('click', () => void exportRun('json'));
  }

  // Repaint the saved-defs list whenever the Reports view is shown. The view routes via
  // app.js (which only toggles the section hidden); render here so the list reflects current
  // truth on every visit — and on every external change while the view is visible.
  function refreshIfVisible() {
    const section = document.querySelector('.view[data-view="reports"]');
    if (section && !section.hidden) void renderDefs();
  }

  function init() {
    wire();
    const navItem = document.querySelector('.nav-item[data-view="reports"]');
    if (navItem) navItem.addEventListener('click', () => void renderDefs());
    if (window.stint && window.stint.onChange) window.stint.onChange(() => refreshIfVisible());
    // Paint once so a route into the view (or app.js's report-btn) lands on the populated list.
    void renderDefs();
  }

  init();
})();
