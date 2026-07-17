/**
 * cine.mjs — cinematic overlay + helpers for QA GIFs.
 *
 * Pairs with a Playwright-driven QA harness (a page running the app). It injects a
 * fake cursor that follows real Playwright mouse moves, a click ripple, and terse
 * on-screen toasts — so a recorded GIF actually shows what the user is doing and why.
 *
 * Reusable: `installOverlay(page)` before `page.goto(...)`, then `makeCine(page)` to
 * get {move, click, toast, type, moveXY, wait, hover}. See SKILL.md for the recipe
 * template + the ffmpeg GIF conversion.
 *
 * The overlay is passed to Playwright's addInitScript AS A FUNCTION (no string
 * escaping) and runs in page context. It is self-contained — it references no outer
 * scope. Uses the app's clay accent (#e07a5f) for the ripple so annotations feel native.
 */
export function overlayInit() {
  const boot = () => {
    if (document.getElementById('__qa_cursor')) return;
    const style = document.createElement('style');
    style.textContent = `
      #__qa_cursor{position:fixed;left:0;top:0;z-index:2147483647;width:24px;height:24px;
        margin:-2px 0 0 -2px;pointer-events:none;transition:transform .04s linear}
      #__qa_cursor.__down{transform-origin:3px 3px}
      #__qa_cursor svg{display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.55))}
      .__qa_ripple{position:fixed;z-index:2147483646;border-radius:50%;pointer-events:none;
        border:3px solid rgba(224,122,95,.95);width:10px;height:10px;margin:-5px 0 0 -5px;
        animation:__qa_rip .55s ease-out forwards}
      @keyframes __qa_rip{from{transform:scale(1);opacity:1}to{transform:scale(6);opacity:0}}
      #__qa_toasts{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);
        z-index:2147483647;display:flex;flex-direction:column;gap:8px;align-items:center;
        pointer-events:none;width:max-content;max-width:78vw}
      .__qa_toast{background:rgba(24,24,27,.93);color:#fff;
        font:600 15px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;
        padding:10px 16px;border-radius:11px;box-shadow:0 8px 28px rgba(0,0,0,.35);
        text-align:center;opacity:0;transform:translateY(10px);
        transition:opacity .22s ease,transform .22s ease}
      .__qa_toast.__show{opacity:1;transform:translateY(0)}
      .__qa_toast b{color:#f2b8a6}`;
    document.head.appendChild(style);

    const host = document.body || document.documentElement;
    const cur = document.createElement('div');
    cur.id = '__qa_cursor';
    cur.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24">' +
      '<path d="M3 2 L3 18 L7.5 13.8 L10.8 21 L13.6 19.8 L10.4 12.8 L17 12.6 Z" ' +
      'fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    const toasts = document.createElement('div');
    toasts.id = '__qa_toasts';
    host.appendChild(cur);
    host.appendChild(toasts);

    let x = Math.round(window.innerWidth / 2), y = Math.round(window.innerHeight / 2);
    const place = () => { cur.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
    place();
    window.addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; place(); }, true);
    window.addEventListener('mousedown', (e) => {
      cur.classList.add('__down');
      const r = document.createElement('div');
      r.className = '__qa_ripple';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      host.appendChild(r);
      setTimeout(() => r.remove(), 560);
    }, true);
    window.addEventListener('mouseup', () => cur.classList.remove('__down'), true);

    // Terse toast. `text` may contain <b>…</b> for emphasis. Auto-dismisses after ms.
    window.__qaToast = (text, ms) => {
      const t = document.createElement('div');
      t.className = '__qa_toast';
      t.innerHTML = text;
      toasts.appendChild(t);
      requestAnimationFrame(() => t.classList.add('__show'));
      setTimeout(() => { t.classList.remove('__show'); setTimeout(() => t.remove(), 260); }, ms || 1600);
      return null;
    };
    window.__qaCursorTo = (px, py) => { x = px; y = py; place(); };
    // Keep the overlay on top if the app mutates the DOM under it.
    const keepTop = () => { if (cur.parentNode !== host) { host.appendChild(cur); host.appendChild(toasts); } };
    new MutationObserver(keepTop).observe(host, { childList: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}

export function installOverlay(page) {
  return page.addInitScript(overlayInit);
}

async function targetXY(page, target) {
  if (Array.isArray(target)) return { x: Math.round(target[0]), y: Math.round(target[1]) };
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const b = await loc.boundingBox();
  if (!b) throw new Error('cine: no bounding box for ' + target);
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}

/**
 * Cinematic helpers bound to a page. Motion is deliberately unhurried so the GIF reads:
 *  - move(target)         smooth glide to an element/coords (draws the eye)
 *  - click(target)        glide, small pause, click (ripple fires), settle
 *  - hover(target)        glide + hover (for hover-reveal affordances)
 *  - type(sel, text)      focus + visible per-char typing
 *  - toast(text, ms)      terse caption at bottom-center (supports <b>…</b>)
 *  - wait(ms)             passthrough to page.waitForTimeout
 *  - moveXY(x, y)         glide to raw coords
 */
export function makeCine(page, opts = {}) {
  const steps = opts.steps ?? 26;
  const move = async (target) => {
    const { x, y } = await targetXY(page, target);
    await page.mouse.move(x, y, { steps });
    return { x, y };
  };
  const moveXY = async (x, y) => { await page.mouse.move(Math.round(x), Math.round(y), { steps }); };
  const click = async (target, { pre = 180, post = 260 } = {}) => {
    const { x, y } = await move(target);
    await page.waitForTimeout(pre);
    await page.mouse.click(x, y);
    await page.waitForTimeout(post);
  };
  const hover = async (target, { post = 260 } = {}) => {
    await move(target);
    await page.waitForTimeout(post);
  };
  const type = async (sel, text, { delay = 45 } = {}) => {
    await move(sel);
    await page.waitForTimeout(120);
    const loc = page.locator(sel).first();
    await loc.click();
    await loc.fill('');
    await loc.pressSequentially(text, { delay });
  };
  const toast = async (text, ms = 1700) => {
    await page.evaluate(([t, m]) => window.__qaToast && window.__qaToast(t, m), [text, ms]);
  };
  const wait = (ms) => page.waitForTimeout(ms);
  return { move, moveXY, click, hover, type, toast, wait };
}
