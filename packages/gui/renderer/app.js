// Main window renderer (PRD §12). Paints the same truth tt would show — entries
// grouped by day with flags in context, a one-tap subtract on slept entries, an
// instructing empty state, and a live count-up on the running entry.
// Classic script: helpers come from window.SU (util.js, loaded first).
const { fmtDur, fmtHours, elapsed, localTime, friendlyHotkey, applyAccent } = window.SU;

const $ = (id) => document.getElementById(id);
let state = null;

async function load() {
  state = await window.stint.getState();
  applyAccent(state.accent);
  render();
}

function render() {
  if (!state) return;
  const running = state.status.running ? state.status.entry : null;

  $('summary').innerHTML = running
    ? `▸ <b>running</b> ${fmtDur(elapsed(running.startUtc))} · ${escapeHtml(running.description ?? 'your timer')}`
    : '■ idle';

  const toggle = $('toggle');
  toggle.textContent = running ? 'Stop' : 'Start';
  toggle.classList.toggle('primary', true);

  $('week-total').textContent = fmtHours(weekTotal());

  const host = $('entries');
  host.innerHTML = '';
  if (state.days.length === 0) {
    host.appendChild(emptyState());
    return;
  }
  for (const day of state.days) {
    host.appendChild(dayBlock(day));
  }
}

function emptyState() {
  const hk = friendlyHotkey(state.settings.globalHotkey);
  const div = document.createElement('div');
  div.className = 'empty';
  div.innerHTML =
    `<div class="big">No entries yet</div>` +
    `<div>Press <code>${hk}</code> or run <code>tt start</code> to begin.</div>`;
  return div;
}

function dayBlock(day) {
  const wrap = document.createElement('section');
  wrap.className = 'day';
  const total = day.entries.reduce((s, e) => s + e.billableSeconds, 0);
  const head = document.createElement('div');
  head.className = 'day-head';
  head.innerHTML = `<span>${day.day}</span><span>${fmtHours(total)}</span>`;
  wrap.appendChild(head);
  for (const e of day.entries) wrap.appendChild(entryRow(e));
  return wrap;
}

function entryRow(e) {
  const row = document.createElement('div');
  row.className = 'entry' + (e.endUtc === null ? ' running' : '');
  row.dataset.id = String(e.id);

  const time = document.createElement('div');
  time.className = 'time';
  time.textContent = e.endUtc ? `${localTime(e.startUtc)}–${localTime(e.endUtc)}` : `${localTime(e.startUtc)}–now`;

  const desc = document.createElement('div');
  desc.className = 'desc' + (e.billable ? '' : ' nonbill');
  desc.innerHTML =
    `${escapeHtml(e.description ?? '(no description)')}` +
    (e.clientLabel ? `<span class="where">${escapeHtml(e.clientLabel)}</span>` : '') +
    flagsHtml(e) +
    actionsHtml(e);

  const dur = document.createElement('div');
  dur.className = 'dur';
  dur.textContent = e.endUtc ? fmtDur(e.billableSeconds) : fmtDur(elapsed(e.startUtc, e.excludedSeconds));

  row.append(time, desc, dur);
  wire(row, e);
  return row;
}

function flagsHtml(e) {
  const flags = [];
  if (e.overlapped) flags.push('<span class="flag" title="overlaps another entry">overlap</span>');
  if (e.sleptThrough) flags.push('<span class="flag" title="machine slept during this entry">slept</span>');
  return flags.length ? `<span class="flags">${flags.join('')}</span>` : '';
}

function actionsHtml(e) {
  const actions = [];
  if (e.sleptThrough) {
    const label = e.excludedSeconds > 0 ? 'Restore' : 'Subtract sleep';
    actions.push(`<button class="small" data-act="subtract">${label}</button>`);
  }
  actions.push('<button class="small ghost" data-act="delete">Delete</button>');
  return `<span class="actions">${actions.join('')}</span>`;
}

function wire(row, e) {
  row.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'subtract') await window.stint.subtractSleep({ id: e.id });
      else if (act === 'delete') await window.stint.remove({ id: e.id });
      await load();
    });
  });
}

function weekTotal() {
  // The renderer's at-a-glance figure; the report builder owns the authoritative one.
  return state.days
    .flatMap((d) => d.entries)
    .filter((e) => e.billable)
    .reduce((s, e) => s + e.billableSeconds, 0);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// Live count-up on the running entry (display tick, independent of data changes).
function tick() {
  if (!state?.status.running) return;
  const e = state.status.entry;
  $('summary').innerHTML = `▸ <b>running</b> ${fmtDur(elapsed(e.startUtc))} · ${escapeHtml(e.description ?? 'your timer')}`;
  const row = document.querySelector(`.entry.running .dur`);
  if (row) row.textContent = fmtDur(elapsed(e.startUtc, e.excludedSeconds));
}

$('toggle').addEventListener('click', async () => {
  await window.stint.toggle();
  await load();
});

window.stint.onChange(() => load());
setInterval(tick, 1000);
load();
