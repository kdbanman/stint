/**
 * PROP + scenarios — editing, reference-data management, and merge conflict
 * resolution (PRD §05 R6, §06, §07, §08). These are first-class operations the
 * coverage matrix routes here; this file exercises them on the core surface (the
 * CLI surface is covered by GOLD, and the cross-surface flows by BDD).
 */
import { describe, it, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { Store, StoreError } from '@stint/core';

// The pinned clock. NOW_UTC is the same instant in core's stored form, for the timestamps
// this file passes across the API and reads back.
const NOW_UTC = '2026-05-10T18:00:00Z';
const NOW = new Date(NOW_UTC);
const mem = () => Store.openMemory(() => NOW);

describe('edit amends a field without touching the others (§05 R6, §06 R1)', () => {
  it('changing the description leaves times, client, billable intact', () => {
    const store = mem();
    const ca = store.addClient('Client A');
    const { value: e } = store.add({
      description: 'draft',
      fromUtc: '2026-05-10T09:00:00Z',
      toUtc: '2026-05-10T10:00:00Z',
      clientId: ca.id,
      billable: true,
    });
    store.edit(e.id, { description: 'final draft' });
    const after = store.getEntry(e.id)!;
    expect(after.description).toBe('final draft');
    expect(after.startUtc).toBe('2026-05-10T09:00:00Z');
    expect(after.endUtc).toBe('2026-05-10T10:00:00Z');
    expect(after.clientId).toBe(ca.id);
    expect(after.billable).toBe(true);
    store.close();
  });

  it('the running entry is editable, including its start, without stopping it', () => {
    const store = mem();
    const { value: open } = store.start({ description: 'work', atUtc: '2026-05-10T17:00:00Z' });
    store.edit(open.id, { description: 'deep work', startUtc: '2026-05-10T16:30:00Z' });
    const after = store.getEntry(open.id)!;
    expect(after.endUtc).toBeNull(); // still running
    expect(after.description).toBe('deep work');
    expect(after.startUtc).toBe('2026-05-10T16:30:00Z');
    store.close();
  });

  // §05 R06 / §03 / §16 (issue #61) — the running entry's start is editable, but NOT to a future
  // instant. A future start freezes the derived count-up at 00:00:00 and would brick Stop; core
  // refuses it (rejected rather than stored, §14) and leaves the open row exactly as it was.
  it('refuses moving the running entry start AFTER now, leaving the open row intact (#61)', () => {
    const store = mem();
    const { value: open } = store.start({ description: 'work', atUtc: '2026-05-10T17:00:00Z' });
    const future = '2026-05-10T19:00:00Z'; // an hour past the NOW clock (18:00)
    expect(() => store.edit(open.id, { startUtc: future })).toThrow(StoreError);
    const after = store.getEntry(open.id)!;
    expect(after.startUtc).toBe('2026-05-10T17:00:00Z'); // unchanged — nothing stored
    expect(after.endUtc).toBeNull(); // still running
    expect(store.status().running).toBe(true);
    store.close();
  });

  // §05 R06 (#61) — the guard is bounded at now, not before it: editing the start to exactly now,
  // or a hair before, is still a legitimate amendment of the running row.
  it('allows moving the running entry start up to (and including) now (#61)', () => {
    const store = mem();
    const { value: open } = store.start({ description: 'work', atUtc: '2026-05-10T09:00:00Z' });
    store.edit(open.id, { startUtc: NOW_UTC }); // NOW_UTC is the fixed clock — the boundary
    expect(store.getEntry(open.id)!.startUtc).toBe(NOW_UTC);
    store.edit(open.id, { startUtc: '2026-05-10T17:59:59Z' }); // one second before now
    expect(store.getEntry(open.id)!.startUtc).toBe('2026-05-10T17:59:59Z');
    store.close();
  });

  // §05 R06 (#61) — the refused future-start edit never wedges the timer: after the rejection the
  // open row is unchanged, so Stop still closes it into a valid span (end ≥ start).
  it('a refused future-start edit leaves the running entry stoppable — no wedge (#61)', () => {
    const store = mem();
    const { value: open } = store.start({ description: 'work', atUtc: '2026-05-10T17:00:00Z' });
    expect(() => store.edit(open.id, { startUtc: '2026-05-10T20:00:00Z' })).toThrow(StoreError);
    const { value: stopped } = store.stop({ atUtc: NOW_UTC });
    expect(stopped.endUtc).toBe(NOW_UTC);
    expect(Date.parse(stopped.endUtc!)).toBeGreaterThanOrEqual(Date.parse(stopped.startUtc));
    store.close();
  });

  // §05 R01 / §03 (#61) — start()'s atomic close obeys Stop's rule. Backdating a new Start BEFORE
  // the open entry's start would close the open row at an instant before it began — a corrupted
  // end < start. The whole start() transaction must fail loudly and roll back, never persisting
  // the corruption (the closeOpenEntry guard shares stop()'s validation).
  it("start()'s atomic close never persists an end before the start (#61)", () => {
    const store = mem();
    const { value: open } = store.start({ description: 'running', atUtc: '2026-05-10T10:00:00Z' });
    expect(() => store.start({ description: 'oops', atUtc: '2026-05-10T09:00:00Z' })).toThrow(
      StoreError,
    );
    // The transaction rolled back: the original open row is intact and still the only entry.
    const entries = store.listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe(open.id);
    expect(entries[0]!.startUtc).toBe('2026-05-10T10:00:00Z');
    expect(entries[0]!.endUtc).toBeNull();
    store.close();
  });

  // §05 R06 / §03 (#61) — a PROPERTY over forward AND backward shifts of the RUNNING entry's
  // start, straddling `now`: any shift that lands strictly AFTER now is refused (nothing stored);
  // any shift at-or-before now is accepted and stored to the second. Generated across both sides
  // so the boundary is proven exactly at now, not on hand-picked instants — and the open row is
  // never stopped by the edit either way.
  test.prop([fc.integer({ min: -7200, max: 7200 })])(
    'a running-start shift is stored iff it lands at-or-before now (#61)',
    (deltaS) => {
      const store = mem();
      try {
        const { value: open } = store.start({ description: 'work', atUtc: '2026-05-10T12:00:00Z' });
        const target = new Date(NOW.getTime() + deltaS * 1000).toISOString().replace('.000Z', 'Z');
        if (deltaS > 0) {
          expect(() => store.edit(open.id, { startUtc: target })).toThrow(StoreError);
          expect(store.getEntry(open.id)!.startUtc).toBe('2026-05-10T12:00:00Z'); // unchanged
        } else {
          store.edit(open.id, { startUtc: target }); // at-or-before now — accepted
          expect(store.getEntry(open.id)!.startUtc).toBe(target);
        }
        expect(store.getEntry(open.id)!.endUtc).toBeNull(); // the edit never stops the open row
      } finally {
        store.close();
      }
    },
  );

  it('editing a time that overlaps another entry warns but is allowed (§06 R4)', () => {
    const store = mem();
    store.add({ description: 'a', fromUtc: '2026-05-10T09:00:00Z', toUtc: '2026-05-10T11:00:00Z' });
    const { value: b } = store.add({
      description: 'b',
      fromUtc: '2026-05-10T12:00:00Z',
      toUtc: '2026-05-10T13:00:00Z',
    });
    const res = store.edit(b.id, { startUtc: '2026-05-10T10:00:00Z' });
    expect(res.warnings.some((w) => w.kind === 'overlap')).toBe(true);
    expect(store.getEntry(b.id)!.startUtc).toBe('2026-05-10T10:00:00Z'); // allowed
    store.close();
  });

  it("editing to a project adopts that project's client (project ⇒ client, §03)", () => {
    const store = mem();
    const ca = store.addClient('Client A');
    const proj = store.addProject('API', ca.id);
    const { value: e } = store.add({
      description: 'x',
      fromUtc: '2026-05-10T09:00:00Z',
      toUtc: '2026-05-10T10:00:00Z',
    });
    store.edit(e.id, { projectId: proj.id });
    const after = store.getEntry(e.id)!;
    expect(after.projectId).toBe(proj.id);
    expect(after.clientId).toBe(ca.id);
    store.close();
  });

  it('adds and removes tags', () => {
    const store = mem();
    const { value: e } = store.add({
      description: 'x',
      fromUtc: '2026-05-10T09:00:00Z',
      toUtc: '2026-05-10T10:00:00Z',
    });
    store.edit(e.id, { addTags: ['meeting', 'deep'] });
    expect(store.getEntry(e.id)!.tags).toEqual(['deep', 'meeting']);
    store.edit(e.id, { removeTags: ['deep'] });
    expect(store.getEntry(e.id)!.tags).toEqual(['meeting']);
    store.close();
  });

  // §12 R15 / glossary "Stored truth" (issue #49) — an edit that changes NO field is the
  // IDENTITY on start/end. The generated spans are second-granular (deliberately not
  // 5-minute-aligned), so any snap, rounding, or truncation smuggled into the edit path —
  // e.g. an editor that rewrites times it merely displayed — fails the byte-for-byte round-trip.
  test.prop([fc.integer({ min: 0, max: 43_199 }), fc.integer({ min: 1, max: 43_200 })])(
    'an edit that changes no field is the identity on start/end, to the second',
    (startS, durS) => {
      const store = mem();
      try {
        const base = Date.parse('2026-05-10T00:00:00Z');
        const isoNoMs = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
        const { value: e } = store.add({
          description: 'exact span',
          fromUtc: isoNoMs(base + startS * 1000),
          toUtc: isoNoMs(base + (startS + durS) * 1000),
        });
        const before = store.getEntry(e.id)!;
        store.edit(e.id, {}); // the no-op patch — an "open then save" that touched nothing
        store.edit(e.id, { description: 'exact span (renamed)' }); // an unrelated-field edit
        const after = store.getEntry(e.id)!;
        expect(after.startUtc).toBe(before.startUtc);
        expect(after.endUtc).toBe(before.endUtc);
      } finally {
        store.close();
      }
    },
  );

  test.prop([fc.constantFrom('description', 'startUtc', 'billable'), fc.integer({ min: 0, max: 7200 })])(
    'editing one field changes only that field; the others are intact',
    (field, shiftS) => {
      const store = mem();
      try {
        const ca = store.addClient('Client A');
        const { value: e } = store.add({
          description: 'orig',
          fromUtc: '2026-05-10T09:00:00Z',
          toUtc: '2026-05-10T10:00:00Z',
          clientId: ca.id,
          billable: true,
        });
        const before = store.getEntry(e.id)!;
        // The generated field/value decides which single field this iteration edits.
        const patch =
          field === 'description'
            ? { description: 'changed' }
            : field === 'startUtc'
              ? { startUtc: new Date(Date.parse(before.startUtc) - shiftS * 1000).toISOString() }
              : { billable: !before.billable };
        store.edit(e.id, patch);
        const after = store.getEntry(e.id)!;

        // Every field other than the targeted one is byte-for-byte unchanged.
        if (field !== 'description') expect(after.description).toBe(before.description);
        if (field !== 'startUtc') expect(after.startUtc).toBe(before.startUtc);
        if (field !== 'billable') expect(after.billable).toBe(before.billable);
        expect(after.endUtc).toBe(before.endUtc);
        expect(after.clientId).toBe(before.clientId);
      } finally {
        store.close();
      }
    },
  );
});

describe('billable override (§08)', () => {
  it('a client entry can be marked non-billable (goodwill)', () => {
    const store = mem();
    const ca = store.addClient('Client A');
    const { value: e } = store.add({
      description: 'goodwill',
      fromUtc: '2026-05-10T09:00:00Z',
      toUtc: '2026-05-10T10:00:00Z',
      clientId: ca.id,
      billable: false,
    });
    expect(e.billable).toBe(false);
    // …and toggled back via edit.
    store.edit(e.id, { billable: true });
    expect(store.getEntry(e.id)!.billable).toBe(true);
    store.close();
  });

  it('clientless internal time can be flagged billable', () => {
    const store = mem();
    const { value: e } = store.start({ description: 'rare billable admin', billable: true, atUtc: NOW_UTC });
    expect(e.billable).toBe(true);
    expect(e.clientId).toBeNull();
    store.close();
  });
});

describe('client / project rename + archive (§07)', () => {
  it('renames a client and the new name flows to entries', () => {
    const store = mem();
    const ca = store.addClient('Acme');
    store.add({
      description: 'x',
      fromUtc: '2026-05-10T09:00:00Z',
      toUtc: '2026-05-10T10:00:00Z',
      clientId: ca.id,
    });
    store.renameClient(ca.id, 'Acme Corp');
    expect(store.findClientByName('Acme Corp')?.id).toBe(ca.id);
    expect(store.listEntries()[0]!.clientName).toBe('Acme Corp');
    store.close();
  });

  it('archives a client (hidden from the default list, preserved for history)', () => {
    const store = mem();
    const ca = store.addClient('Old Client');
    store.archiveClient(ca.id);
    expect(store.listClients().some((c) => c.id === ca.id)).toBe(false);
    expect(store.listClients(true).some((c) => c.id === ca.id && c.archived)).toBe(true);
    store.close();
  });

  it('renames and archives a project', () => {
    const store = mem();
    const ca = store.addClient('Client A');
    const proj = store.addProject('API', ca.id);
    store.renameProject(proj.id, 'Public API');
    expect(store.findProjectByName('Public API', ca.id)?.id).toBe(proj.id);
    store.archiveProject(proj.id);
    expect(store.listProjects(ca.id).some((p) => p.id === proj.id)).toBe(false);
    expect(store.listProjects(ca.id, true).some((p) => p.id === proj.id && p.archived)).toBe(true);
    store.close();
  });
});

describe('merge conflict resolution (§06, §16)', () => {
  function twoConflicting(store: Store): [number, number, number, number] {
    const a = store.addClient('Client A');
    const b = store.addClient('Client B');
    const e1 = store.add({
      description: 'part one',
      fromUtc: '2026-05-10T09:00:00Z',
      toUtc: '2026-05-10T10:00:00Z',
      clientId: a.id,
    }).value;
    const e2 = store.add({
      description: 'part two',
      fromUtc: '2026-05-10T10:00:00Z',
      toUtc: '2026-05-10T11:00:00Z',
      clientId: b.id,
    }).value;
    return [e1.id, e2.id, a.id, b.id];
  }

  it('defaults to the first entry’s client; concatenates descriptions; unions tags', () => {
    const store = mem();
    const [id1, id2, aId] = twoConflicting(store);
    store.edit(id1, { addTags: ['x'] });
    store.edit(id2, { addTags: ['y'] });
    const { value: merged } = store.merge([id1, id2]);
    expect(merged.clientId).toBe(aId); // first wins
    expect(merged.description).toBe('part one / part two');
    expect(merged.tags).toEqual(['x', 'y']);
    expect(merged.startUtc).toBe('2026-05-10T09:00:00Z');
    expect(merged.endUtc).toBe('2026-05-10T11:00:00Z');
    store.close();
  });

  it('--client override resolves the conflict to the chosen client', () => {
    const store = mem();
    const [id1, id2, , bId] = twoConflicting(store);
    const { value: merged } = store.merge([id1, id2], { clientId: bId });
    expect(merged.clientId).toBe(bId); // override wins over first-entry default
    store.close();
  });
});

// §06 R3 — the contiguity gate. Two closed entries with a randomly-sized gap between them.
// A merge folds the selection into ONE span from earliest start to latest end, so any positive
// gap becomes billable time the freelancer never worked (the filed bug: two 1-hour entries days
// apart → one 78-hour billable entry, silently). The property that kills that class: a
// SUCCESSFUL merge's span never exceeds the sum of its inputs' spans plus the acknowledged gap —
// and a gapped selection is refused outright unless the gap is acknowledged.
describe('merge contiguity gate (§06 R3)', () => {
  const base = Date.parse('2026-05-01T00:00:00Z');
  const isoAt = (s: number) => new Date(base + s * 1000).toISOString().replace('.000Z', 'Z');

  test.prop([
    fc.integer({ min: 60, max: 36_000 }), // first entry duration (s)
    fc.integer({ min: 0, max: 259_200 }), // gap after the first entry (s) — 0 = contiguous
    fc.integer({ min: 60, max: 36_000 }), // second entry duration (s)
  ])(
    'a successful merge spans exactly inputs + acknowledged gap, and a gap is refused unless acknowledged',
    (d1, gap, d2) => {
      const store = mem();
      try {
        const { value: e1 } = store.add({
          description: 'a',
          fromUtc: isoAt(0),
          toUtc: isoAt(d1),
        });
        const { value: e2 } = store.add({
          description: 'b',
          fromUtc: isoAt(d1 + gap),
          toUtc: isoAt(d1 + gap + d2),
        });
        const inputsSeconds = e1.rawSeconds + e2.rawSeconds; // d1 + d2

        if (gap > 0) {
          // Unacknowledged: refused, and the fold never ran — both originals survive untouched.
          expect(() => store.merge([e1.id, e2.id])).toThrow(StoreError);
          expect(store.getEntry(e1.id)).not.toBeNull();
          expect(store.getEntry(e2.id)).not.toBeNull();
        }

        // Acknowledged (a no-op for a contiguous selection): the fold proceeds and its span is
        // earliest start → latest end = inputs + gap — never the runaway billable of the bug.
        const { value: merged } = store.merge([e1.id, e2.id], { allowGap: true });
        expect(merged.rawSeconds).toBe(inputsSeconds + gap);
        expect(merged.rawSeconds).toBeLessThanOrEqual(inputsSeconds + gap);
        expect(merged.billableSeconds).toBeLessThanOrEqual(inputsSeconds + gap);
      } finally {
        store.close();
      }
    },
  );
});
