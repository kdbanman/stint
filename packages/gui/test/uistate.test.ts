/**
 * GOLD — the renderer's UiState snapshot, and the mock that stands in for it (issue #301).
 *
 * `buildUiState` (src/uistate.ts) is the ONE read path from core into the window: every GUI
 * surface paints what it returns. It also had zero test coverage — nothing in the tree called
 * it. What the suite checked instead was `packages/gui/judge/fixtures.mjs`, a hand-written mock
 * of its output, and the judge harness scores the real renderer against THAT. So the two ends
 * were each guarded and the join between them was not: a `buildUiState` that stopped reading a
 * stored row would keep every test green, because no test ever asked it for one and the mock
 * kept supplying the row it had dropped. That is the hole `showWeekend` fell through — it
 * reached core and `tt` while the GUI snapshot silently lacked it (#300 fixed the instance).
 *
 * Two guards, in the order they matter:
 *
 *   1. THE MOCK IS BOUND TO CORE'S ROW SET. Every fixture snapshot's settings block carries
 *      exactly `DEFAULT_SETTINGS`' keys. This is the general fix: the recurring defect is a
 *      hand-written mock drifting from the shape it stands for, and it is what makes the judge
 *      harness's 57 machine-scored items evidence about the product rather than about a fixture.
 *   2. THE REAL FUNCTION SERVES STORED VALUES, NOT DEFAULTS. Round 1 made `UiState['settings']`
 *      core's `Settings` type, so an OMITTED row now stops `tsc` — but a hardcoded WRONG value
 *      is type-valid and stays invisible. Driving the real function over a real store at
 *      non-default values is the only thing that separates "reads the row" from "restates its
 *      default", and the values below are deliberately non-default for exactly that reason.
 *
 * Core is electron-free and `Store.openMemory` needs no file, so this is a plain unit test.
 * The fixture half imports the judge's `.mjs` directly (the `qa-driver.test.ts` precedent);
 * fixtures.mjs reads the built `dist/ipc.js`, so this needs `npm run build` first — CI's order.
 */
import { describe, it, expect } from 'vitest';
import { Store, DEFAULT_SETTINGS, type Settings } from '@stint/core';
import { buildUiState } from '../src/uistate.js';
// @ts-expect-error — plain-JS apparatus module, no type declarations (the qa/driver.mjs
// precedent). That it is untyped is the whole reason the bind below exists: nothing holds
// its snapshots to `UiState`, so the settings block is checked here at runtime instead.
import * as fixtures from '../judge/fixtures.mjs';

const NOW = '2026-06-24T23:00:00Z';

/**
 * A whole non-default settings row: every key moved off its default, so no assertion below can
 * pass by accident on a value that happens to match. Chosen inside core's own validation
 * domains (snap minutes are whole 1–30 with fine ≤ coarse; the around span is 1–24 hours;
 * HH:MM is zero-padded), and written through the real `setSetting` — the same path `tt config
 * set` and the GUI's setSetting channel take.
 */
const NON_DEFAULT: Settings = {
  rounding: true,
  roundingIncrementMin: 6,
  weekStart: 'sunday',
  firstCheckinMin: 90,
  checkinIntervalMin: 15,
  globalHotkey: 'CommandOrControl+Shift+J',
  dateFormat: 'iso',
  timeZone: 'America/Edmonton',
  workingHoursStart: '09:00',
  workingHoursEnd: '15:00',
  pickerWindowMode: 'around_now',
  pickerAroundHours: 12,
  snapFineMinutes: 2,
  snapCoarseMinutes: 20,
  showWeekend: true,
  backupRetention: 10,
};

describe('GOLD — buildUiState serves the STORED settings row (#301)', () => {
  const seeded = (): Store => {
    const store = Store.openMemory(() => new Date(NOW));
    // Coarse before fine would be rejected while fine still holds the old default (5 > … is
    // fine here, but the pair rule is real), so write in an order both validations accept.
    store.setSetting('snapFineMinutes', NON_DEFAULT.snapFineMinutes);
    store.setSetting('snapCoarseMinutes', NON_DEFAULT.snapCoarseMinutes);
    for (const key of Object.keys(NON_DEFAULT) as (keyof Settings)[]) {
      if (key === 'snapFineMinutes' || key === 'snapCoarseMinutes') continue;
      store.setSetting(key, NON_DEFAULT[key] as never);
    }
    return store;
  };

  it('the fixture row is genuinely non-default (this test cannot pass on defaults)', () => {
    const same = (Object.keys(NON_DEFAULT) as (keyof Settings)[]).filter(
      (k) => NON_DEFAULT[k] === DEFAULT_SETTINGS[k],
    );
    expect(same, 'NON_DEFAULT keys still holding core’s default value').toEqual([]);
  });

  it('round-trips every stored row into the snapshot the renderer paints', () => {
    const store = seeded();
    // The whole row, compared as one — a per-key list here would go stale the moment §14 grows
    // a setting, which is the drift this file exists to stop.
    expect(buildUiState(store).settings).toEqual(NON_DEFAULT);
    // …and it is the store's own answer, not a second copy of the same literal: a snapshot
    // that restated defaults would differ from what `tt config ls` reports off the same DB.
    expect(buildUiState(store).settings).toEqual(store.settings());
  });

  it('follows a later write rather than latching what it read first', () => {
    const store = seeded();
    expect(buildUiState(store).settings.snapCoarseMinutes).toBe(20);
    store.setSetting('snapCoarseMinutes', 30);
    expect(buildUiState(store).settings.snapCoarseMinutes).toBe(30);
  });
});

/**
 * The mock↔core bind. `fixtures.mjs` is untyped `.mjs`, so nothing binds its snapshots to
 * `UiState` the way `tsc` binds the real one — its settings block is a plain object literal that
 * can carry any keys at all. It already imports `DEFAULT_SETTINGS` rather than re-typing a field
 * list; this holds every fixture to that, so a future one that hand-writes a partial settings
 * object (the exact drift that keeps recurring) fails here instead of quietly rendering scenes
 * against a settings shape core no longer serves.
 */
describe('GOLD — every judge fixture carries core’s whole settings row (#301)', () => {
  const stateFixtures = Object.entries(fixtures).filter(
    (entry): entry is [string, () => { settings?: Record<string, unknown> }] =>
      typeof entry[1] === 'function' && entry[0].endsWith('State'),
  );
  const coreKeys = Object.keys(DEFAULT_SETTINGS).sort();

  it('found the fixture set (the reader is not silently empty)', () => {
    expect(stateFixtures.length).toBeGreaterThan(20);
    expect(coreKeys.length).toBeGreaterThan(10);
  });

  it('every fixture snapshot’s settings keys are exactly core’s', () => {
    const drifted = stateFixtures
      .map(([name, make]) => ({ name, keys: Object.keys(make().settings ?? {}).sort() }))
      .filter((f) => f.keys.join(',') !== coreKeys.join(','))
      .map((f) => `${f.name} — has [${f.keys.join(', ')}]`);
    expect(drifted, 'judge fixtures whose settings block drifted from core’s row set').toEqual([]);
  });
});
