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
  liveEditStripPatch,
  favoriteRows,
  type LiveEditInput,
  type LiveEditStripInput,
} from '../src/timerview.js';
import type { UiState, FavoriteView } from '../src/ipc.js';
import { DEFAULT_SETTINGS } from '@stint/core';

const NOW = new Date('2026-06-24T23:00:00Z');
// A running entry started exactly 01:24:07 (5047s) before NOW — the JUDGE harness's pinned
// figure, so the unit's count-up and the captured screenshot read the same deterministic value.
const RUNNING_ELAPSED_S = 5047;
const RUNNING_START = new Date(NOW.getTime() - RUNNING_ELAPSED_S * 1000).toISOString();

// The snapshot's §14 settings — core's own defaults, never a re-typed field list. Nothing in
// this file reads a settings value (timerview projects the running entry), so a hand-written
// copy here would only be one more list to keep in step with core's.
const baseSettings = DEFAULT_SETTINGS;

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

describe('liveEditStripPatch — the strip seed-vs-field diff, byte-compared (§12 R14/R15, issue #68)', () => {
  // Second-granular seeds: the field seeds carry seconds, so the untouched-field rule holds to the
  // second, not the whole minute. startUtc is the stored instant; seedStart is the localInputValue
  // string renderLiveEdit put in #le-start; start is the field's current text.
  //
  // This literal MUST stay byte-identical to what SU.localInputValue produces — it is the whole
  // point of the byte gate. It moved from '2026-06-24T09:07:33' to the space spelling with issue
  // #159 (the field shows the string a user retypes, not a wire instant); renderer-bundle.test.ts
  // pins the producing side of that same string so the two can never drift apart silently.
  const SEED_START = '2026-06-24 09:07:33'; // localInputValue string (seconds always rendered)
  const STORED_ISO = '2026-06-24T09:07:33.000Z'; // the exact stored instant (UTC test env)
  const stripInput = (over: Partial<LiveEditStripInput> = {}): LiveEditStripInput => ({
    seedDescription: 'auth refactor',
    description: 'auth refactor',
    seedStart: SEED_START,
    start: SEED_START,
    startUtc: STORED_ISO,
    seedBillable: true,
    billable: true,
    ...over,
  });

  it('nothing touched ⇒ an empty patch (no key, to the second)', () => {
    expect(liveEditStripPatch(stripInput())).toEqual({});
  });

  it('a desc-only edit carries description and NO startUtc / endUtc key (the #68 regression guard)', () => {
    const patch = liveEditStripPatch(stripInput({ description: 'auth refactor v2' }));
    expect(patch).toEqual({ description: 'auth refactor v2' });
    expect('startUtc' in patch).toBe(false); // the untouched start contributes nothing…
    expect('endUtc' in patch).toBe(false); // …and the open row is never closed
  });

  it('an untouched DST-ambiguous start is BYTE-skipped, never reparsed to the wrong instant', () => {
    // The stored instant is the SECOND 1:30 AM on a fall-back day (CST, UTC-6 = 07:30Z); the seed
    // wall-clock string 01:30 reparses (in any single-offset engine) to a DIFFERENT instant. A
    // reparse-and-compare diff would emit a spurious startUtc here; byte-comparison of the untouched
    // field against its seed skips it. Desc-only edit ⇒ only description rides.
    const patch = liveEditStripPatch(
      stripInput({
        seedStart: '2024-11-03 01:30:00',
        start: '2024-11-03 01:30:00', // untouched
        startUtc: '2024-11-03T07:30:00.000Z', // the real stored instant, an hour off the reparse
        description: 'note',
        seedDescription: 'auth refactor',
      }),
    );
    expect(patch).toEqual({ description: 'note' });
    expect('startUtc' in patch).toBe(false);
  });

  it('a genuinely edited start rides along (byte-different, parseable, a new instant)', () => {
    const patch = liveEditStripPatch(stripInput({ start: '2026-06-24 08:30:00' }));
    expect(patch.startUtc).toBe('2026-06-24T08:30:00.000Z');
    expect('endUtc' in patch).toBe(false); // still never closes the open row
  });

  it('a half-typed unparseable start contributes nothing (the NaN guard)', () => {
    // Half-typed in the SPACE spelling — the case the engine's legacy parser would happily read
    // as 08:00 and commit mid-keystroke (issue #159); parseLocalInput refuses it outright.
    const patch = liveEditStripPatch(stripInput({ start: '2026-06-24 08:' }));
    expect('startUtc' in patch).toBe(false);
  });

  it('a byte-different start that resolves to the SAME stored instant is dropped (double-guard)', () => {
    // An equivalent representation of the seed (a trailing .000 on the seconds) differs byte-wise
    // from the seed, so it passes the byte gate and is parsed — but it lands on the SAME stored
    // instant, so the double-guard drops it and no startUtc key is emitted.
    const patch = liveEditStripPatch(stripInput({ start: '2026-06-24 09:07:33.000' }));
    expect('startUtc' in patch).toBe(false);
  });

  it('a start retyped in the OLD `T` spelling is still read (issue #159 back-compat)', () => {
    // #159 changed what the field RENDERS, not what it accepts. Someone with the `T` form in
    // muscle memory (or pasted from `tt`) types it over the seed: byte-different, so it is
    // parsed — and it must resolve to the wall clock it names, not be dropped as unreadable.
    const patch = liveEditStripPatch(stripInput({ start: '2026-06-24T08:30:00' }));
    expect(patch.startUtc).toBe('2026-06-24T08:30:00.000Z');
    expect('endUtc' in patch).toBe(false);
  });

  it('the billable toggle rides the same patch, still no endUtc', () => {
    const patch = liveEditStripPatch(stripInput({ billable: false }));
    expect(patch).toEqual({ billable: false });
    expect('endUtc' in patch).toBe(false);
  });

  it('clearing the description to blank sends description: null', () => {
    const patch = liveEditStripPatch(stripInput({ description: '   ' }));
    expect(patch).toEqual({ description: null });
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
