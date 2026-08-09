/**
 * Static guards for the renderer — ONLY the contracts that static inspection alone can
 * prove (issue #85). Everything behavioral — what the rendered page does when driven —
 * lives in the JUDGE harness (packages/gui/judge/run-judge.mjs), whose scenes are bound
 * one-to-one to acceptance/criteria/judge-rubric.md rows by judge-bind.test.ts.
 *
 * The line: a guard belongs here only if the defect it catches is invisible to a driven
 * page. Banned APIs that headless Chromium happily implements but packaged Electron does
 * not (window.prompt/confirm), banned glyph classes, module-isolation rules, and
 * structural invariants (duplicate ids, a shared helper defined twice) qualify. Assertions about renderer BEHAVIOR do
 * not — a source regex breaks on a rename and passes on a bug, so those were retired to
 * the judge's scenes (issue #85), not maintained here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../renderer/${rel}`, import.meta.url)), 'utf8');

describe('renderer static contract', () => {
  it('the nav rail labels each item with a line-icon from the one sprite — never an emoji (design-system)', () => {
    const html = read('index.html');
    // Each nav item carries the line-icon convention: an <svg class="ic"> pulling a #i-… symbol
    // from the single sprite, paired with its .nav-label. The five items map to the five view
    // icons (clock / list / users / chart / settings) in the Timer→Settings order.
    const navIcons = [...html.matchAll(/class="nav-item[^"]*"\s+data-view="[^"]+"[^>]*>\s*<svg class="ic"[^>]*><use href="(#i-[^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(navIcons).toEqual(['#i-clock', '#i-list', '#i-users', '#i-chart', '#i-settings']);
    // …and the shell carries NO emoji glyph anywhere (the restyle replaces every emoji/symbol
    // pictograph with the line-icon sprite). Scan the whole document for any pictographic glyph
    // (the prior nav used ◷ ▤ ◎ ▥ ⚙, the pickers ▦, the chevrons ▲▼) — none may remain. The
    // ranges cover Miscellaneous Technical, Geometric Shapes, Misc Symbols/Dingbats, the
    // supplemental arrows/shapes, and emoji — but spare the em-dash, ellipsis and § still in use.
    expect(html).not.toMatch(
      /[⌀-⏿■-◿☀-➿⬀-⯿←-⇿\u{1F000}-\u{1FAFF}]/u,
    );
    // The popover is the shell's second document and draws from the same sprite, so the ban
    // covers it too — this is the one home for the banned-glyph rule (tray.test.ts carried a
    // narrower copy over the popover source until issue #175 moved it here).
    expect(read('popover.html')).not.toMatch(
      /[⌀-⏿■-◿☀-➿⬀-⯿←-⇿\u{1F000}-\u{1FAFF}]/u,
    );
    expect(read('popover.js')).not.toMatch(
      /[⌀-⏿■-◿☀-➿⬀-⯿←-⇿\u{1F000}-\u{1FAFF}]/u,
    );
  });

  it('every element id in index.html is unique — a duplicate dead-ends getElementById wiring (issue #48)', () => {
    // The literal issue-48 root cause: the Clients-view "+ Add client" button and the
    // Add-entry form's Client <select> both carried id="add-client", so $('add-client')
    // (getElementById → FIRST match in document order) bound the click handler to the
    // select — the button was a no-op AND opening the dropdown injected a phantom
    // .client-add row. Guard the invariant wholesale: no id may appear twice in the page.
    // (The driven half — the button actually creating a client — is the CLIENTS_VIEW
    // judge scene, which exists because presence-only checks passed right through #48.)
    const html = read('index.html');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    expect(dupes, `duplicate element ids in index.html: ${dupes.join(', ')}`).toEqual([]);
  });

  it('every view marks exactly one standing primary, and one observer-backed rule reads that marker (design.html D11, issue 150)', () => {
    // The structural half of the accent handoff. The runtime OUTCOME — exactly one accent-solid
    // fill in each state — is the PRIMARY_HANDOFF judge scene's job; what it cannot see is a view
    // whose primary is never marked (so the handoff silently skips it) or a marker nobody reads,
    // both of which pass every driven scene until someone thinks to drive the new state. Those are
    // decidable from the markup alone, and this is where they are decided.
    // Comments out: the markup's own explanation of the marker names it, and a prose mention is
    // not a marked control.
    const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
    // A view section is a `<section>` whose class list STARTS with `view` (`view clients`,
    // `view reports-view`); its attribute order varies, and the timer view nests plain
    // `<section>`s of its own, so the split is on the opening tag rather than a closing one.
    const views = html.split(/<section\b(?=[^>]*\bclass="view\b)/).slice(1);
    expect(views.length, 'index.html view sections').toBe(5);
    const perView = views.map((v) => ({
      view: /data-view="([^"]+)"/.exec(v)?.[1] ?? '(unnamed)',
      marks: [...v.matchAll(/data-standing-primary/g)].length,
      marked: [...v.matchAll(/<button[^>]*data-standing-primary[^>]*>/g)].map((m) => m[0]),
    }));
    // Every view with a most-likely action names it. The Timer view names TWO — Start and Stop,
    // the idle and running faces of one standing action, only ever one of them on screen (§12 R05)
    // — so this is "at least one", not "exactly one"; that no two are LIT at once is the judge's
    // per-state count. Settings names none: its only primary, the update download, exists solely
    // while an update waits.
    expect(perView.filter((v) => v.marks === 0).map((v) => v.view)).toEqual(['settings']);
    for (const v of perView) {
      // A marker must sit on a `.primary` button: it is the handoff's target, and marking anything
      // else opts a control into a handoff for an accent it never carried.
      for (const btn of v.marked) {
        expect(btn, `${v.view}: standing primary is not a .primary button`).toMatch(/class="[^"]*\bprimary\b/);
      }
      expect(v.marked.length, `${v.view}: data-standing-primary on a non-button`).toBe(v.marks);
    }
    // …and exactly one place still consumes the marker, watching the DOM for it. Deleting either
    // half leaves every marker inert and every form-open state back at two accent fills, which no
    // driven scene would notice for a form nobody thought to open.
    const app = read('app.js');
    expect(app).toMatch(/function syncStandingPrimary\(\)/);
    expect(app).toMatch(/new MutationObserver\(syncStandingPrimary\)/);
    expect(
      [...app.matchAll(/querySelectorAll\('\[data-standing-primary\]'\)/g)].length,
      'the marker is read in exactly one place',
    ).toBe(1);
  });

  it('the renderer never imports Node or touches the DB directly (parity via IPC)', () => {
    // The CLASSIC scripts can reach neither Node nor core. The bundled SU entry (su.ts) is
    // the one sanctioned core importer — its output staying node-free is asserted
    // behaviorally by renderer-bundle.test.ts, not text-pinned here (issue #83).
    for (const f of ['app.js', 'timepicker.js', 'popover.js', 'reports.js', 'settings.js']) {
      const src = read(f);
      expect(src).not.toMatch(/require\(['"]node:/);
      expect(src).not.toMatch(/@stint\/core/);
    }
    // The interval picker is a pure presentation component: it writes localInputValue strings
    // back into its bound inputs and NEVER reaches the IPC bridge itself (no new channel can
    // sneak in through it — the add/edit forms own every commit).
    expect(read('timepicker.js')).not.toMatch(/window\.stint\./);
  });

  it('the renderer opens no outbound connection (§17 R9)', () => {
    // The renderer is shipped UI code that could reach the network straight from the
    // page; assert it uses none of the browser request APIs. (The no-network backstop
    // now also walks this directory; this keeps the guard close to the renderer.)
    const forbidden = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bEventSource\b/, /sendBeacon/];
    for (const f of ['app.js', 'timepicker.js', 'popover.js', 'su.ts', 'reports.js', 'settings.js']) {
      const src = read(f);
      for (const re of forbidden) expect(src, `${f} must not use ${re}`).not.toMatch(re);
    }
  });

  it('su.ts is the ONLY home for a shared renderer helper — no second definition anywhere (issue #168)', () => {
    // A duplicated helper is invisible to a driven page: both copies render, and the page looks
    // right until the two DIVERGE. They had. `escapeHtml` existed twice escaping DIFFERENT
    // character sets (app.js spared the single quote across 20 call sites, reports.js did not)
    // and popover.js escaped nothing; `errMessage` was re-typed at four sites, one of which
    // dropped the `.message` unwrap and rendered `[object Object]`. popover.html is a SEPARATE
    // document and can reach nothing app.js defines, so su.ts is the only home that serves
    // every page — this binds that, since these had already been re-typed twice.
    const shared = ['escapeHtml', 'errMessage', 'localMinuteOfDay', 'exactMinuteOfDay'];
    const su = read('su.ts');
    const defines = (src: string, name: string) =>
      // A DEFINITION (`function f(`, `const f =`), never a `const { f } = window.SU` import.
      new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=)`).test(src);
    for (const name of shared) {
      expect(defines(su, name), `su.ts must define ${name} — it is the declared home`).toBe(true);
      for (const f of ['app.js', 'timepicker.js', 'popover.js', 'reports.js', 'settings.js']) {
        expect(defines(read(f), name), `${f} must consume window.SU.${name}, not redefine it`).toBe(false);
      }
    }
  });

  it('local minutes-of-day is derived in exactly one place (issue #168)', () => {
    // The expression `getHours() * 60 + getMinutes()` positions every timeline surface — the
    // picker's seeds, the entries calendar's event geometry, SU.timelineWindow's own math. It
    // was written four times. A timezone or DST fix must have ONE site to find, so count the
    // arithmetic itself across the renderer rather than trusting the helper's name.
    const dir = fileURLToPath(new URL('../renderer/', import.meta.url));
    const files = readdirSync(dir).filter((f) => /\.(js|ts)$/.test(f));
    const sites = files.flatMap((f) =>
      [...read(f).matchAll(/getHours\(\)\s*\*\s*60/g)].map(() => f),
    );
    expect(sites, 'minutes-of-day must be derived only by su.ts localMinuteOfDay').toEqual(['su.ts']);
  });

  it('every display-setting hideable block carries a [hidden] companion — hidden must actually hide (issue #262)', () => {
    // The literal issue-262 root cause: `.report-export { display: flex }` is an AUTHOR rule,
    // and author rules beat the UA stylesheet's `[hidden] { display: none }` regardless of
    // specificity — so both Reports-view export rows rendered while their markup said hidden,
    // and the filtered row's buttons sat on screen as silent no-ops before any run (§12 R21's
    // forbidden dead click). Every other hideable block in styles.css carried a
    // `.cls[hidden] { display: none }` companion; this one didn't, and nothing checked.
    // A driven scene cannot catch the class (each scene probes the states someone thought to
    // drive), so the CLASS is decided statically here: for every element the renderer can
    // hide — a `hidden` attribute in the markup, or an `$('id').hidden =` toggle in the
    // scripts — each of its classes whose CSS sets a non-none `display` must also have a
    // `[hidden] { display: none }` companion (or ride a tag-level one like `button[hidden]`).
    const cssDir = fileURLToPath(new URL('../renderer/', import.meta.url));
    const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const displaySetters = new Set<string>();
    const classCompanions = new Set<string>();
    const tagCompanions = new Set<string>();
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const display = /(?:^|;)\s*display\s*:\s*([a-z-]+)/.exec(rule[2]!);
      if (!display) continue;
      for (const sel of rule[1]!.split(',')) {
        // The selector's SUBJECT (last compound) is the element the display lands on.
        const subject = sel.trim().split(/[\s>+~]+/).pop() ?? '';
        if (display[1] === 'none') {
          const cls = /^\.([A-Za-z0-9_-]+)\[hidden\]$/.exec(subject);
          if (cls) classCompanions.add(cls[1]!);
          const tag = /^([a-z0-9]+)\[hidden\]$/.exec(subject);
          if (tag) tagCompanions.add(tag[1]!);
        } else if (!sel.includes('[hidden]')) {
          const cls = /^\.([A-Za-z0-9_-]+)$/.exec(subject);
          if (cls) displaySetters.add(cls[1]!);
        }
      }
    }
    expect(displaySetters.size, 'the CSS parse sees display-setting classes').toBeGreaterThan(0);
    expect(classCompanions.size, 'the CSS parse sees [hidden] companions').toBeGreaterThan(0);

    // Hideable elements: carried `hidden` in the markup of either document…
    const hideables: { where: string; tag: string; classes: string[] }[] = [];
    for (const f of ['index.html', 'popover.html']) {
      const html = read(f).replace(/<!--[\s\S]*?-->/g, '');
      for (const el of html.matchAll(/<([a-z0-9]+)((?:\s+[^<>]*?)?)>/gi)) {
        const attrs = el[2] ?? '';
        if (!/(^|\s)hidden(=|\s|$)/.test(attrs)) continue;
        const classes = /class="([^"]*)"/.exec(attrs)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
        hideables.push({ where: `${f} <${el[1]!.toLowerCase()}>`, tag: el[1]!.toLowerCase(), classes });
      }
    }
    // …or toggled hidden by id in any renderer script (variable-held toggles are out of a
    // static regex's reach; their elements overwhelmingly also start hidden in the markup).
    const jsIds = new Set<string>();
    for (const f of readdirSync(cssDir).filter((f) => f.endsWith('.js'))) {
      for (const m of read(f).matchAll(/\$\('([^']+)'\)\.hidden\s*=/g)) jsIds.add(m[1]!);
    }
    for (const id of jsIds) {
      for (const f of ['index.html', 'popover.html']) {
        const el = new RegExp(`<([a-z0-9]+)\\s+[^<>]*id="${id}"[^<>]*>`, 'i').exec(read(f));
        if (!el) continue;
        const classes = /class="([^"]*)"/.exec(el[0])?.[1]?.split(/\s+/).filter(Boolean) ?? [];
        hideables.push({ where: `${f} #${id}`, tag: el[1]!.toLowerCase(), classes });
      }
    }
    expect(hideables.length, 'the markup scan sees hideable elements').toBeGreaterThan(0);

    const uncovered = hideables.flatMap((el) =>
      el.classes
        .filter((c) => displaySetters.has(c) && !classCompanions.has(c) && !tagCompanions.has(el.tag))
        .map((c) => `${el.where} class .${c}`),
    );
    expect(
      uncovered,
      'display-setting classes on hideable elements without a `[hidden] { display: none }` companion',
    ).toEqual([]);
  });

  it('the renderer never calls window.prompt or window.confirm — Electron implements neither (issue #52)', () => {
    // Electron's renderer does not implement window.prompt — it returns null and logs
    // "prompt() is and will not be supported." — and window.confirm is unavailable/blocking
    // here (the constraint app.js's confirmInline note records), so either call silently
    // no-ops in the packaged app. Every name/confirm affordance must be an INLINE control
    // (inlineRenameForm, confirmInline, the add-client/tag fields). The JUDGE's headless
    // Chromium DOES implement both built-ins, so a driven page cannot catch this — it is
    // exactly the class of defect only static inspection sees. Walk EVERY file under
    // renderer/ so no call site — present or future — can reintroduce the pattern.
    const dir = fileURLToPath(new URL('../renderer/', import.meta.url));
    const files = readdirSync(dir).filter((f) => /\.(js|html)$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = read(f);
      expect(src, `${f} must not call window.prompt`).not.toMatch(/window\s*\.\s*prompt\s*\(/);
      expect(src, `${f} must not call window.confirm`).not.toMatch(/window\s*\.\s*confirm\s*\(/);
      // The bare globals reach the same unsupported built-ins (confirmInline etc. don't match:
      // the pattern requires the exact name immediately followed by an open paren).
      expect(src, `${f} must not call the bare prompt()`).not.toMatch(/(?<![.\w$])prompt\(/);
      expect(src, `${f} must not call the bare confirm()`).not.toMatch(/(?<![.\w$])confirm\(/);
    }
  });
});
