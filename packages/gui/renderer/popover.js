// Popover renderer (PRD §12 R1) — the running timer, counting up; one click to
// stop, switch (§05 R8), or start; opens the main window.
// Classic script: helpers come from window.SU (util.js, loaded first).
const { fmtDur, elapsed, applyAccent, icon, injectSprite, localTime } = window.SU;

const $ = (id) => document.getElementById(id);
let state = null;

injectSprite(document);

// The action buttons carry the single line-icon family (no emoji): Stop / Switch / arrow.
$('switch').innerHTML = icon('swap') + 'Switch';
$('open').innerHTML = 'Open Stint' + icon('arrow');

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
  // The state line pairs a run dot with a word (inclusivity — colour is never the only signal).
  $('state').innerHTML = running
    ? '<span class="pop-dot"></span> Running · since ' + localTime(running.startUtc)
    : '<span class="pop-dot"></span> Idle';
  const toggle = $('toggle');
  toggle.innerHTML = (running ? icon('stop') : icon('play')) + (running ? 'Stop' : 'Start');
  // §12 R14: announce the toggle's running/idle state to the accessibility tree.
  toggle.setAttribute('aria-pressed', String(!!running));
  toggle.setAttribute('aria-label', running ? 'Stop timer' : 'Start timer');
  // §05 R8: Switch only makes sense mid-timer, so it shows while running.
  $('switch').hidden = !running;
  const desc = $('desc');
  const ctx = $('ctx');
  const tags = $('tags');
  if (running) {
    $('count').textContent = fmtDur(elapsed(running.startUtc, 0));
    // The strong description label sits under the clock; client/project is the muted context line.
    desc.textContent = running.description ?? 'your timer';
    desc.hidden = false;
    ctx.textContent = running.clientLabel ?? '';
    ctx.hidden = !running.clientLabel;
    // §07: the running entry's tags as quiet chips under the description.
    const list = running.tags ?? [];
    tags.innerHTML = list.map((t) => `<span class="tag">${t}</span>`).join('');
    tags.hidden = list.length === 0;
  } else {
    $('count').textContent = '00:00:00';
    desc.hidden = true;
    desc.textContent = '';
    ctx.textContent = 'nothing running';
    ctx.hidden = false;
    tags.hidden = true;
    tags.innerHTML = '';
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
