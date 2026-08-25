/**
 * GOLD — the Clients-view weights (PRD §12 R27). buildReferenceWeights is the one
 * aggregation the `referenceWeights` IPC channel serves: per-client/per-project summed
 * seconds and per-tag entry counts over two windows — all-time, and core's month preset —
 * each window one `store.report` read (the same grouped totals behind `tt report --by`,
 * §09 R02). This drives it over a real in-memory Store and pins the figures to literals
 * computed by hand from the seeded spans (never by re-running the code's own arithmetic):
 * the month boundary excludes last month's entries, billable and non-billable count alike
 * (`tt report --all`'s figure), all-time reaches years back, and the placeholder buckets
 * — clientless time, untagged entries — never surface as weight rows.
 */
import { describe, it, expect } from 'vitest';
import { Store, toUtc } from '@stint/core';
import { buildReferenceWeights } from '../src/weights.js';

// Mid-June local noon: far from every month boundary in any host zone, so the seeded
// local wall-clock spans below fall in the same calendar month wherever the test runs
// (the month preset resolves in the configured zone — 'system', the host's).
const NOW = new Date(2026, 5, 15, 12, 0, 0);

/** A local wall-clock span on one day, as the UTC ISO pair store.add takes. The end is
 *  start + hours as instant arithmetic (the Date constructor truncates fractional hours). */
const span = (y: number, m: number, d: number, hour: number, hours: number) => {
  const start = new Date(y, m - 1, d, hour);
  return { fromUtc: toUtc(start), toUtc: toUtc(new Date(start.getTime() + hours * 3_600_000)) };
};

function seededStore(): Store {
  const store = Store.openMemory(() => NOW);
  const acmeApi = store.resolveClientProjectByName({ client: 'Acme', project: 'API' });
  const acmeWeb = store.resolveClientProjectByName({ client: 'Acme', project: 'Web' });
  const globexOnb = store.resolveClientProjectByName({ client: 'Globex', project: 'Onboarding' });
  // THIS MONTH (June 2026): 2h Acme/API (deep, urgent) + 30m Globex/Onboarding NON-billable (deep).
  store.add({ description: 'auth', clientId: acmeApi.clientId, projectId: acmeApi.projectId, tags: ['deep', 'urgent'], billable: true, ...span(2026, 6, 10, 9, 2) });
  store.add({ description: 'onboarding call', clientId: globexOnb.clientId, projectId: globexOnb.projectId, tags: ['deep'], billable: false, ...span(2026, 6, 12, 9, 0.5) });
  // LAST MONTH (May): 3h Acme/API (deep) + 1.5h Acme/Web — outside the month window.
  store.add({ description: 'schema', clientId: acmeApi.clientId, projectId: acmeApi.projectId, tags: ['deep'], billable: true, ...span(2026, 5, 10, 9, 3) });
  store.add({ description: 'landing', clientId: acmeWeb.clientId, projectId: acmeWeb.projectId, tags: [], billable: true, ...span(2026, 5, 12, 9, 1.5) });
  // YEARS BACK (Jan 2020): 1h Acme/API — all-time is the whole record, not a recent window.
  store.add({ description: 'kickoff', clientId: acmeApi.clientId, projectId: acmeApi.projectId, tags: [], billable: true, ...span(2020, 1, 15, 9, 1) });
  // CLIENTLESS, UNTAGGED (June): 1h — must weigh NO client, NO project, NO tag row.
  store.add({ description: 'admin', ...span(2026, 6, 13, 9, 1) });
  return store;
}

describe('buildReferenceWeights — the Clients-view weights (§12 R27)', () => {
  it('sums per client/project over the two windows: all-time reaches years back, this month is the month preset', () => {
    const w = buildReferenceWeights(seededStore(), NOW);
    // Literals by hand: Acme all-time 2h + 3h + 1.5h + 1h = 7.5h = 27000s; June alone 2h = 7200s.
    expect(w.clients.map((c) => c.name)).toEqual(['Acme', 'Globex']);
    const acme = w.clients[0]!;
    expect(acme.allTimeSeconds).toBe(27000);
    expect(acme.monthSeconds).toBe(7200);
    // API: 2h + 3h + 1h = 6h all-time, 2h in June. Web: 1.5h all-time, nothing in June —
    // the zero the renderer paints as the §12 R27 em-dash.
    expect(acme.projects).toEqual([
      { name: 'API', allTimeSeconds: 21600, monthSeconds: 7200 },
      { name: 'Web', allTimeSeconds: 5400, monthSeconds: 0 },
    ]);
  });

  it('counts billable and non-billable time alike — a weight answers which records carry the hours', () => {
    const w = buildReferenceWeights(seededStore(), NOW);
    // Globex's only entry is non-billable; it still weighs (tt report --all's figure).
    const globex = w.clients[1]!;
    expect(globex.allTimeSeconds).toBe(1800);
    expect(globex.monthSeconds).toBe(1800);
    expect(globex.projects).toEqual([{ name: 'Onboarding', allTimeSeconds: 1800, monthSeconds: 1800 }]);
  });

  it('counts tag ENTRIES per window and never surfaces the placeholder buckets', () => {
    const w = buildReferenceWeights(seededStore(), NOW);
    // deep: 3 entries ever (June Acme, June Globex, May Acme), 2 in June; urgent: 1 and 1.
    expect(w.tags).toEqual([
      { name: 'deep', allTimeCount: 3, monthCount: 2 },
      { name: 'urgent', allTimeCount: 1, monthCount: 1 },
    ]);
    // The clientless June hour surfaced in no client row (only Acme and Globex above), and
    // the untagged entries in no tag row — the placeholder buckets are Reports' concern.
  });
});
