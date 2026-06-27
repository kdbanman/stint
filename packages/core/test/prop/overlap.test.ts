/**
 * PROP — per-entry overlap detail (PRD §12 R9, §06 R4). Money-affecting: when two
 * entries share time, that time must be flagged so the same hour cannot silently bill
 * twice. `describeOverlaps` feeds the in-context banner amount, so its overlap seconds
 * must be symmetric, bounded by each entry's own duration, present exactly when the spans
 * overlap, and absent for entries that overlap nothing.
 */
import { describe, it, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { describeOverlaps, spansOverlap } from '@stint/core';
import type { EntryView } from '@stint/core';

const BASE_MS = Date.parse('2026-06-24T00:00:00Z');
// A fixed `now` so an (unused here) open entry would be deterministic; all generated
// entries below are closed, so `now` never participates.
const NOW = new Date('2026-06-30T00:00:00Z');

/** A closed EntryView from a start offset (minutes) and a positive duration (minutes). */
function entry(id: number, startMin: number, durMin: number): EntryView {
  const startMs = BASE_MS + startMin * 60_000;
  const endMs = startMs + durMin * 60_000;
  const startUtc = new Date(startMs).toISOString();
  const endUtc = new Date(endMs).toISOString();
  return {
    id,
    clientId: null,
    projectId: null,
    description: null,
    startUtc,
    endUtc,
    billable: true,
    excludedSeconds: 0,
    clientName: null,
    projectName: null,
    tags: [],
    sleepSpans: [],
    sleptThrough: false,
    rawSeconds: durMin * 60,
    billableSeconds: durMin * 60,
  };
}

const durationS = (e: EntryView) => (Date.parse(e.endUtc!) - Date.parse(e.startUtc)) / 1000;

// A pair of closed entries with positive durations.
const pairArb = fc
  .tuple(
    fc.integer({ min: 0, max: 2000 }),
    fc.integer({ min: 1, max: 600 }),
    fc.integer({ min: 0, max: 2000 }),
    fc.integer({ min: 1, max: 600 }),
  )
  .map(([sA, dA, sB, dB]) => [entry(1, sA, dA), entry(2, sB, dB)] as const);

describe('PROP: describeOverlaps per-entry detail (§12 R9, §06 R4)', () => {
  test.prop([pairArb])('overlap seconds are symmetric across the pair', ([a, b]) => {
    const detail = describeOverlaps([a, b], NOW);
    const da = detail.get(a.id);
    const db = detail.get(b.id);
    // Either both are present (they share time) or neither is — and when present, the
    // shared seconds each reports are equal (the same span, seen from both sides).
    expect(da === undefined).toBe(db === undefined);
    if (da && db) expect(da.overlapSeconds).toBe(db.overlapSeconds);
  });

  test.prop([pairArb])('overlap seconds never exceed either entry own duration', ([a, b]) => {
    const detail = describeOverlaps([a, b], NOW);
    const da = detail.get(a.id);
    if (da) {
      expect(da.overlapSeconds).toBeGreaterThan(0);
      expect(da.overlapSeconds).toBeLessThanOrEqual(durationS(a));
      expect(da.overlapSeconds).toBeLessThanOrEqual(durationS(b));
    }
  });

  test.prop([pairArb])('present exactly when the spans overlap', ([a, b]) => {
    const overlaps = spansOverlap(
      Date.parse(a.startUtc),
      Date.parse(a.endUtc!),
      Date.parse(b.startUtc),
      Date.parse(b.endUtc!),
    );
    const detail = describeOverlaps([a, b], NOW);
    expect(detail.has(a.id)).toBe(overlaps);
    expect(detail.has(b.id)).toBe(overlaps);
  });

  test.prop([fc.integer({ min: 0, max: 2000 }), fc.integer({ min: 1, max: 600 })])(
    'a single entry overlapping nothing is absent from the map',
    (start, dur) => {
      expect(describeOverlaps([entry(1, start, dur)], NOW).size).toBe(0);
    },
  );

  it('the neighbour relation reflects which entry starts first', () => {
    // a:[0,60) overlaps b:[30,90): a's neighbour b is later → next; b's neighbour a is
    // earlier → previous.
    const a = entry(1, 0, 60);
    const b = entry(2, 30, 60);
    const detail = describeOverlaps([a, b], NOW);
    expect(detail.get(1)?.relation).toBe('next');
    expect(detail.get(2)?.relation).toBe('previous');
    expect(detail.get(1)?.overlapSeconds).toBe(30 * 60);
  });
});
