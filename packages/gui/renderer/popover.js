// Popover renderer (PRD §12 R1) — the running timer, counting up; one click to
// stop, switch (§05 R8), or start; opens the main window.
// Classic script: helpers come from window.SU (util.js, loaded first).
const { fmtDur, elapsed, applyAccent } = window.SU;

const $ = (id) => document.getElementById(id);
let state = null;

async function load() {
  state = await window.stint.getState();
  applyAccent(state.accent);
  render();
}

function render() {
  const running = state.status.running ? state.status.entry : null;
  const pop = $('pop');
  pop.classList.toggle('running', !!running);
  pop.classList.toggle('idle', !running);
  $('state').textContent = running ? 'running' : 'idle';
  const toggle = $('toggle');
  toggle.textContent = running ? 'Stop' : 'Start';
  // §12 R14: announce the toggle's running/idle state to the accessibility tree.
  toggle.setAttribute('aria-pressed', String(!!running));
  toggle.setAttribute('aria-label', running ? 'Stop timer' : 'Start timer');
  // §05 R8: Switch only makes sense mid-timer, so it shows while running.
  $('switch').hidden = !running;
  if (running) {
    $('count').textContent = fmtDur(elapsed(running.startUtc, 0));
    const where = running.clientLabel ? ` <span class="where">${running.clientLabel}</span>` : '';
    $('ctx').innerHTML = `${running.description ?? 'your timer'}${where}`;
  } else {
    $('count').textContent = '00:00:00';
    $('ctx').textContent = 'nothing running';
  }
}

function tick() {
  if (state?.status.running) {
    $('count').textContent = fmtDur(elapsed(state.status.entry.startUtc, 0));
  }
}

$('toggle').addEventListener('click', async () => {
  await window.stint.toggle();
  await load();
});
// §05 R8: Switch reuses the `start` IPC (store.start = atomic stop+start).
$('switch').addEventListener('click', async () => {
  await window.stint.start({});
  await load();
});
$('open').addEventListener('click', () => window.stint.openMain && window.stint.openMain());

window.stint.onChange(() => load());
setInterval(tick, 1000);
load();
