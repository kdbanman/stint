/**
 * Unit — reference-data restore + the `referenced` flag (PRD §07 / §12 R13).
 *
 * The GUI Clients view gates archiving a *referenced* client/project behind a two-step
 * confirm and archives an unreferenced one directly; that scope decision reads the
 * `referenced` flag core populates on listClients/listProjects. Restore is the reverse of
 * archive (archived → active). Both are proven surface-neutral over core + `tt` by
 * features/reference_data.feature; this pins the core primitives directly — the `referenced`
 * computation and the restore edge (a project under a still-archived client cannot be restored).
 */
import { describe, it, expect } from 'vitest';
import { Store, StoreError } from '@stint/core';

const NOW = new Date('2026-06-24T10:00:00Z');

function seeded() {
  const store = Store.openMemory(() => NOW);
  const acme = store.addClient('Acme'); // referenced (has an entry below)
  const globex = store.addClient('Globex'); // unreferenced (no entries)
  const api = store.addProject('API', acme.id); // referenced
  store.addProject('Web', acme.id); // unreferenced
  // One closed entry references Acme / API — that history is what makes archiving them destructive.
  store.add({
    description: 'work',
    fromUtc: '2026-06-24T08:00:00Z',
    toUtc: '2026-06-24T09:00:00Z',
    clientId: acme.id,
    projectId: api.id,
  });
  return { store, acme, globex, api };
}

describe('listClients / listProjects populate `referenced` (§12 R13)', () => {
  it('marks a client referenced iff an entry points at it', () => {
    const { store } = seeded();
    const clients = store.listClients();
    expect(clients.find((c) => c.name === 'Acme')?.referenced).toBe(true);
    expect(clients.find((c) => c.name === 'Globex')?.referenced).toBe(false);
  });

  it('marks a project referenced iff an entry points at it', () => {
    const { store, acme } = seeded();
    const projects = store.listProjects(acme.id);
    expect(projects.find((p) => p.name === 'API')?.referenced).toBe(true);
    expect(projects.find((p) => p.name === 'Web')?.referenced).toBe(false);
  });
});

describe('restore — the reverse of archive (§07 / §12 R13)', () => {
  it('restoreClient returns an archived client to the active list', () => {
    const { store, globex } = seeded();
    store.archiveClient(globex.id);
    expect(store.listClients().some((c) => c.id === globex.id)).toBe(false);
    store.restoreClient(globex.id);
    const back = store.listClients().find((c) => c.id === globex.id);
    expect(back?.archived).toBe(false);
  });

  it('restoreTag returns an archived tag to the active list', () => {
    const { store } = seeded();
    const tag = store.addTag('billing');
    store.archiveTag(tag.id);
    expect(store.listTags().some((t) => t.id === tag.id)).toBe(false);
    store.restoreTag(tag.id);
    expect(store.listTags().some((t) => t.id === tag.id && !t.archived)).toBe(true);
  });

  it('restoreProject returns an archived project to the active list when its client is active', () => {
    const { store, api, acme } = seeded();
    store.archiveProject(api.id);
    expect(store.listProjects(acme.id).some((p) => p.id === api.id)).toBe(false);
    store.restoreProject(api.id);
    expect(store.listProjects(acme.id).some((p) => p.id === api.id && !p.archived)).toBe(true);
  });

  it('refuses to restore a project whose owning client is still archived, naming the client', () => {
    const { store, api, acme } = seeded();
    store.archiveProject(api.id);
    store.archiveClient(acme.id);
    expect(() => store.restoreProject(api.id)).toThrow(StoreError);
    expect(() => store.restoreProject(api.id)).toThrow(/Acme/);
    // The failed restore left the project archived (the tx rolled back / never fired the update).
    expect(store.listProjects(acme.id, true).find((p) => p.id === api.id)?.archived).toBe(true);
  });
});
