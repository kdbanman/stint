// §12 R11 — the in-window Settings view. Editable controls for every §14 setting, modeled
// on mockups/settings.html. Each control persists its value over the SAME setSetting IPC
// `tt config set` uses (parity-covered — no new channel), then reloads, so an edit is
// immediately the new truth on BOTH surfaces. Classic script (no ES modules) so it loads
// over file:// in the packaged app; helpers come from window.SU (util.js, loaded first).
//
// This file is intentionally additive: it does not edit app.js. It hooks the Settings
// nav-item to render the panel, mirrors the accent/date-format modes onto the renderer
// (so app.js's plain applyAccent stays honoured), and re-reads on every external change.
(function () {
  const { friendlyHotkey, applyAccentMode, applyDateFormat } = window.SU;
  const panel = () => document.getElementById('settings-panel');

  // The live accent-usage + date-format modes. render() re-applies them off fresh getState
  // (on startup, on every external change, and right after a setSetting), so the chosen mode
  // is honoured: 'monochrome' maps --accent onto the ink colour (suppressing the coloured
  // accent), and the date format drives util.js's localTime.
  let accentMode = 'system';
  let dateFormatMode = 'system';

  // §14 — the eight editable settings, in the mockup's grouped order. `key` is the camelCase
  // setSetting key (the same key tt's descriptor maps from its snake_case); `kind` chooses the
  // control; `options` lists [value, label] pairs for selects/segments.
  const FIELDS = [
    { group: 'Reporting', key: 'rounding', label: 'Rounding', hint: 'Applies at display/export only; stored time stays exact.', kind: 'toggle' },
    {
      group: 'Reporting', key: 'roundingIncrementMin', label: 'Rounding increment', kind: 'select', cast: 'number',
      options: [[6, 'nearest 6 min'], [10, 'nearest 10 min'], [15, 'nearest 15 min'], [30, 'nearest 30 min']],
    },
    {
      group: 'Reporting', key: 'weekStart', label: 'Week start', kind: 'segment',
      options: [['monday', 'Monday'], ['sunday', 'Sunday']],
    },
    {
      group: 'Check-ins', key: 'firstCheckinMin', label: 'First check-in', hint: 'After a timer starts.', kind: 'select', cast: 'number',
      options: [[30, '30 min'], [60, '60 min'], [90, '90 min']],
    },
    {
      group: 'Check-ins', key: 'checkinIntervalMin', label: 'Check-in interval', kind: 'select', cast: 'number',
      options: [[15, '15 min'], [30, '30 min'], [60, '60 min']],
    },
    { group: 'System', key: 'globalHotkey', label: 'Global hotkey', hint: 'Toggles the timer from anywhere.', kind: 'hotkey' },
    {
      group: 'System', key: 'accent', label: 'Accent usage', kind: 'select',
      options: [['system', 'System accent (primary action only)'], ['monochrome', 'Monochrome']],
    },
    {
      group: 'System', key: 'dateFormat', label: 'Date / number format', kind: 'select',
      options: [['system', 'System locale'], ['iso', 'ISO (24-hour)']],
    },
  ];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  // Persist one setting then reload — the value is now the new truth core reads on both
  // surfaces. The hotkey edit additionally re-registers the OS shortcut in main.ts's
  // setSetting handler, so a hotkey change takes effect live (no restart).
  async function persist(key, value) {
    await window.stint.setSetting({ key, value });
    // Re-render off fresh state so every control reflects the saved value (and the accent /
    // date-format modes re-apply). app.js's onChange/load also fires from the refreshAll.
    await render();
  }

  function fieldControl(f, settings) {
    const v = settings[f.key];
    if (f.kind === 'toggle') {
      const on = v === true;
      return (
        `<button type="button" class="set-toggle${on ? ' on' : ''}" data-key="${f.key}" ` +
        `role="switch" aria-checked="${on}" aria-label="${esc(f.label)}"><i></i></button>` +
        `<span class="set-toggle-lbl">${on ? 'On' : 'Off'}</span>`
      );
    }
    if (f.kind === 'segment') {
      return (
        `<span class="seg set-seg" role="group" aria-label="${esc(f.label)}" data-key="${f.key}">` +
        f.options
          .map(
            ([val, lbl]) =>
              `<button type="button" class="seg-btn${val === v ? ' on' : ''}" data-key="${f.key}" data-value="${esc(val)}" aria-pressed="${val === v}">${esc(lbl)}</button>`,
          )
          .join('') +
        `</span>`
      );
    }
    if (f.kind === 'hotkey') {
      return `<span class="hk set-hotkey" data-key="${f.key}">${esc(friendlyHotkey(String(v)))}</span>`;
    }
    // select
    return (
      `<select class="set-field" data-key="${f.key}"${f.cast === 'number' ? ' data-cast="number"' : ''} aria-label="${esc(f.label)}">` +
      f.options
        .map(([val, lbl]) => `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(lbl)}</option>`)
        .join('') +
      `</select>`
    );
  }

  function rowHtml(f, settings) {
    const hint = f.hint ? `<small>${esc(f.hint)}</small>` : '';
    return (
      `<div class="set-row"><div class="set-k">${esc(f.label)}${hint}</div>` +
      `<div class="set-ctrl">${fieldControl(f, settings)}</div></div>`
    );
  }

  function panelHtml(settings) {
    let html = '';
    let lastGroup = null;
    for (const f of FIELDS) {
      if (f.group !== lastGroup) {
        html += `<div class="set-grp">${esc(f.group)}</div>`;
        lastGroup = f.group;
      }
      html += rowHtml(f, settings);
    }
    return html;
  }

  function wire(host) {
    // Selects (rounding increment, check-ins, accent, date format) — cast numeric values.
    for (const sel of host.querySelectorAll('select.set-field')) {
      sel.addEventListener('change', () => {
        const raw = sel.value;
        const value = sel.dataset.cast === 'number' ? Number(raw) : raw;
        void persist(sel.dataset.key, value);
      });
    }
    // The rounding toggle flips a boolean.
    for (const btn of host.querySelectorAll('.set-toggle')) {
      btn.addEventListener('click', () => {
        void persist(btn.dataset.key, btn.getAttribute('aria-checked') !== 'true');
      });
    }
    // The week-start segmented control sends the picked value.
    for (const btn of host.querySelectorAll('.set-seg .seg-btn')) {
      btn.addEventListener('click', () => {
        void persist(btn.dataset.key, btn.dataset.value);
      });
    }
    // The global-hotkey capture field: focus it and press a chord; the captured accelerator
    // (Electron form) is persisted, then re-registered live by main.ts's setSetting handler.
    for (const el of host.querySelectorAll('.set-hotkey')) {
      el.setAttribute('tabindex', '0');
      el.title = 'Click and press a key combination';
      el.addEventListener('keydown', (ev) => {
        ev.preventDefault();
        const accel = toAccelerator(ev);
        if (accel) void persist(el.dataset.key, accel);
      });
    }
  }

  // Translate a keydown into an Electron accelerator (e.g. 'CommandOrControl+Alt+T'). A bare
  // modifier press is ignored — we wait for a real key to land alongside the modifiers.
  function toAccelerator(ev) {
    const key = ev.key;
    if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return null;
    const parts = [];
    if (ev.ctrlKey || ev.metaKey) parts.push('CommandOrControl');
    if (ev.altKey) parts.push('Alt');
    if (ev.shiftKey) parts.push('Shift');
    const main = key.length === 1 ? key.toUpperCase() : key;
    parts.push(main);
    return parts.length > 1 ? parts.join('+') : null;
  }

  async function render() {
    const host = panel();
    if (!host) return;
    let state;
    try {
      state = await window.stint.getState();
    } catch {
      return;
    }
    const settings = (state && state.settings) || {};
    // Mirror the editable modes so the renderer keeps honouring them across app.js loads.
    accentMode = settings.accent === 'monochrome' ? 'monochrome' : 'system';
    dateFormatMode = settings.dateFormat === 'iso' ? 'iso' : 'system';
    applyAccentMode(accentMode, state && state.accent);
    applyDateFormat(dateFormatMode);
    host.innerHTML = panelHtml(settings);
    wire(host);
  }

  // The Settings nav-item routes via app.js (which only toggles the section hidden); render
  // the panel here whenever it is chosen so the controls reflect current state.
  const navItem = document.querySelector('.nav-item[data-view="settings"]');
  if (navItem) navItem.addEventListener('click', () => void render());

  // Re-read on every external change (a tt write may have changed a setting) so the panel +
  // the accent/date-format modes stay current. Also render once on startup so the modes are
  // applied from first paint even before the Settings view is opened.
  if (window.stint && window.stint.onChange) {
    window.stint.onChange(() => {
      // Only re-fetch when the Settings view is the visible one (cheap-guard); always keep
      // the accent/date modes applied via the wrapped applyAccent on app.js's own load.
      const section = document.querySelector('.view[data-view="settings"]');
      if (section && !section.hidden) void render();
    });
  }
  void render();
})();
