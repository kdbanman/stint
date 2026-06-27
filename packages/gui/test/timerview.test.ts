/**
 * GOLD — the pure Timer-view (G5) derivation (PRD §12 R14). The Timer view's clock panel,
 * live-edit-running strip, and favorites rail all paint from these Electron-free projections
 * (the units app.js and the IPC handlers wrap). This drives them directly and proves:
 *   - deriveRunningModel reads the LIVE count-up (now − startUtc − excludedSeconds) and the
 *     running entry's description / client-project label / tags / billable from the snapshot,
 *     and an idle face when nothing runs;
 *   - liveEditPatch — the load-bearing §12 R14 invariant — forwards only changed fields and
 *     NEVER an endUtc, so editing the open row keeps it open (the timer keeps running, §05 R6);
 *   - favoriteRows projects FavoriteView[] into the rail's name + meta + resume handle.
 * The behavioural favorite/start/edit flows themselves are core's (proven in §05 R09/R10 +
 * core PROP/BDD); this asserts the GUI's thin derivation never invents data nor closes the row.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveRunningModel,
  liveEditPatch,
  favoriteRows,
  type LiveEditInput,
} from '../src/timerview.js';
import type { UiState, FavoriteView } from '../src/ipc.js';

const NOW = new Date('2026-06-24T23:00:00Z');
// A running entry started exactly 01:24:07 (5047s) before NOW — the JUDGE harness's pinned
// figure, so the unit's count-up and the captured screenshot read the same deterministic value.
const RUNNING_ELAPSED_S = 5047;
const RUNNING_START = new Date(NOW.getTime() - RUNNING_ELAPSED_S * 1000).toISOString();

const baseSettings = {
  rounding: false,
  roundingIncrementMin: 15,
  weekStart: 'monday',
  firstCheckinMin: 60,
  checkinIntervalMin: 30,
  globalHotkey: 'CommandOrControl+Alt+T',
  accent: 'system',
  dateFormat: 'system',
  backupRetention: 7,
};

function runningSnapshot(
  over: Partial<NonNullable<UiState['status']['entry']> & { excludedSeconds?: number }> = {},
): UiState {
  return {
    status: {
      running: true,
      entry: {
        id: 1,
        description: 'auth refactor',
        clientLabel: 'Client A / API',
        startUtc: RUNNING_START,
        billableSeconds: RUNNING_ELAPSED_S,
        billable: true,
        sleptThrough: false,
        tags: ['deep', 'urgent'],
        ...over,
      },
    },
    days: [],
    sleepFlaggedIds: [],
    settings: baseSettings,
    accent: '#2f6fed',
    appVersion: '0.0.0-dev',
    lastBackupUtc: null,
    recoveryNotice: null,
  };
}

function idleSnapshot(): UiState {
  return {
    status: { running: false, entry: null },
    days: [],
    sleepFlaggedIds: [],
    settings: baseSettings,
    accent: '#2f6fed',
    appVersion: '0.0.0-dev',
    lastBackupUtc: null,
    recoveryNotice: null,
  };
}

describe('deriveRunningModel — the live clock-panel model (§12 R14)', () => {
  it('reads the live count-up (now − start − excluded) and the running entry attributes', () => {
    const m = deriveRunningModel(runningSnapshot(), NOW);
    expect(m.running).toBe(true);
    expect(m.entryId).toBe(1);
    expect(m.elapsedSeconds).toBe(RUNNING_ELAPSED_S); // 01:24:07 — display-only, never stored
    expect(m.description).toBe('auth refactor');
    expect(m.clientProjectLabel).toBe('Client A / API');
    expect(m.billable).toBe(true);
    expect(m.tags).toEqual(['deep', 'urgent']);
    expect(m.startUtc).toBe(RUNNING_START);
  });

  it('advances the count-up with the clock (a later now reads more elapsed)', () => {
    const later = new Date(NOW.getTime() + 3000);
    const m = deriveRunningModel(runningSnapshot(), later);
    expect(m.elapsedSeconds).toBe(RUNNING_ELAPSED_S + 3); // +3s, mirroring the JUDGE fast-forward
  });

  it('subtracts excludedSeconds (a slept stretch trimmed from the open row)', () => {
    const m = deriveRunningModel(runningSnapshot({ excludedSeconds: 600 }), NOW);
    expect(m.elapsedSeconds).toBe(RUNNING_ELAPSED_S - 600);
  });

  it('floors the count-up at 0 (a future start never reads negative)', () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    const m = deriveRunningModel(runningSnapshot({ startUtc: future }), NOW);
    expect(m.elapsedSeconds).toBe(0);
  });

  it('reads an idle face when nothing runs', () => {
    const m = deriveRunningModel(idleSnapshot(), NOW);
    expect(m).toEqual({
      running: false,
      entryId: null,
      elapsedSeconds: 0,
      description: null,
      clientProjectLabel: null,
      billable: false,
      tags: [],
      startUtc: null,
    });
  });
});

describe('liveEditPatch — edit the running timer live, NEVER closing it (§12 R14 / §05 R6)', () => {
  it('forwards only the changed fields and NEVER an endUtc', () => {
    const patch = liveEditPatch({ description: 'auth refactor v2', startUtc: RUNNING_START });
    expect(patch).toEqual({ description: 'auth refactor v2', startUtc: RUNNING_START });
    expect('endUtc' in patch).toBe(false); // the load-bearing invariant: the open row stays open
  });

  it('a start-time-only edit carries startUtc and no endUtc (the timer keeps running)', () => {
    const earlier = '2026-06-24T08:30:00Z';
    const patch = liveEditPatch({ startUtc: earlier });
    expect(patch.startUtc).toBe(earlier);
    expect('endUtc' in patch).toBe(false);
  });

  it('billable, tags, and client/project deltas ride the same patch, still no endUtc', () => {
    const patch = liveEditPatch({
      billable: false,
      addTags: ['focus'],
      removeTags: ['urgent'],
      clientId: 7,
      projectId: 3,
    });
    expect(patch).toEqual({
      billable: false,
      addTags: ['focus'],
      removeTags: ['urgent'],
      clientId: 7,
      projectId: 3,
    });
    expect('endUtc' in patch).toBe(false);
  });

  it('omits empty tag deltas and untouched fields (a no-op edit is an empty patch)', () => {
    const patch = liveEditPatch({ addTags: [], removeTags: [] } as LiveEditInput);
    expect(patch).toEqual({});
  });

  it('a null description clears it (distinct from omitting the field)', () => {
    expect(liveEditPatch({ description: null })).toEqual({ description: null });
    expect('description' in liveEditPatch({})).toBe(false);
  });

  it('a null client/project clears it (unassign), still no endUtc', () => {
    const patch = liveEditPatch({ clientId: null, projectId: null });
    expect(patch).toEqual({ clientId: null, projectId: null });
    expect('endUtc' in patch).toBe(false);
  });
});

describe('favoriteRows — project the rail rows (§12 R14 / §05 R09)', () => {
  const favs: FavoriteView[] = [
    { id: 10, name: 'Standup', description: null, clientId: 1, projectId: 2, billable: false, tags: [] },
    { id: 11, name: 'Deep work', description: 'focus', clientId: 1, projectId: 3, billable: true, tags: ['deep'] },
    { id: 12, name: 'Admin', description: null, clientId: null, projectId: null, billable: true, tags: ['admin'] },
  ];
  const labelFor = (clientId: number | null, projectId: number | null): string | null => {
    if (clientId === 1 && projectId === 2) return 'Client A / API';
    if (clientId === 1 && projectId === 3) return 'Client A / Alpha';
    return null;
  };

  it('builds name + meta + resume handle, one row per favorite', () => {
    const rows = favoriteRows(favs, labelFor);
    expect(rows.map((r) => r.name)).toEqual(['Standup', 'Deep work', 'Admin']);
    expect(rows[0]).toEqual({
      id: 10,
      name: 'Standup',
      meta: 'Client A / API · non-billable',
      billable: false,
      resumeName: 'Standup',
    });
    expect(rows[1]!.meta).toBe('Client A / Alpha · billable');
  });

  it('a clientless favorite shows just the billable word', () => {
    const rows = favoriteRows(favs, labelFor);
    expect(rows[2]!.meta).toBe('billable');
  });

  it('the resume handle is the favorite name (parity with tt fav start <name>)', () => {
    const rows = favoriteRows(favs, labelFor);
    for (const r of rows) expect(r.resumeName).toBe(r.name);
  });
});
