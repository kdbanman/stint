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
  function localTime(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function friendlyHotkey(accel) {
    return accel.replace('CommandOrControl', 'Ctrl').replace('Command', 'Cmd');
  }
  // Apply the system accent ONLY to the --accent variable (PRD §15).
  function applyAccent(accent) {
    if (accent) document.documentElement.style.setProperty('--accent', accent);
  }
  return { fmtDur, fmtHours, elapsed, localTime, friendlyHotkey, applyAccent };
})();
