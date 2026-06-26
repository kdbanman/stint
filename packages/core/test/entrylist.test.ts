/**
 * GOLD — the Entries-view list model (PRD §12 R9). Deterministic unit contracts over
 * the pure core functions the GUI Entries view and `tt list --by/--search` consume:
 *   - matchesQuery: case-insensitivity, field coverage (description / client / project /
 *     tag), empty-query-matches-all,
 *   - groupEntries: key ordering (day DESC, others ASC), multi-tag membership, the
 *     '(no client)' / '(no project)' / '(untagged)' buckets,
 *   - buildEntryList: applies the query then groups, reporting the matched ids.
 *
 * Golden over fixed EntryView fixtures so the grouping/matching rule cannot drift.
 */
import { describe, it, expect } from 'vitest';
import { matchesQuery, groupEntries, buildEntryList } from '../src/entrylist.js';
import type { EntryView } from '../src/types.js';

/** A minimal EntryView fixture — only the fields the list model reads vary per test. */
function entry(o: Partial<EntryView> & { id: number }): EntryView {
  return {
    id: o.id,
    clientId: o.clientId ?? null,
    projectId: o.projectId ?? null,
    description: o.description ?? null,
    startUtc: o.startUtc ?? '2026-06-24T09:00:00Z',
    endUtc: o.endUtc ?? '2026-06-24T10:00:00Z',
    billable: o.billable ?? true,
    excludedSeconds: o.excludedSeconds ?? 0,
    clientName: o.clientName ?? null,
    projectName: o.projectName ?? null,
    tags: o.tags ?? [],
    sleepSpans: o.sleepSpans ?? [],
    sleptThrough: o.sleptThrough ?? false,
    rawSeconds: o.rawSeconds ?? 3600,
    billableSeconds: o.billableSeconds ?? 3600,
  };
}

describe('matchesQuery (§12 R9 / §09 R7)', () => {
  const e = entry({
    id: 1,
    description: 'Auth Refactor',
    clientName: 'Acme',
    projectName: 'Billing',
    tags: ['Deep', 'urgent'],
  });

  it('matches on the description, case-insensitively', () => {
    expect(matchesQuery(e, 'refactor')).toBe(true);
    expect(matchesQuery(e, 'REFACTOR')).toBe(true);
    expect(matchesQuery(e, 'AuTh')).toBe(true);
  });

  it('matches on the client name', () => {
    expect(matchesQuery(e, 'acme')).toBe(true);
  });

  it('matches on the project name', () => {
    expect(matchesQuery(e, 'billing')).toBe(true);
  });

  it('matches on any tag, case-insensitively', () => {
    expect(matchesQuery(e, 'deep')).toBe(true);
    expect(matchesQuery(e, 'URGENT')).toBe(true);
  });

  it('does not match a string in no field', () => {
    expect(matchesQuery(e, 'nonexistent')).toBe(false);
  });

  it('an empty or whitespace query matches every entry', () => {
    expect(matchesQuery(e, '')).toBe(true);
    expect(matchesQuery(e, '   ')).toBe(true);
    // …even an entry with no description/client/project/tags.
    expect(matchesQuery(entry({ id: 2 }), '')).toBe(true);
  });
});

describe('groupEntries (§12 R9)', () => {
  // Two distinct days at midday UTC so the local calendar day is unambiguous in any
  // reasonable runner timezone.
  const day1 = '2026-06-24T12:00:00Z'; // later day
  const day2 = '2026-06-23T12:00:00Z'; // earlier day

  it('groups by day, newest day first (DESC)', () => {
    const groups = groupEntries(
      [
        entry({ id: 1, startUtc: day2 }),
        entry({ id: 2, startUtc: day1 }),
      ],
      'day',
    );
    expect(groups.map((g) => g.key)).toEqual(['2026-06-24', '2026-06-23']);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual([2]);
    expect(groups[1]!.entries.map((e) => e.id)).toEqual([1]);
  });

  it('groups by client, ASC, with a (no client) bucket', () => {
    const groups = groupEntries(
      [
        entry({ id: 1, clientName: 'Globex' }),
        entry({ id: 2, clientName: 'Acme' }),
        entry({ id: 3, clientName: null }),
      ],
      'client',
    );
    expect(groups.map((g) => g.key)).toEqual(['(no client)', 'Acme', 'Globex']);
  });

  it('groups by project, ASC, with a (no project) bucket', () => {
    const groups = groupEntries(
      [
        entry({ id: 1, projectName: 'Web' }),
        entry({ id: 2, projectName: 'API' }),
        entry({ id: 3, projectName: null }),
      ],
      'project',
    );
    expect(groups.map((g) => g.key)).toEqual(['(no project)', 'API', 'Web']);
  });

  it('groups by tag ASC, a multi-tag entry lands in each tag, untagged in (untagged)', () => {
    const groups = groupEntries(
      [
        entry({ id: 1, tags: ['ci', 'deep'] }),
        entry({ id: 2, tags: ['deep'] }),
        entry({ id: 3, tags: [] }),
      ],
      'tag',
    );
    expect(groups.map((g) => g.key)).toEqual(['(untagged)', 'ci', 'deep']);
    expect(groups.find((g) => g.key === 'ci')!.entries.map((e) => e.id)).toEqual([1]);
    // The multi-tag entry fans out into BOTH 'ci' and 'deep'.
    expect(groups.find((g) => g.key === 'deep')!.entries.map((e) => e.id)).toEqual([1, 2]);
    expect(groups.find((g) => g.key === '(untagged)')!.entries.map((e) => e.id)).toEqual([3]);
  });
});

describe('buildEntryList (§12 R9)', () => {
  const entries = [
    entry({ id: 1, description: 'auth refactor', clientName: 'Acme', tags: ['deep'] }),
    entry({ id: 2, description: 'deploy pipeline', clientName: 'Globex', tags: ['ci'] }),
  ];

  it('with no query, groups every entry and reports all ids', () => {
    const list = buildEntryList(entries, { by: 'client' });
    expect(list.matchedIds).toEqual([1, 2]);
    expect(list.groups.map((g) => g.key)).toEqual(['Acme', 'Globex']);
  });

  it('applies the query before grouping; matchedIds reflects survivors', () => {
    const list = buildEntryList(entries, { by: 'client', query: 'refactor' });
    expect(list.matchedIds).toEqual([1]);
    expect(list.groups.map((g) => g.key)).toEqual(['Acme']);
    expect(list.groups[0]!.entries.map((e) => e.id)).toEqual([1]);
  });

  it('a query matching nothing yields no groups and no matched ids', () => {
    const list = buildEntryList(entries, { by: 'day', query: 'nonexistent' });
    expect(list.matchedIds).toEqual([]);
    expect(list.groups).toEqual([]);
  });

  it('an empty query matches all (no search active)', () => {
    const list = buildEntryList(entries, { by: 'tag', query: '   ' });
    expect(list.matchedIds).toEqual([1, 2]);
    expect(list.groups.map((g) => g.key)).toEqual(['ci', 'deep']);
  });
});
