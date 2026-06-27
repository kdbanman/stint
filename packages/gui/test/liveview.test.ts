/**
 * Unit — the live-view derivation (PRD §12 R9 / §17 R11). A search / filter / group
 * selection must reflect LIVE in both the visible list AND the report totals, recomputed
 * from the in-memory snapshot with no IPC round-trip. We prove deriveView narrows rows by
 * search / client / billable, regroups by day vs client, and that the list total and the
 * report total recompute to match the filtered set — and equal the full snapshot total
 * when no selection is active. The per-entry billableSeconds it sums is the core-owned
 * value `tt report` already produces, so the live totals stay equal to the report's.
 */
import { describe, it, expect } from 'vitest';
import { deriveView } from '../src/liveview.js';
import type { UiState, EntryRowView } from '../src/ipc.js';

const DEFAULT_SETTINGS = {
  rounding: false,
  roundingIncrementMin: 15,
  weekStart: 'monday',
  firstCheckinMin: 60,
  checkinIntervalMin: 30,
  globalHotkey: 'CommandOrControl+Alt+T',
  accent: 'system',
  dateFormat: 'system',
  backupRetention: 5,
};

function row(p: Partial<EntryRowView> & { id: number; startUtc: string }): EntryRowView {
  return {
    description: null,
    clientLabel: null,
    endUtc: null,
    billableSeconds: 3600,
    billable: true,
    overlapped: false,
    overlapMinutes: 0,
    overlapRelation: null,
    sleptThrough: false,
    excludedSeconds: 0,
    rawSeconds: 3600,
    tags: [],
    ...p,
  };
}

// Two days, two clients, mixed billable. Acme: auth refactor (2h, billable, 06-24) +
// standup (0.5h, billable, 06-23). Globex: deploy (1h, billable, 06-24) + internal
// (1h, NON-billable, 06-23).
function fixture(): UiState {
  const days = [
    {
      day: '2026-06-24',
      entries: [
        row({ id: 1, description: 'auth refactor', clientLabel: 'Acme / API', startUtc: '2026-06-24T09:00:00Z', billableSeconds: 7200, rawSeconds: 7200, tags: ['deep'] }),
        row({ id: 2, description: 'deploy pipeline', clientLabel: 'Globex / Ops', startUtc: '2026-06-24T11:00:00Z', billableSeconds: 3600, rawSeconds: 3600, tags: ['ci'] }),
      ],
    },
    {
      day: '2026-06-23',
      entries: [
        row({ id: 3, description: 'standup', clientLabel: 'Acme / API', startUtc: '2026-06-23T09:00:00Z', billableSeconds: 1800, rawSeconds: 1800, tags: ['meeting'] }),
        row({ id: 4, description: 'internal sync', clientLabel: 'Globex / Ops', startUtc: '2026-06-23T13:00:00Z', billableSeconds: 3600, rawSeconds: 3600, billable: false, tags: [] }),
      ],
    },
  ];
  return {
    status: { running: false, entry: null },
    days,
    sleepFlaggedIds: [],
    settings: DEFAULT_SETTINGS,
    accent: '#2f6fed',
    lastBackupUtc: null,
    recoveryNotice: null,
  };
}

const ids = (v: { groups: { entries: EntryRowView[] }[] }) =>
  v.groups.flatMap((g) => g.entries.map((e) => e.id)).sort((a, b) => a - b);

describe('deriveView — no selection reproduces the full snapshot', () => {
  it('keeps every row, groups by day newest-first, and totals match the snapshot', () => {
    const v = deriveView(fixture());
    expect(ids(v)).toEqual([1, 2, 3, 4]);
    // Day groups read newest day first.
    expect(v.groups.map((g) => g.key)).toEqual(['2026-06-24', '2026-06-23']);
    // List total = every row's billableSeconds (7200+3600+1800+3600).
    expect(v.listTotalSeconds).toBe(16200);
    // Report total = billable-only (7200+3600+1800; the non-billable 3600 excluded).
    expect(v.reportTotalSeconds).toBe(12600);
  });
});

describe('deriveView — search narrows the visible rows AND both totals', () => {
  it('a search keeps only matching rows and recomputes the totals to the filtered set', () => {
    const v = deriveView(fixture(), { search: 'refactor' });
    expect(ids(v)).toEqual([1]); // only "auth refactor"
    expect(v.listTotalSeconds).toBe(7200);
    expect(v.reportTotalSeconds).toBe(7200);
  });

  it('search is case-insensitive and matches client + tags too', () => {
    expect(ids(deriveView(fixture(), { search: 'GLOBEX' }))).toEqual([2, 4]); // client label
    expect(ids(deriveView(fixture(), { search: 'ci' }))).toEqual([2]); // tag
  });
});

describe('deriveView — client and billable filters narrow rows + totals', () => {
  it('a client filter keeps only that client and totals its rows', () => {
    const v = deriveView(fixture(), { clientLabel: 'Acme / API' });
    expect(ids(v)).toEqual([1, 3]);
    expect(v.listTotalSeconds).toBe(9000); // 7200 + 1800
    expect(v.reportTotalSeconds).toBe(9000); // both billable
  });

  it('the billable filter drops the non-billable row from the list and the report total', () => {
    const billableOnly = deriveView(fixture(), { billable: 'billable' });
    expect(ids(billableOnly)).toEqual([1, 2, 3]); // the non-billable id 4 is gone
    expect(billableOnly.listTotalSeconds).toBe(12600);
    expect(billableOnly.reportTotalSeconds).toBe(12600);

    const nonBillable = deriveView(fixture(), { billable: 'non-billable' });
    expect(ids(nonBillable)).toEqual([4]);
    expect(nonBillable.listTotalSeconds).toBe(3600);
    // The non-billable row contributes nothing to the billable-only report total.
    expect(nonBillable.reportTotalSeconds).toBe(0);
  });
});

describe('deriveView — group switches the grouping', () => {
  it('grouping by client buckets the rows under their client label', () => {
    const v = deriveView(fixture(), { group: 'client' });
    const keys = v.groups.map((g) => g.key).sort();
    expect(keys).toEqual(['Acme / API', 'Globex / Ops']);
    const acme = v.groups.find((g) => g.key === 'Acme / API')!;
    const globex = v.groups.find((g) => g.key === 'Globex / Ops')!;
    expect(ids({ groups: [acme] })).toEqual([1, 3]);
    expect(ids({ groups: [globex] })).toEqual([2, 4]);
    // Per-group billable seconds: Acme 7200+1800, Globex billable-only 3600 (id 4 excluded).
    expect(acme.billableSeconds).toBe(9000);
    expect(globex.billableSeconds).toBe(3600);
    // Regrouping is invariant on the totals (the whole set is still present).
    expect(v.listTotalSeconds).toBe(16200);
    expect(v.reportTotalSeconds).toBe(12600);
  });

  it('search + client + group compose, and the totals follow the surviving set', () => {
    const v = deriveView(fixture(), { search: 'a', clientLabel: 'Acme / API', group: 'client' });
    // "a" matches "auth refactor" and "standup"; both are Acme → one client group.
    expect(v.groups.map((g) => g.key)).toEqual(['Acme / API']);
    expect(ids(v)).toEqual([1, 3]);
    expect(v.listTotalSeconds).toBe(9000);
    expect(v.reportTotalSeconds).toBe(9000);
  });
});
