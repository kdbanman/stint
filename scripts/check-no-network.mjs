#!/usr/bin/env node
/**
 * No-network GOLD backstop (acceptance.html §10, §11; PRD §17 R9).
 *
 * The live-traffic guarantee is confirmed manually under a network monitor, but a
 * cheap static check runs in CI: scan all shipped source for any networking import
 * or outbound-request API, assert production dependencies stay within a minimal
 * allowlist, and pin the app's one sanctioned outbound path — Electron's built-in
 * `net`, reachable from a single allowed file — so a second `net.request` site cannot
 * ride the allowed `electron` dependency unseen. A regression is caught fast even
 * though the live confirmation is manual.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Module specifiers that imply networking.
const FORBIDDEN_MODULES = [
  'node:http',
  'node:https',
  'node:http2',
  'node:net',
  'node:dgram',
  'node:tls',
  'node:dns',
  'http',
  'https',
  'http2',
  'net',
  'dgram',
  'tls',
  'dns',
  'axios',
  'node-fetch',
  'undici',
  'got',
  'ws',
  'socket.io',
  'socket.io-client',
  'request',
];

// Outbound-request APIs (used as whole-word tokens).
const FORBIDDEN_TOKENS = ['XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator.sendBeacon'];

// The only production dependencies Stint is allowed to ship.
//
// §19 R03 note: the in-app update check (packages/gui/src/update.ts) makes the app's ONE
// outbound request — an explicit, user-initiated GET to the GitHub Releases API. It does so
// through Electron's built-in `net` (`import { net } from 'electron'`), an already-allowed
// prod dep, NOT node:https / node:net / global fetch. That import names 'electron' (not 'net'
// / 'node:https'), so it does not match the FORBIDDEN_MODULES specifiers above, and `net.request`
// is not a FORBIDDEN_TOKEN. `electron` being allowed is exactly why the module/token scan cannot
// see a NEW outbound site — the ELECTRON_NET pin below is what catches one.
const ALLOWED_PROD_DEPS = new Set(['@stint/core', 'commander', 'electron']);

// The one shipped file allowed to reach Electron's built-in `net` — the user-initiated update
// check (§17 R09 / §19 R03), the app's sole outbound request. Pinned by FILE, not line: any OTHER
// shipped file that imports electron's `net` or calls `net.request` fails the scan, so a second
// outbound site cannot ride the allowed `electron` dependency past the module/token scan above.
// update.ts itself stays unrestricted — a one-file allowlist, robust to line edits inside it.
const ELECTRON_NET_ALLOWED = new Set([join(ROOT, 'packages', 'gui', 'src', 'update.ts')]);

/**
 * Whether a file's text reaches Electron's built-in `net`: a named `net` import from 'electron'
 * (`import { app, net } from 'electron'`, in any binding order, allowing `net as x` and `type`
 * imports), or a `net.request(` call wherever `net` was bound. Both are the outbound-request
 * surface the allowed `electron` dependency hides from FORBIDDEN_MODULES / FORBIDDEN_TOKENS.
 */
export function usesElectronNet(text) {
  for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]electron['"]/g)) {
    const bound = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim());
    if (bound.includes('net')) return true;
  }
  return /\bnet\.request\b/.test(text);
}

/** Shipped files that reach Electron's `net` — must equal ELECTRON_NET_ALLOWED (§17 R09). */
export function electronNetSites() {
  return shippedSourceFiles().filter((f) => usesElectronNet(readFileSync(f, 'utf8')));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|js|mjs|cjs|html)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const isDir = (d) => {
  try {
    return statSync(d).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Every directory of shipped code the backstop scans: each package's `src`, plus the
 * Electron renderer (`packages/gui/renderer`, `.js`), which ships outside `src` and is
 * just as capable of opening a connection (fetch / WebSocket / EventSource) from the
 * page. All must stay network-silent (PRD §17 R9).
 */
export function shippedSourceDirs() {
  const srcDirs = readdirSync(join(ROOT, 'packages'))
    .map((p) => join(ROOT, 'packages', p, 'src'))
    .filter(isDir);
  const rendererDir = join(ROOT, 'packages', 'gui', 'renderer');
  if (isDir(rendererDir)) srcDirs.push(rendererDir);
  return srcDirs;
}

/** The concrete list of files the scan reads — exported so coverage is verifiable. */
export function shippedSourceFiles() {
  return shippedSourceDirs().flatMap((d) => walk(d));
}

export function scanNoNetwork() {
  const violations = [];

  // 1. Source scan of all shipped code.
  for (const dir of shippedSourceDirs()) {
    for (const file of walk(dir)) {
      const text = readFileSync(file, 'utf8');
      for (const mod of FORBIDDEN_MODULES) {
        const re = new RegExp(`(?:import|require|from)\\s*\\(?['"]${mod.replace('/', '\\/')}['"]`);
        if (re.test(text)) {
          violations.push(`${file}: imports forbidden module "${mod}"`);
        }
      }
      for (const tok of FORBIDDEN_TOKENS) {
        if (new RegExp(`\\b${tok.replace('.', '\\.')}\\b`).test(text)) {
          violations.push(`${file}: uses forbidden API "${tok}"`);
        }
      }
      // Bare global fetch( call (not a comment mention).
      if (/(?<![\w.])fetch\s*\(/.test(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) {
        violations.push(`${file}: calls global fetch()`);
      }
      // Electron `net` file-level pin (§17 R09): `electron` is an allowed prod dep, so a new
      // `net.request` site is invisible to the module/token scan above — only update.ts may reach
      // it. Any OTHER file importing electron's `net` or calling `net.request` fails here.
      if (usesElectronNet(text) && !ELECTRON_NET_ALLOWED.has(file)) {
        violations.push(
          `${file}: reaches Electron's built-in net outside the single allowed update-check site (packages/gui/src/update.ts)`,
        );
      }
    }
  }

  // 2. Production-dependency allowlist.
  const pkgDirs = readdirSync(join(ROOT, 'packages')).map((p) => join(ROOT, 'packages', p));
  for (const pkgDir of pkgDirs) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!ALLOWED_PROD_DEPS.has(dep)) {
        violations.push(`${pkgDir}/package.json: unexpected production dependency "${dep}"`);
      }
    }
  }

  return violations;
}

// Run as a CLI when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = scanNoNetwork();
  if (violations.length > 0) {
    console.error('no-network check FAILED:');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log('no-network check passed: no networking imports, APIs, or unexpected prod deps.');
}
