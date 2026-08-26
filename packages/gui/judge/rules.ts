/**
 * The JUDGE harness's in-page core rules — `window.__CORE__` (issue #358).
 *
 * The injected window.stint mock (fixtures.mjs initScript) stands in for the Electron
 * TRANSPORT only — no main process exists in the judge's page — but its listEntries /
 * search handlers used to re-spell the rules inside that transport: matchesQuery,
 * groupEntries, and resolveRange each had a hand copy that drifted the moment core moved
 * (issue #84's clientName/projectName never reached the fixture's search). This entry is
 * the su.ts → dist/su.js road for the apparatus: esbuild bundles core's REAL exports
 * (scripts/build-renderer.mjs JUDGE_RULES_OPTIONS → judge/dist/rules.js, an IIFE the
 * initScript prepends), so the rules inside the mock are imports and cannot drift again.
 * All three are pure and node-free; the bundle tree-shakes core's node-touching modules
 * away exactly as the SU bundle does.
 */
import { groupEntries, matchesQuery, resolveRange } from '@stint/core';

declare global {
  interface Window {
    __CORE__: {
      groupEntries: typeof groupEntries;
      matchesQuery: typeof matchesQuery;
      resolveRange: typeof resolveRange;
    };
  }
}

window.__CORE__ = { groupEntries, matchesQuery, resolveRange };
