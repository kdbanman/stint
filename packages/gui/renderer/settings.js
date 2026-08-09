// §12 R11 — the in-window Settings view. Editable controls for every §14 setting, modeled
// on context/mockups/settings.html. Each control persists its value over the SAME setSetting IPC
// `tt config set` uses (parity-covered — no new channel), then reloads, so an edit is
// immediately the new truth on BOTH surfaces. Classic script; helpers come from window.SU
// (the bundled su.ts entry, loaded first — see context/architecture.html §08).
//
// This file is intentionally additive: it does not edit app.js. It hooks the Settings
// nav-item to render the panel, mirrors the date-format mode onto the renderer, and
// re-reads on every external change.
(function () {
  const { friendlyHotkey, applyDateFormat, applyTimeZone } = window.SU;
  const panel = () => document.getElementById('settings-panel');

  // The live date-format mode. render() re-applies it off fresh getState (on startup, on
  // every external change, and right after a setSetting), so the chosen format drives
  // SU.localTime.
  let dateFormatMode = 'system';

  // §14 — the editable settings, in the mockup's grouped order. `key` is the camelCase
  // setSetting key (the same key tt's descriptor maps from its snake_case); `kind` chooses the
  // control; `options` lists [value, label] pairs for selects/segments.
  const FIELDS = [
    { group: 'Reporting', key: 'rounding', label: 'Rounding', kind: 'toggle' },
    {
      group: 'Reporting', key: 'roundingIncrementMin', label: 'Rounding increment', kind: 'select', cast: 'number',
      options: [[6, 'nearest 6 min'], [10, 'nearest 10 min'], [15, 'nearest 15 min'], [30, 'nearest 30 min']],
    },
    {
      group: 'Reporting', key: 'weekStart', label: 'Week start', kind: 'segment',
      options: [['monday', 'Monday'], ['sunday', 'Sunday']],
    },
    // §14 — the Timeline group (G15, mockup settings.html): the working-hours pair (one row,
    // two strict HH:MM inputs), the picker's default-window mode, and the around-now span.
    // The Around row is disabled (row class 'off') while the mode is working_hours — the span
    // is only consulted by the around_now window (G16).
    {
      group: 'Timeline', key: 'workingHours', label: 'Working hours', kind: 'hhmm-pair',
      note: 'Entries and the picker open to these hours',
      keys: ['workingHoursStart', 'workingHoursEnd'],
    },
    {
      group: 'Timeline', key: 'pickerWindowMode', label: 'Picker window', kind: 'segment',
      options: [['working_hours', 'Working hours'], ['around_now', 'Around now']],
    },
    {
      group: 'Timeline', key: 'pickerAroundHours', label: 'Around', kind: 'select', cast: 'number',
      options: [[4, '4 h'], [6, '6 h'], [8, '8 h'], [12, '12 h']],
      offWhen: (settings) => settings.pickerWindowMode !== 'around_now',
    },
    {
      group: 'Check-ins', key: 'firstCheckinMin', label: 'First check-in', kind: 'select', cast: 'number',
      options: [[30, '30 min'], [60, '60 min'], [90, '90 min']],
    },
    {
      group: 'Check-ins', key: 'checkinIntervalMin', label: 'Check-in interval', kind: 'select', cast: 'number',
      options: [[15, '15 min'], [30, '30 min'], [60, '60 min']],
    },
    { group: 'System', key: 'globalHotkey', label: 'Global hotkey', kind: 'hotkey' },
    {
      group: 'System', key: 'dateFormat', label: 'Date & number format', kind: 'select',
      options: [['system', 'System locale'], ['iso', 'ISO (24-hour)']],
    },
    // §04 R06 / §14 — the configured time zone: 'System' first (follow the OS at read
    // time), then the platform's IANA zone list (the same list core validates against).
    // Persists over the SAME setSetting channel `tt config set time_zone` uses.
    {
      group: 'System', key: 'timeZone', label: 'Time zone', kind: 'select',
      note: 'Display, time entry, and day grouping use this zone',
      options: [['system', 'System']].concat(timeZoneOptions()),
    },
  ];

  // The platform zone list for the time-zone select ([value, label] pairs). Guarded: an
  // engine without Intl.supportedValuesOf still renders the control with 'System' alone.
  function timeZoneOptions() {
    try {
      return Intl.supportedValuesOf('timeZone').map((z) => [z, z]);
    } catch {
      return [];
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  // Persist one setting then reload — the value is now the new truth core reads on both
  // surfaces. The hotkey edit additionally re-registers the OS shortcut in main.ts's
  // setSetting handler, so a hotkey change takes effect live (no restart). A REJECTED
  // setSetting (core validation: a malformed HH:MM, an inverted working-hours pair, an
  // out-of-range around span) stores nothing — the re-render below then repaints the
  // control from stored truth, so the field visibly reverts (§14).
  async function persist(key, value) {
    try {
      await window.stint.setSetting({ key, value });
    } catch {
      // Invalid value rejected by core — nothing stored; fall through to re-render.
    }
    // Re-render off fresh state so every control reflects the saved value (and the accent /
    // date-format modes re-apply). app.js's onChange/load also fires from the refreshAll.
    await render();
  }

  function fieldControl(f, settings, off) {
    const v = settings[f.key];
    if (f.kind === 'hhmm-pair') {
      // §14 — one row, two strict HH:MM text inputs (workingHoursStart / workingHoursEnd),
      // each persisting on change over the SAME setSetting channel. Core validates (shape +
      // start<end); a rejection re-renders, reverting the field to stored truth.
      const input = (key) =>
        `<input class="set-field set-hhmm tnum" type="text" inputmode="numeric" size="5" maxlength="5" ` +
        `placeholder="HH:MM" data-key="${key}" value="${esc(settings[key] ?? '')}" ` +
        `aria-label="${esc(f.label)} ${key === f.keys[0] ? 'start' : 'end'}">`;
      return input(f.keys[0]) + `<span class="set-hhmm-sep">–</span>` + input(f.keys[1]);
    }
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
    // A stored value the option list does not carry (e.g. a time-zone ALIAS core accepts
    // but Intl.supportedValuesOf omits, like Asia/Kolkata) is appended as its own option —
    // otherwise the browser would silently show the first option while the stored truth
    // differs.
    const listed = f.options.some(([val]) => val === v);
    return (
      `<select class="set-field" data-key="${f.key}"${f.cast === 'number' ? ' data-cast="number"' : ''}${off ? ' disabled' : ''} aria-label="${esc(f.label)}">` +
      f.options
        .map(([val, lbl]) => `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(lbl)}</option>`)
        .join('') +
      (listed || v === undefined ? '' : `<option value="${esc(v)}" selected>${esc(v)}</option>`) +
      `</select>`
    );
  }

  function rowHtml(f, settings) {
    // §14 — an `offWhen` field renders dimmed + disabled while its precondition does not
    // hold (the Around row while the picker window mode is working_hours, per the mockup).
    const off = typeof f.offWhen === 'function' && f.offWhen(settings);
    return (
      `<div class="set-row${off ? ' off' : ''}"><div class="set-k">${esc(f.label)}` +
      (f.note ? `<small>${esc(f.note)}</small>` : '') +
      `</div>` +
      `<div class="set-ctrl">${fieldControl(f, settings, off)}</div></div>`
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

  // §19 R03/R04/R06 — the Software Update group. The Current version row prints the version
  // (the SAME core APP_VERSION constant `tt --version` reports), matching the mockup's
  // `.ver` span; the Check-for-updates row adds a "Check now" button + a result line that
  // paints up-to-date / "update available · <version>" (a link to the release) / a graceful
  // error (R03). When an update is available, the guided-install panel (R04) appears: a
  // "Download & install <version>" primary action (this section's single accent action — §15
  // / G10), a progress bar bound to onUpdateProgress, and the numbered guided steps (download
  // → replace the app in /Applications → approve once at first launch, with the one-time
  // Gatekeeper note — no Developer ID). After download completes the action becomes "Reveal
  // installer". The version is read over the GUI-only window.stint.update.getVersion() bridge
  // (R03), falling back to the getState appVersion when the bridge is unavailable. The
  // pill class mirrors the mockup (.pill.new for an available update).
  function softwareUpdateHtml(appVersion, result, progress) {
    const ver = esc(appVersion || '—');
    let pill = '';
    if (result && result.status === 'update-available') {
      const v = esc(result.latestVersion || '');
      const url = esc(result.releaseUrl || '');
      pill = `<a class="pill new" href="${url}" data-update-link>update available · ${v}</a>`;
    }
    let line = '';
    if (result) {
      if (result.status === 'up-to-date') {
        line = `<span class="update-result ok" role="status">Up to date.</span>`;
      } else if (result.status === 'update-available') {
        const v = esc(result.latestVersion || '');
        const url = esc(result.releaseUrl || '');
        line =
          `<span class="update-result new" role="status">Update available · ` +
          `<a href="${url}" data-update-link>${v}</a></span>`;
      } else {
        line = `<span class="update-result err" role="status">${esc(result.message || 'Update check failed.')}</span>`;
      }
    }
    return (
      `<div class="set-grp">Software update</div>` +
      `<div class="set-row"><div class="set-k">Current version</div>` +
      `<div class="set-ctrl"><span class="ver">${ver}</span>${pill}</div></div>` +
      `<div class="set-row"><div class="set-k">Check for updates</div>` +
      `<div class="set-ctrl"><button type="button" id="update-check" class="set-update-btn">` +
      `<svg class="ic" aria-hidden="true"><use href="#i-check" /></svg>Check now</button>` +
      ` <span id="update-status">${line}</span></div></div>` +
      guidedInstallHtml(result, progress)
    );
  }

  // §19 R04 — the guided download + install panel. Shown once an update is available (or while a
  // download is in flight / ready). The primary action is "Download & install <version>" — the
  // section's single accent action (§15) — which becomes "Reveal installer" once the artifact is
  // on disk. The progress bar (.step .bar) is bound to onUpdateProgress; the numbered guided
  // steps render from the plan the main process supplies (download → replace app in /Applications
  // → approve once at first launch with the one-time Gatekeeper note, no Developer ID).
  function guidedInstallHtml(result, progress) {
    const available = result && result.status === 'update-available';
    if (!available && !progress) return '';
    const version = esc(
      (progress && progress.version) || (result && result.latestVersion) || '',
    );
    const phase = (progress && progress.phase) || 'idle';
    const pct = progress && typeof progress.percent === 'number' ? progress.percent : 0;
    // Default the guided steps to the plan the last progress frame carried; the action button is
    // the single accent action per §15. After 'ready', the action reveals the installer.
    const steps = (progress && Array.isArray(progress.steps) && progress.steps.length)
      ? progress.steps
      : DEFAULT_GUIDED_STEPS;
    const dlIcon = '<svg class="ic" aria-hidden="true"><use href="#i-download" /></svg>';
    const okIcon = '<svg class="ic" aria-hidden="true"><use href="#i-check" /></svg>';
    let headIcon;
    let head;
    let action;
    if (phase === 'downloading') {
      headIcon = dlIcon;
      head = `Downloading ${version}`;
      action = '';
    } else if (phase === 'ready') {
      headIcon = okIcon;
      head = `Downloaded ${version}`;
      action = `<button type="button" id="update-reveal" class="primary"><svg class="ic" aria-hidden="true"><use href="#i-restore" /></svg>Reveal installer</button>`;
    } else if (phase === 'error') {
      headIcon = dlIcon;
      head = `Update download failed`;
      action = `<button type="button" id="update-download" class="primary">${dlIcon}Download &amp; install ${version}</button>`;
    } else {
      headIcon = dlIcon;
      head = `Guided install — ${version}`;
      action = `<button type="button" id="update-download" class="primary">${dlIcon}Download &amp; install ${version}</button>`;
    }
    const barPct = Math.max(0, Math.min(100, pct));
    const showBar = phase === 'downloading';
    const stepsHtml = steps
      .map((s, i) => {
        if (i === 0 && showBar) {
          return (
            `<div class="step"><span class="n">1</span>` +
            `<span class="bar"><i style="width:${barPct}%"></i></span>` +
            `<span>${esc(s)} ${barPct}%</span></div>`
          );
        }
        const done = phase === 'ready' && i === 0;
        return `<div class="step${done ? ' done' : ''}"><span class="n">${i + 1}</span><span>${esc(s)}</span></div>`;
      })
      .join('');
    const err =
      phase === 'error' && progress && progress.message
        ? `<div class="update-result err" role="status">${esc(progress.message)}</div>`
        : '';
    return (
      `<div class="update" id="update-panel">` +
      `<div class="uhd"><span class="uhd-t">${headIcon}${esc(head)}</span>${action}</div>` +
      `<div class="steps">${stepsHtml}</div>` +
      err +
      `<div class="restore-note">` +
      `<svg class="ic" aria-hidden="true"><use href="#i-info" /></svg>` +
      `Updates never touch the database — the artifact downloads to a temp folder.</div>` +
      `</div>`
    );
  }

  // The default guided steps shown before the main process sends a platform-specific plan (it is
  // the macOS plan including the one-time Gatekeeper beat, no Developer ID — the conservative
  // default; the live plan from onUpdateProgress replaces this once a download starts).
  const DEFAULT_GUIDED_STEPS = [
    'Download the new version',
    'Replace the app in /Applications (Stint reveals the installer for you)',
    'Approve once at first launch in System Settings → Privacy & Security — one-time Gatekeeper clearance, no Developer ID needed',
  ];

  // The most recent check verdict + the most recent progress frame, kept so a re-render (an
  // external change, or a fresh progress frame) repaints the whole group consistently.
  let lastUpdateResult = null;
  let lastUpdateProgress = null;

  // Render the Software Update group into its own host and wire its actions. The version comes
  // from the GUI-only window.stint.update bridge (R03); Check now calls update.check(); Download
  // & install calls update.download() (R04) and progress arrives over onUpdateProgress; Reveal
  // installer calls update.reveal(). External links open in the user's browser (no in-window nav).
  async function renderSoftwareUpdate(fallbackVersion) {
    const host = document.getElementById('software-update');
    if (!host) return;
    let version = fallbackVersion;
    const bridge = window.stint && window.stint.update;
    if (bridge && bridge.getVersion) {
      try {
        version = await bridge.getVersion();
      } catch {
        /* keep the snapshot fallback */
      }
    }
    host.innerHTML = softwareUpdateHtml(version, lastUpdateResult, lastUpdateProgress);
    // Check now (R03).
    const checkBtn = document.getElementById('update-check');
    if (checkBtn && bridge && bridge.check) {
      checkBtn.addEventListener('click', async () => {
        checkBtn.disabled = true;
        checkBtn.textContent = 'Checking…';
        try {
          lastUpdateResult = await bridge.check();
        } catch {
          lastUpdateResult = { status: 'error', message: 'Update check failed.' };
        }
        // A fresh check starts a clean guided-install panel.
        lastUpdateProgress = null;
        void renderSoftwareUpdate(fallbackVersion);
      });
    }
    // Download & install (R04) — kicks off the download; progress arrives over onUpdateProgress.
    const dlBtn = document.getElementById('update-download');
    if (dlBtn && bridge && bridge.download) {
      dlBtn.addEventListener('click', async () => {
        dlBtn.disabled = true;
        // Optimistically show the downloading phase; the first progress frame replaces it.
        lastUpdateProgress = {
          phase: 'downloading',
          percent: 0,
          version: (lastUpdateResult && lastUpdateResult.latestVersion) || '',
          steps: DEFAULT_GUIDED_STEPS,
        };
        void renderSoftwareUpdate(fallbackVersion);
        try {
          await bridge.download();
        } catch {
          lastUpdateProgress = {
            phase: 'error',
            percent: 0,
            version: lastUpdateProgress.version,
            steps: DEFAULT_GUIDED_STEPS,
            message: 'The update download failed.',
          };
          void renderSoftwareUpdate(fallbackVersion);
        }
      });
    }
    // Reveal installer (R04) — opens the downloaded artifact in Finder / the file manager.
    const revealBtn = document.getElementById('update-reveal');
    if (revealBtn && bridge && bridge.reveal) {
      revealBtn.addEventListener('click', async () => {
        try {
          await bridge.reveal();
        } catch {
          /* non-fatal — the path is also shown in the guided steps */
        }
      });
    }
    wireUpdateLinks(host);
  }

  // §20 R04/R05 — the Settings → Backups group (context/mockups/settings.html:173-176). It paints,
  // off the SAME getState snapshot both surfaces read:
  //   • a one-shot recovery-notice banner (R05) when the database was recovered from a backup on
  //     this launch — naming the backup it recovered from and the `.corrupted` file it set aside;
  //   • a "Last backup …" status line (R04) off state.lastBackupUtc, with a "verified" pill;
  //   • a retention picker (backupRetention) persisted over the SAME setSetting channel
  //     `tt config set backup_retention` uses (parity-covered — no new channel);
  //   • a restore list painted from window.stint.listBackups() (name · createdUtc · size), each
  //     row offering a Restore… action wired to window.stint.restoreBackup({ name }) behind the
  //     existing destructive-action confirm gate (§12 R13 — confirmInline, from app.js).
  // listBackups/restoreBackup are the parity twins of `tt backup ls` / `tt backup restore`.

  // A compact size for a backup file. Display only — core owns the bytes.
  function fmtBytes(n) {
    const bytes = Number(n) || 0;
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  }

  // A human date+time label honouring the live date-format mode (ISO 24h vs system locale)
  // AND the configured time zone (§04 R06) — the same modes the §14 controls drive, so
  // backups read consistently with the app. Display only, and deliberately NOT core's
  // `backupStamp`, which is the filename-safe UTC token a backup file is named by: one
  // name, one representation.
  function backupLabel(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    if (dateFormatMode === 'iso') {
      // The field vocabulary's zone-bound rendering, minute precision.
      return window.SU.localInputValue(d).slice(0, 16);
    }
    return d.toLocaleString([], {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: window.SU.currentZone(),
    });
  }

  // §20 R05 — the corruption-recovery banner. Reuses the monochrome warn `.banner` chrome (the
  // same --flag tokens the overlap banner uses — no accent), naming the backup recovered from and
  // the quarantined `.corrupted` sibling so the user can see exactly what happened on launch.
  function recoveryBannerHtml(notice) {
    if (!notice) return '';
    return (
      `<div id="recovery-notice" class="banner recovery" role="status">` +
      `<svg class="ic" aria-hidden="true"><use href="#i-info" /></svg> ` +
      `<span class="recovery-text">Database recovered from <b>${esc(notice.recoveredFrom)}</b> on launch. ` +
      `The unreadable file was set aside as <span class="recovery-quar">${esc(notice.quarantinedTo)}</span>.</span>` +
      `</div>`
    );
  }

  // The retention picker's offered values (mirrors the mockup's last 3 / last 5 / last 10).
  const RETENTION_OPTIONS = [[3, 'last 3'], [5, 'last 5'], [10, 'last 10']];

  function backupsHtml(state, backups) {
    const settings = (state && state.settings) || {};
    const retention = settings.backupRetention || 5;
    const last = state && state.lastBackupUtc;
    const lastLine = last
      ? `<span class="ver">${esc(backupLabel(last))}</span>` +
        `<span class="ok" role="status"><svg class="ic" aria-hidden="true"><use href="#i-check" /></svg>verified</span>`
      : `<span class="set-empty">No backups yet — Stint backs up automatically on launch.</span>`;
    const retSelect =
      `<select class="set-field" data-key="backupRetention" data-cast="number" aria-label="Backups to keep">` +
      RETENTION_OPTIONS.map(
        ([val, lbl]) => `<option value="${val}"${val === retention ? ' selected' : ''}>${esc(lbl)}</option>`,
      ).join('') +
      `</select>`;
    let listHtml;
    if (Array.isArray(backups) && backups.length) {
      listHtml =
        `<div class="backup-list" id="backup-list">` +
        backups
          .map(
            (b) =>
              `<div class="backup-item" data-name="${esc(b.name)}">` +
              `<span class="backup-id"><span class="backup-name">${esc(b.name)}</span>` +
              `<span class="backup-meta">${esc(backupLabel(b.createdUtc))} · ${esc(fmtBytes(b.sizeBytes))}</span></span>` +
              `<button type="button" class="set-update-btn backup-restore" data-name="${esc(b.name)}">` +
              `<svg class="ic" aria-hidden="true"><use href="#i-restore" /></svg>Restore…</button>` +
              `</div>`,
          )
          .join('') +
        `</div>`;
    } else {
      listHtml = `<span class="set-empty">No backups to restore from yet.</span>`;
    }
    return (
      recoveryBannerHtml(state && state.recoveryNotice) +
      `<div class="set-grp">Backups</div>` +
      `<div class="set-row"><div class="set-k">Last backup</div>` +
      `<div class="set-ctrl">${lastLine}</div></div>` +
      `<div class="set-row"><div class="set-k">Keep<small>Older automatic backups are pruned.</small></div>` +
      `<div class="set-ctrl">${retSelect}</div></div>` +
      `<div class="set-row backup-restore-row"><div class="set-k">Restore from backup` +
      `<small>Replaces the current database; the existing file is set aside, not deleted.</small></div>` +
      `<div class="set-ctrl set-ctrl-list">${listHtml}</div></div>`
    );
  }

  // Render the Backups group into its own host and wire its actions. The restore list is read
  // over window.stint.listBackups() (parity with `tt backup ls`); the retention picker persists
  // over setSetting; each Restore… goes through the destructive-action confirm gate (§12 R13).
  async function renderBackups(state) {
    const host = document.getElementById('backups-panel');
    if (!host) return;
    let backups = [];
    try {
      if (window.stint && window.stint.listBackups) backups = await window.stint.listBackups();
    } catch {
      backups = [];
    }
    host.innerHTML = backupsHtml(state, backups);
    // Retention picker → persist over the existing setSetting channel (numeric cast), then reload.
    const sel = host.querySelector('select.set-field[data-key="backupRetention"]');
    if (sel) {
      sel.addEventListener('change', () => void persist('backupRetention', Number(sel.value)));
    }
    // §20 R05 / §12 R13: a Restore is destructive (it swaps the live database), so it never acts
    // on a single stray click — it goes through app.js's generic confirmInline gate. The first
    // click only ARMS the confirm; ONLY the explicit confirm calls window.stint.restoreBackup.
    for (const btn of host.querySelectorAll('.backup-restore')) {
      btn.addEventListener('click', () => {
        const name = btn.dataset.name;
        const gate = window.confirmInline;
        if (typeof gate !== 'function') return;
        gate(btn, {
          kind: 'restore',
          question: `Restore from ${name}?`,
          confirmLabel: 'Restore',
          onConfirm: async () => {
            await window.stint.restoreBackup({ name });
            // A restore swaps the whole database — re-read so the panel + status reflect it.
            await render();
          },
        });
      });
    }
  }

  // A release link must open in the default browser, never navigate the app window.
  function wireUpdateLinks(host) {
    for (const a of host.querySelectorAll('a[data-update-link]')) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }

  // §19 R04 — subscribe to live download/guided-install progress (same shape as onChange). Each
  // frame repaints the Software Update group so the progress bar + numbered steps stay live.
  if (window.stint && window.stint.update && window.stint.update.onUpdateProgress) {
    window.stint.update.onUpdateProgress((p) => {
      lastUpdateProgress = p;
      void renderSoftwareUpdate(undefined);
    });
  }

  function wire(host) {
    // Selects (rounding increment, check-ins, date format, around-now span) — cast numeric values.
    for (const sel of host.querySelectorAll('select.set-field')) {
      sel.addEventListener('change', () => {
        const raw = sel.value;
        const value = sel.dataset.cast === 'number' ? Number(raw) : raw;
        void persist(sel.dataset.key, value);
      });
    }
    // §14 — the working-hours HH:MM pair persists each field on change; core validates the
    // shape + the start<end pair, and a rejection re-renders so the field reverts to the
    // stored truth (persist swallows the rejection and repaints either way).
    for (const inp of host.querySelectorAll('input.set-hhmm')) {
      inp.addEventListener('change', () => {
        void persist(inp.dataset.key, inp.value.trim());
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
        // The field captures a chord by swallowing the key — so the traversal keys need an
        // explicit hatch BEFORE the swallow, or focus can enter and never leave by keyboard
        // (WCAG 2.2 §2.1.2 no keyboard trap; design.html A04). Issue 135: preventDefault ran
        // first with no hatch, which stranded every control after this one in DOM order.
        //   Tab / Shift-Tab — pass through uncaptured so the browser moves focus on. A chord
        //     on Tab is unbindable here as a result; the escape hatch outranks it.
        //   Escape — cancels the innermost thing (craft checklist §4), which for a capture
        //     field is the capture itself: release focus and bind nothing.
        if (ev.key === 'Tab') return;
        if (ev.key === 'Escape') {
          el.blur();
          return;
        }
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
    dateFormatMode = settings.dateFormat === 'iso' ? 'iso' : 'system';
    applyDateFormat(dateFormatMode);
    // §04 R06 / §14: the configured zone drives every SU display/parse/geometry helper.
    applyTimeZone(settings.timeZone || 'system');
    host.innerHTML = panelHtml(settings);
    wire(host);
    // §19 R03 — the Software Update group renders into its own host element (after the
    // settings panel), reading the version over the GUI-only window.stint.update bridge and
    // wiring the Check-now action. The snapshot appVersion is the fallback when the bridge
    // is unavailable (e.g. a renderer harness without preload).
    void renderSoftwareUpdate(state && state.appVersion);
    // §20 R04/R05 — the Backups group + recovery banner render into their own host (after the
    // Software Update group), off the SAME snapshot: the restore list / "Last backup" status /
    // retention picker (R04) and the one-shot corruption-recovery notice (R05).
    void renderBackups(state);
  }

  // The Settings nav-item routes via app.js (which only toggles the section hidden); render
  // the panel here whenever it is chosen so the controls reflect current state.
  const navItem = document.querySelector('.nav-item[data-view="settings"]');
  if (navItem) navItem.addEventListener('click', () => void render());

  // Re-read on every external change (a tt write may have changed a setting) so the panel +
  // the date-format mode stay current. Also render once on startup so the mode is applied
  // from first paint even before the Settings view is opened.
  if (window.stint && window.stint.onChange) {
    window.stint.onChange(() => {
      // Only re-fetch when the Settings view is the visible one (cheap-guard).
      const section = document.querySelector('.view[data-view="settings"]');
      if (section && !section.hidden) void render();
    });
  }
  void render();
})();
