/**
 * GOLD — the GUI's attributed-start helper (PRD §05 R1, §12 R1). The `start` IPC
 * handler used to cast its payload to `Record<string, never>` and drop every
 * attribute; this drives `startWithAttributes` (the Electron-free unit the handler now
 * delegates to) against an in-memory Store and proves the IPC path carries the full
 * attribute set the tt CLI already does — description, client/project (create-on-
 * demand), tags, the billable tri-state, and an explicit start instant — while the
 * ≤1-open invariant holds.
 */
import { describe, it, expect } from 'vitest';
import { Store } from '@stint/core';
import { startWithAttributes } from '../src/start.js';

const NOW = '2026-06-24T18:00:00Z';
const mem = () => Store.openMemory(() => new Date(NOW));

describe('startWithAttributes — the GUI attributed start', () => {
  it('a bare payload starts an entry with null attributes (clientless ⇒ non-billable default)', () => {
    const store = mem();
    const { value } = startWithAttributes(store, {});
    expect(value.endUtc).toBeNull();
    expect(value.description).toBeNull();
    expect(value.clientId).toBeNull();
    expect(value.projectId).toBeNull();
    expect(value.tags).toEqual([]);
    expect(value.billable).toBe(false); // no client ⇒ default non-billable
    expect(value.startUtc).toBe(NOW);
    store.close();
  });

  it('resolves a description + new client + new project, creating them on demand', () => {
    const store = mem();
    const { value } = startWithAttributes(store, {
      description: 'auth refactor',
      client: 'Acme',
      project: 'API',
    });
    expect(value.description).toBe('auth refactor');
    expect(value.clientName).toBe('Acme');
    expect(value.projectName).toBe('API');
    // create-on-demand: the names became real rows under the project⇒client rule.
    const client = store.findClientByName('Acme');
    expect(client).not.toBeNull();
    expect(store.findProjectByName('API', client!.id)).not.toBeNull();
    // a client present ⇒ billable by default
    expect(value.billable).toBe(true);
    store.close();
  });

  it('persists tags', () => {
    const store = mem();
    const { value } = startWithAttributes(store, { tags: ['deep', 'urgent'] });
    expect(value.tags.sort()).toEqual(['deep', 'urgent']);
    store.close();
  });

  it('honours the billable tri-state', () => {
    // billable:false forces non-billable even with a client present…
    const a = mem();
    const r1 = startWithAttributes(a, { client: 'Acme', billable: false });
    expect(r1.value.billable).toBe(false);
    a.close();

    // …billable:true forces billable even with no client…
    const b = mem();
    const r2 = startWithAttributes(b, { billable: true });
    expect(r2.value.billable).toBe(true);
    b.close();

    // …omitted billable falls through to the client-derived default.
    const c = mem();
    const r3 = startWithAttributes(c, { client: 'Acme' });
    expect(r3.value.billable).toBe(true);
    c.close();
  });

  it('honours an explicit atUtc start instant', () => {
    const store = mem();
    const at = '2026-06-24T09:30:00Z';
    const { value } = startWithAttributes(store, { description: 'backdated', atUtc: at });
    expect(value.startUtc).toBe(at);
    store.close();
  });

  it('starting while running stops the prior open entry (≤1 open invariant)', () => {
    const store = mem();
    const first = startWithAttributes(store, { description: 'first' }).value;
    const second = startWithAttributes(store, { description: 'second' }).value;
    expect(second.id).not.toBe(first.id);
    // Exactly one entry is open: the new one.
    const open = store.openEntry();
    expect(open).not.toBeNull();
    expect(open!.id).toBe(second.id);
    // The prior entry was closed, not left dangling.
    expect(store.getEntry(first.id)!.endUtc).not.toBeNull();
    store.close();
  });
});
