/**
 * PROP + scenarios — check-in cadence (PRD §10b, §17 R6; acceptance.html §10b → PROP).
 *
 * The schedule: first at start+60, then every 30; autonomous; fires once on
 * relaunch if it came due while closed; realigns from wake after a long sleep with
 * no backlog. All proven on the pure `evaluateCheckin` / `initCheckinState`.
 */
import { describe, it, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { initCheckinState, evaluateCheckin, nominalCheckins } from '@stint/core';

const START = '2026-04-01T09:00:00Z';
const at = (min: number) => new Date(Date.parse(START) + min * 60_000);

describe('PROP: cadence laws', () => {
  test.prop([
    fc.integer({ min: 1, max: 240 }),
    fc.integer({ min: 1, max: 120 }),
    fc.integer({ min: 0, max: 100_000 }),
  ])('never fires before the next due time, always advances past now', (firstMin, intervalMin, elapsedS) => {
    const state = initCheckinState(START, firstMin);
    const now = new Date(Date.parse(START) + elapsedS * 1000);
    const res = evaluateCheckin(state, intervalMin, now);
    if (res.fire) {
      // After firing, the next slot is strictly in the future (no immediate re-fire).
      expect(Date.parse(res.state.nextDueUtc)).toBeGreaterThan(now.getTime());
      // Re-evaluating at the same instant does not fire again.
      expect(evaluateCheckin(res.state, intervalMin, now).fire).toBe(false);
    } else {
      expect(now.getTime()).toBeLessThan(Date.parse(state.nextDueUtc));
    }
  });

  test.prop([fc.integer({ min: 1, max: 60 }), fc.integer({ min: 200, max: 100_000 })])(
    'a long gap fires exactly once and realigns within one interval of now',
    (intervalMin, gapMin) => {
      const state = initCheckinState(START, 60);
      const now = at(60 + gapMin); // well past the first slot
      const res = evaluateCheckin(state, intervalMin, now);
      expect(res.fire).toBe(true);
      // Realigned: next due is in (now, now + interval].
      const nextMs = Date.parse(res.state.nextDueUtc);
      expect(nextMs).toBeGreaterThan(now.getTime());
      expect(nextMs).toBeLessThanOrEqual(now.getTime() + intervalMin * 60_000);
      // Exactly one fire: immediately re-evaluating does not fire.
      expect(evaluateCheckin(res.state, intervalMin, now).fire).toBe(false);
    },
  );
});

describe('cadence scenarios (§10b defaults 60 then 30)', () => {
  it('first check-in fires at start + 60 min, not before', () => {
    const s = initCheckinState(START, 60);
    expect(evaluateCheckin(s, 30, at(59)).fire).toBe(false);
    expect(evaluateCheckin(s, 30, at(60)).fire).toBe(true);
  });

  it('then every 30 min, autonomously even if one is ignored', () => {
    let s = initCheckinState(START, 60);
    // Fire at 60.
    let r = evaluateCheckin(s, 30, at(60));
    expect(r.fire).toBe(true);
    s = r.state;
    // User ignores the 90 check-in entirely; at 120 the next still fires on time.
    r = evaluateCheckin(s, 30, at(120));
    expect(r.fire).toBe(true);
    expect(r.collapsedBacklog).toBe(1); // the 90 slot was collapsed, not flooded
    s = r.state;
    // Next nominal slot is 150.
    expect(new Date(s.nextDueUtc).toISOString()).toBe(at(150).toISOString());
  });

  it('a check-in due while the app was closed fires once on relaunch, then resumes', () => {
    let s = initCheckinState(START, 60);
    // App closed across the 60 slot; relaunch at 75.
    let r = evaluateCheckin(s, 30, at(75));
    expect(r.fire).toBe(true);
    s = r.state;
    // Resumes cadence: next at 90, fires once more, no backlog flood.
    expect(evaluateCheckin(s, 30, at(89)).fire).toBe(false);
    r = evaluateCheckin(s, 30, at(90));
    expect(r.fire).toBe(true);
    expect(r.collapsedBacklog).toBe(0);
  });

  it('after a long sleep, cadence realigns from wake — no backlog', () => {
    let s = initCheckinState(START, 60);
    // Fire normally at 60.
    s = evaluateCheckin(s, 30, at(60)).state;
    // Machine sleeps; wakes at 300 min. Many slots (90,120,...,300) were missed.
    const r = evaluateCheckin(s, 30, at(300));
    expect(r.fire).toBe(true);
    // Realigned to the next slot after wake (330), not a flood of the 7 missed slots.
    expect(new Date(r.state.nextDueUtc).toISOString()).toBe(at(330).toISOString());
    expect(r.collapsedBacklog).toBe(7); // one fires now; slots 90..300 otherwise collapsed
  });

  it('a custom dropdown pick applies to the next gap only, then reverts', () => {
    let s = initCheckinState(START, 60);
    // Fire at 60 and ask the next gap to be 10 min (custom pick).
    const r = evaluateCheckin(s, 30, at(60), 10);
    expect(r.fire).toBe(true);
    s = r.state;
    expect(new Date(s.nextDueUtc).toISOString()).toBe(at(70).toISOString());
    // Next fire reverts to the default 30 interval.
    const r2 = evaluateCheckin(s, 30, at(70));
    expect(new Date(r2.state.nextDueUtc).toISOString()).toBe(at(100).toISOString());
  });

  it('nominalCheckins describes the 60-then-30 grid', () => {
    const grid = nominalCheckins(START, 60, 30, START, at(180).toISOString());
    expect(grid.map((g) => new Date(g).toISOString())).toEqual([
      at(60).toISOString(),
      at(90).toISOString(),
      at(120).toISOString(),
      at(150).toISOString(),
    ]);
  });
});
