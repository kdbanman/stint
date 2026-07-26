/**
 * The suite's movable-clock fixture — engineering.html §05 names `mutableClock` as *the*
 * time seam ("Time is already a seam … use it; never sleep"), so it lives where every test
 * file can reach it rather than being re-declared per file. Three copies had grown before
 * this (issue #172): `mutableClock` in prop/invariants.test.ts and a `settableClock` each in
 * prop/appstate.test.ts and prop/monotonic.test.ts, differing only in whether they moved
 * "now" by a delta or repointed it outright. Both moves are here, so neither call site
 * needs its own.
 *
 * Not a `.test.ts` file, so vitest's `include` never collects it (the same arrangement as
 * bdd/world.ts and bdd/steps.ts).
 */
import type { Clock } from '@stint/core';

/** A `Clock` whose "now" the test moves, plus the two ways to move it. */
export interface MutableClock {
  /** The clock to hand `Store.open`/`Store.openMemory`. */
  clock: Clock;
  /** Move "now" by a delta — forward, or backward with a negative `ms`. */
  advance: (ms: number) => void;
  /** Repoint "now" at an absolute epoch-ms instant. */
  set: (ms: number) => void;
}

/** A clock starting at `startMs` (epoch ms) that the test advances or repoints at will. */
export function mutableClock(startMs: number): MutableClock {
  let nowMs = startMs;
  return {
    clock: () => new Date(nowMs),
    advance: (ms) => {
      nowMs += ms;
    },
    set: (ms) => {
      nowMs = ms;
    },
  };
}
