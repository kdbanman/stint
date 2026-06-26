// Canned UiState snapshots for the JUDGE harness (acceptance.html §09). Each drives
// the real renderer through an injected window.stint mock so the agent can capture
// screenshots and score them against the rubric.

const DEFAULT_SETTINGS = {
  rounding: false,
  roundingIncrementMin: 15,
  weekStart: 'monday',
  firstCheckinMin: 60,
  checkinIntervalMin: 30,
  globalHotkey: 'CommandOrControl+Alt+T',
};
const ACCENT = '#2f6fed';

export function emptyState() {
  return {
    status: { running: false, entry: null },
    days: [],
    sleepFlaggedIds: [],
    settings: DEFAULT_SETTINGS,
    accent: ACCENT,
  };
}

export function runningState() {
  // Start ~01:24:07 ago so the count-up reads a real, advancing value.
  const startUtc = new Date(Date.now() - 5047 * 1000).toISOString();
  const entry = {
    id: 1,
    description: 'auth refactor',
    clientLabel: 'Client A / API',
    startUtc,
    billableSeconds: 5047,
    billable: true,
    sleptThrough: false,
  };
  return {
    status: { running: true, entry },
    days: [
      {
        day: '2026-06-24',
        entries: [
          {
            id: 1,
            description: 'auth refactor',
            clientLabel: 'Client A / API',
            startUtc,
            endUtc: null,
            billableSeconds: 5047,
            billable: true,
            overlapped: false,
            sleptThrough: false,
            excludedSeconds: 0,
          },
        ],
      },
    ],
    sleepFlaggedIds: [],
    settings: DEFAULT_SETTINGS,
    accent: ACCENT,
  };
}

export function flaggedState() {
  return {
    status: { running: false, entry: null },
    days: [
      {
        day: '2026-06-24',
        entries: [
          {
            id: 10,
            description: 'morning block',
            clientLabel: 'Client A / API',
            startUtc: '2026-06-24T09:00:00Z',
            endUtc: '2026-06-24T11:00:00Z',
            billableSeconds: 7200,
            billable: true,
            overlapped: true,
            sleptThrough: false,
            excludedSeconds: 0,
          },
          {
            id: 11,
            description: 'client call',
            clientLabel: 'Client A / API',
            startUtc: '2026-06-24T10:00:00Z',
            endUtc: '2026-06-24T10:30:00Z',
            billableSeconds: 1800,
            billable: true,
            overlapped: true,
            sleptThrough: false,
            excludedSeconds: 0,
          },
          {
            id: 12,
            description: 'deep work (slept through)',
            clientLabel: 'Client B',
            startUtc: '2026-06-24T13:00:00Z',
            endUtc: '2026-06-24T17:00:00Z',
            billableSeconds: 14400,
            billable: true,
            overlapped: false,
            sleptThrough: true,
            excludedSeconds: 0,
          },
        ],
      },
    ],
    sleepFlaggedIds: [12],
    settings: DEFAULT_SETTINGS,
    accent: ACCENT,
  };
}

/** The mock window.stint, as an init script string parameterised by a state. */
export function initScript(stateJson) {
  return `
    window.__STATE__ = ${stateJson};
    window.stint = {
      getState: () => Promise.resolve(window.__STATE__),
      onChange: () => () => {},
      toggle: () => Promise.resolve(),
      subtractSleep: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
  `;
}
