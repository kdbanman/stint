/**
 * GOLD — the GUI favorites plumbing (PRD §05 R09, §12 R14). The favorites rail's Pin /
 * list / rename / unpin all delegate to @stint/core; this drives the Electron-free helpers
 * (the units main.ts's pinFavorite / listFavorites IPC handlers wrap) against an in-memory
 * Store and proves: pinFavorite resolves client/project names through core and captures the
 * template (so the rail reaches nothing tt cannot), favoriteToView is a faithful projection,
 * and a source-entry pin captures that entry's exact attributes.
 */
import { describe, it, expect } from 'vitest';
import { Store } from '@stint/core';
import { pinFavorite, listFavorites, favoriteToView } from '../src/favorites.js';

const NOW = new Date('2026-06-24T18:00:00Z');
const mem = () => Store.openMemory(() => NOW);

describe('pinFavorite — resolve names + capture template (§05 R09)', () => {
  it('from explicit attributes resolves client/project names through core', () => {
    const store = mem();
    const view = pinFavorite(store, {
      name: 'Deep work',
      client: 'Acme',
      project: 'API',
      billable: true,
      tags: ['deep', 'focus'],
    });
    expect(view).toMatchObject({
      name: 'Deep work',
      billable: true,
      tags: ['deep', 'focus'],
    });
    // The names resolved to real ids in core (the renderer sent names, never ids).
    expect(typeof view.clientId).toBe('number');
    expect(typeof view.projectId).toBe('number');
    // …and it equals the favorite core actually stored.
    expect(listFavorites(store)).toEqual([view]);
    store.close();
  });

  it('from a source entry captures that entry exact template', () => {
    const store = mem();
    const { clientId, projectId } = store.resolveClientProjectByName({ client: 'Globex', project: 'Ops' });
    const { value: entry } = store.add({
      description: 'ops sync',
      clientId,
      projectId,
      billable: true,
      tags: ['ci'],
      fromUtc: '2026-06-24T09:00:00Z',
      toUtc: '2026-06-24T10:00:00Z',
    });
    const view = pinFavorite(store, { name: 'Ops sync', fromEntryId: entry.id });
    expect(view).toMatchObject({
      name: 'Ops sync',
      description: 'ops sync',
      clientId,
      projectId,
      billable: true,
      tags: ['ci'],
    });
    store.close();
  });

  it('from the running entry (open) captures the open entry', () => {
    const store = mem();
    const acme = store.addClient('Acme');
    store.start({ description: 'standup', clientId: acme.id, billable: true, tags: ['daily'] });
    const view = pinFavorite(store, { name: 'Standup', fromEntryId: 'open' });
    expect(view).toMatchObject({
      name: 'Standup',
      description: 'standup',
      clientId: acme.id,
      billable: true,
      tags: ['daily'],
    });
    store.close();
  });

  it('a duplicate name rejects (the duplicate-name rule lives in core)', () => {
    const store = mem();
    pinFavorite(store, { name: 'Deep', billable: false, tags: ['focus'] });
    expect(() => pinFavorite(store, { name: 'deep', billable: false })).toThrow(/already exists/);
    store.close();
  });
});

describe('favoriteToView — faithful projection (§05 R09)', () => {
  it('mirrors the core Favorite field-for-field', () => {
    const store = mem();
    const acme = store.addClient('Acme');
    const created = store.pinFavorite({
      name: 'X',
      description: 'desc',
      clientId: acme.id,
      projectId: null,
      billable: true,
      tags: ['a', 'b'],
    });
    expect(favoriteToView(created)).toEqual({
      id: created.id,
      name: 'X',
      description: 'desc',
      clientId: acme.id,
      projectId: null,
      billable: true,
      tags: ['a', 'b'],
    });
    store.close();
  });
});

describe('listFavorites — name-ordered renderer-safe views (§05 R09)', () => {
  it('lists the pinned favorites name-ordered as views', () => {
    const store = mem();
    pinFavorite(store, { name: 'Zed', billable: false });
    pinFavorite(store, { name: 'Alpha', billable: false });
    expect(listFavorites(store).map((f) => f.name)).toEqual(['Alpha', 'Zed']);
    store.close();
  });
});
