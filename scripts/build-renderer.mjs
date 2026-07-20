/**
 * Bundle the renderer's typed `window.SU` entry (packages/gui/renderer/su.ts) into the
 * classic script the renderer pages load (packages/gui/renderer/dist/su.js).
 *
 * IIFE output: a plain non-module script, so it loads over `file://` in the packaged app
 * under the pages' CSP (`script-src 'self'` permits any local built script — the tooling
 * decision is recorded in context/architecture.html, issue #83). Bundling is what lets the
 * renderer IMPORT core's display rules (formatDuration, formatHours) and the gui-main pure
 * modules (liveview, tags, timerview) instead of hand-mirroring them.
 *
 * `@stint/core` is aliased to the core TypeScript source — the same alias vitest.config.ts
 * uses — so the bundle needs no prior tsc emit and always reflects the current source.
 * Core's package.json declares `"sideEffects": false`, which lets esbuild tree-shake the
 * Node-touching modules (db, store, backup) out of this browser bundle entirely; the
 * renderer-bundle GOLD test asserts the output stays node-free and behaves exactly as core.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The one shipped bundle config — exported so the GOLD guard test builds the same thing. */
export const BUNDLE_OPTIONS = {
  entryPoints: [join(ROOT, 'packages', 'gui', 'renderer', 'su.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  alias: { '@stint/core': join(ROOT, 'packages', 'core', 'src', 'index.ts') },
  // Core's barrel re-exports Node-touching modules (db, store, backup, paths). They are
  // unreachable from the SU entry and tree-shaken away (core is sideEffects:false), but
  // esbuild still RESOLVES the whole graph first, so the node: builtins must be declared
  // external to parse. None may survive into the OUTPUT — the GOLD guard test fails the
  // build the moment an SU import drags a node-touching module into the bundle.
  external: ['node:*'],
  legalComments: 'none',
  outfile: join(ROOT, 'packages', 'gui', 'renderer', 'dist', 'su.js'),
};

/** Build the bundle; pass write:false for an in-memory build (the guard test's mode). */
export async function buildRendererBundle({ write = true } = {}) {
  return build({ ...BUNDLE_OPTIONS, write });
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  await buildRendererBundle();
  console.log('renderer bundle written: packages/gui/renderer/dist/su.js');
}
