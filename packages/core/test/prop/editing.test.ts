/**
 * PROP + scenarios — editing, reference-data management, and merge conflict
 * resolution (PRD §05 R6, §06, §07, §08). These are first-class operations the
 * coverage matrix routes here; this file exercises them on the core surface (the
 * CLI surface is covered by GOLD, and the cross-surface flows by BDD).
 */
import { describe, it, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { Store } from '@stint/core';

const NOW = '2026-05-10T18:00:00Z';
const mem = () => Store.openMemory(() => new Date(NOW));

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
    const { value: e } = store.start({ description: 'rare billable admin', billable: true, atUtc: NOW });
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
