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
  // §12 R11 / §14 — the date-format setting the GUI Settings view's control edits.
  dateFormat: 'system',
};

// A pinned wall clock so the captured evidence is byte-for-byte reproducible: the
// harness installs this as the page clock, the running fixture starts a fixed
// 01:24:07 before it, and the count-up advances only by an explicit fast-forward.
export const JUDGE_NOW = '2026-06-24T23:00:00Z';
const RUNNING_ELAPSED_S = 5047; // 01:24:07
const RUNNING_START = new Date(Date.parse(JUDGE_NOW) - RUNNING_ELAPSED_S * 1000).toISOString();

export function emptyState() {
  return {
    status: { running: false, entry: null },
    days: [],
    sleepFlaggedIds: [],
    settings: DEFAULT_SETTINGS,
  };
}

export function runningState() {
  // Fixed 01:24:07 before the pinned clock, so the count-up reads a deterministic,
  // advancing value once the harness fast-forwards its installed clock.
  const startUtc = RUNNING_START;
  const entry = {
    id: 1,
    description: 'auth refactor',
    clientLabel: 'Client A / API',
    startUtc,
    billableSeconds: RUNNING_ELAPSED_S,
    billable: true,
    sleptThrough: false,
    tags: ['deep', 'urgent'],
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
            billableSeconds: RUNNING_ELAPSED_S,
            billable: true,
            overlapped: false,
            overlapMinutes: 0,
            overlapRelation: null,
            sleptThrough: false,
            excludedSeconds: 0,
            rawSeconds: RUNNING_ELAPSED_S,
            tags: ['deep', 'urgent'],
          },
        ],
      },
    ],
    sleepFlaggedIds: [],
    settings: DEFAULT_SETTINGS,
  };
}

/**
 * §07 — the TAG_CHIPS fixture: the running/open entry plus a closed entry, each carrying
 * a known set of tags, so the scene can assert each row paints its tags as chips
 * deterministically (querySelectorAll('.chip') count == the fixture's total tag count) and
 * that the running summary shows its tags too. The open row carries 2 tags, the closed row
 * 1 — 3 chips on the rows in total, plus the 2 on the running summary line.
 */
export function taggedState() {
  const startUtc = RUNNING_START;
  const running = {
    id: 70,
    description: 'auth refactor',
    clientLabel: 'Client A / API',
    startUtc,
    billableSeconds: RUNNING_ELAPSED_S,
    billable: true,
    sleptThrough: false,
    tags: ['deep', 'urgent'],
  };
  return {
    status: { running: true, entry: running },
    days: [
      {
        day: '2026-06-24',
        entries: [
          {
            id: 70,
            description: 'auth refactor',
            clientLabel: 'Client A / API',
            startUtc,
            endUtc: null,
            billableSeconds: RUNNING_ELAPSED_S,
            billable: true,
            overlapped: false,
            overlapMinutes: 0,
            overlapRelation: null,
            sleptThrough: false,
            excludedSeconds: 0,
            rawSeconds: RUNNING_ELAPSED_S,
            tags: ['deep', 'urgent'],
          },
          {
            id: 71,
            description: 'morning block',
            clientLabel: 'Client A / API',
            startUtc: '2026-06-24T09:00:00Z',
            endUtc: '2026-06-24T11:00:00Z',
            billableSeconds: 7200,
            billable: true,
            overlapped: false,
            overlapMinutes: 0,
            overlapRelation: null,
            sleptThrough: false,
            excludedSeconds: 0,
            rawSeconds: 7200,
            tags: ['meeting'],
          },
        ],
      },
    ],
    sleepFlaggedIds: [],
    settings: DEFAULT_SETTINGS,
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
            // §12 R9: shares 30m with entry 11, which starts after it → 'next'.
            overlapMinutes: 30,
            overlapRelation: 'next',
            sleptThrough: false,
            excludedSeconds: 0,
            rawSeconds: 7200,
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
            // §12 R9: shares 30m with entry 10, which starts before it → 'previous'.
            overlapMinutes: 30,
            overlapRelation: 'previous',
            sleptThrough: false,
            excludedSeconds: 0,
            rawSeconds: 1800,
          },
          {
            id: 12,
            description: 'deep work (slept through)',
            clientLabel: 'Client B',
            startUtc: '2026-06-24T13:00:00Z',
            endUtc: '2026-06-24T17:00:00Z',
            // §12 R9: a slept entry whose billable was trimmed — the raw 4h reads struck
            // through beside the trimmed 3h billable (rawSeconds > billableSeconds).
            billableSeconds: 10800,
            billable: true,
            overlapped: false,
            overlapMinutes: 0,
            overlapRelation: null,
            sleptThrough: true,
            excludedSeconds: 3600,
            rawSeconds: 14400,
          },
        ],
      },
    ],
    sleepFlaggedIds: [12],
    settings: DEFAULT_SETTINGS,
  };
}

/**
 * A day holding both a CLOSED entry (id=30) and the running/open entry (id=31), so the
 * SPLIT_AFFORDANCE scene can assert in one snapshot that the closed row exposes a Split
 * control and the open row does not (§06 R2: only a bounded span can be split).
 */
export function splittableState() {
  const startUtc = RUNNING_START;
  const running = {
    id: 31,
    description: 'auth refactor',
    clientLabel: 'Client A / API',
    startUtc,
    billableSeconds: RUNNING_ELAPSED_S,
    billable: true,
    sleptThrough: false,
  };
  return {
    status: { running: true, entry: running },
    days: [
      {
        day: '2026-06-24',
        entries: [
          {
            id: 30,
            description: 'morning block',
            clientLabel: 'Client A / API',
            startUtc: '2026-06-24T09:00:00Z',
            endUtc: '2026-06-24T11:00:00Z',
            billableSeconds: 7200,
            billable: true,
            overlapped: false,
            sleptThrough: false,
            excludedSeconds: 0,
          },
          {
            id: 31,
            description: 'auth refactor',
            clientLabel: 'Client A / API',
            startUtc,
            endUtc: null,
            billableSeconds: RUNNING_ELAPSED_S,
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
  };
}

/**
 * A single closed entry on the pinned day, so the EDIT_INLINE scene can open the
 * inline edit form deterministically and assert the seeded field values. Closed (it
 * has an endUtc) so the form shows the full field set including End.
 */
export function editingState() {
  return {
    status: { running: false, entry: null },
    days: [
      {
        day: '2026-06-24',
        entries: [
          {
            id: 20,
            description: 'design review',
            clientLabel: 'Acme / API',
            startUtc: '2026-06-24T14:00:00Z',
            endUtc: '2026-06-24T15:30:00Z',
            billableSeconds: 5400,
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
  };
}

/**
 * §12 R6 — the INLINE_EDITOR fixture. A single CLOSED entry whose client/project match the
 * canned reference data (Acme / API → CLIENTS id 1, PROJECTS 11) so the consolidated editor
 * modal (window.SE.openEditor) opens with its Client + Project selects pre-selectable and
 * every tt-editable field present (description, client, project, start, end, tags, billable)
 * plus the Split affordance. Closed (it has an endUtc), so the editor shows the full field
 * set including End and offers Split (only a bounded span can be cut).
 */
export function editableState() {
  return {
    status: { running: false, entry: null },
    days: [
      {
        day: '2026-06-24',
        entries: [
          {
            id: 80,
            description: 'design review',
            clientLabel: 'Acme / API',
            startUtc: '2026-06-24T14:00:00Z',
            endUtc: '2026-06-24T15:30:00Z',
            billableSeconds: 5400,
            billable: true,
            overlapped: false,
            sleptThrough: false,
            excludedSeconds: 0,
            tags: ['deep'],
          },
        ],
      },
    ],
    sleepFlaggedIds: [],
    settings: DEFAULT_SETTINGS,
  };
}

/**
 * Two CLOSED, contiguous entries on the pinned day that DISAGREE on both client and
 * billable, so the MERGE_CONFLICT scene can multi-select them, click Merge, and assert
 * the conflict prompt offers the distinct client choices and a billable choice before
 * committing (§06 R3, §12 R6). The descriptions/tags differ too, but those are folded
 * unconditionally by core, so the prompt only resolves client/project + billable.
 */
export function mergeConflictState() {
  return {
    status: { running: false, entry: null },
    days: [
      {
        day: '2026-06-24',
        entries: [
          {
            id: 40,
            description: 'api work',
            clientLabel: 'Client A / API',
            startUtc: '2026-06-24T09:00:00Z',
            endUtc: '2026-06-24T10:00:00Z',
            billableSeconds: 3600,
            billable: true,
            overlapped: false,
            sleptThrough: false,
            excludedSeconds: 0,
          },
          {
            id: 41,
            description: 'internal sync',
            clientLabel: 'Client B',
            startUtc: '2026-06-24T10:00:00Z',
            endUtc: '2026-06-24T11:00:00Z',
            billableSeconds: 3600,
            billable: false,
            overlapped: false,
            sleptThrough: false,
            excludedSeconds: 0,
          },
        ],
      },
    ],
    sleepFlaggedIds: [],
    settings: DEFAULT_SETTINGS,
  };
}

/**
 * Two CLOSED, contiguous entries that AGREE on client and billable, so the
 * MERGE_NOCONFLICT scene can assert selecting both and clicking Merge fires the merge
 * directly — no conflict prompt — since there is nothing to resolve (§06 R3).
 */
export function mergeAgreeState() {
  return {
    status: { running: false, entry: null },
    days: [
      {
        day: '2026-06-24',
        entries: [
          {
            id: 50,
            description: 'morning block',
            clientLabel: 'Client A / API',
            startUtc: '2026-06-24T09:00:00Z',
            endUtc: '2026-06-24T10:00:00Z',
            billableSeconds: 3600,
            billable: true,
            overlapped: false,
            sleptThrough: false,
            excludedSeconds: 0,
          },
          {
            id: 51,
            description: 'afternoon block',
            clientLabel: 'Client A / API',
            startUtc: '2026-06-24T10:00:00Z',
            endUtc: '2026-06-24T11:00:00Z',
            billableSeconds: 3600,
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
  };
}

/**
 * A single closed entry the OVERLAP_BANNER scene edits to create an overlap. The state
 * itself carries no overlap flag yet — the banner is the AT-WRITE-TIME signal, raised by
 * the WriteAck the mock returns when the edit fires (see initScript's `overlapAck`),
 * which is independent of the durable per-row flag (§06 R4).
 */
export function overlapWriteState() {
  return {
    status: { running: false, entry: null },
    days: [
      {
        day: '2026-06-24',
        entries: [
          {
            id: 60,
            description: 'afternoon block',
            clientLabel: 'Client A / API',
            startUtc: '2026-06-24T14:00:00Z',
            endUtc: '2026-06-24T15:00:00Z',
            billableSeconds: 3600,
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
  };
}

/**
 * §07/§12 — the Clients view fixture: a couple of ACTIVE clients, each with active
 * projects, so the CLIENTS_VIEW scene can assert clients are listed with their projects
 * nested, and that each row offers rename + archive in place (archived items are excluded
 * by listClients/listProjects' default, so none appear here). The view renders from the
 * mock's listClients/listProjects (it does not read the UiState days), so the snapshot is
 * the empty-state shape; the client/project data lives in the mock methods below.
 */
const CLIENTS = [
  { id: 1, name: 'Acme', archived: false },
  { id: 2, name: 'Globex', archived: false },
];
const PROJECTS = {
  1: [
    { id: 11, clientId: 1, name: 'API', archived: false },
    { id: 12, clientId: 1, name: 'Web', archived: false },
  ],
  2: [{ id: 21, clientId: 2, name: 'Onboarding', archived: false }],
};

export function clientsState() {
  return emptyState();
}

// §12 R9 — the Entries-view dataset. A multi-entry, multi-client, multi-project, tagged
// set spanning two days, so the ENTRY_LIST_SEARCH scene can drive the search box + the
// Group-by control and observe the visible rows narrow / regroup. Shaped as the flat row
// list the listEntries mock groups (mirroring core's buildEntryList) — clientLabel/tags
// resolved, the same fields the search matches. Billable seconds are deterministic.
const LIST_ENTRIES = [
  { id: 1, description: 'auth refactor', clientLabel: 'Acme / API', client: 'Acme', project: 'API', startUtc: '2026-06-24T09:00:00Z', endUtc: '2026-06-24T11:00:00Z', billableSeconds: 7200, billable: true, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 7200, tags: ['deep'] },
  { id: 2, description: 'deploy pipeline', clientLabel: 'Globex / Ops', client: 'Globex', project: 'Ops', startUtc: '2026-06-24T11:00:00Z', endUtc: '2026-06-24T12:00:00Z', billableSeconds: 3600, billable: true, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 3600, tags: ['ci'] },
  { id: 3, description: 'standup', clientLabel: 'Acme / Web', client: 'Acme', project: 'Web', startUtc: '2026-06-23T09:00:00Z', endUtc: '2026-06-23T09:30:00Z', billableSeconds: 1800, billable: true, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 1800, tags: ['meeting', 'deep'] },
  { id: 4, description: 'refactor tests', clientLabel: 'Globex / Ops', client: 'Globex', project: 'Ops', startUtc: '2026-06-23T13:00:00Z', endUtc: '2026-06-23T14:30:00Z', billableSeconds: 5400, billable: true, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 5400, tags: ['ci'] },
];

/**
 * §12 R9 — the Entries-view list fixture. The status/timer card is idle (the scene drives
 * the entries section only); the day-grouped `days` mirror the LIST_ENTRIES set so the
 * default getState paint matches, and the initScript's listEntries mock applies the same
 * matchesQuery/group logic core does, so the headless renderer behaves like production.
 */
export function listState() {
  const byDay = {};
  for (const e of LIST_ENTRIES) {
    const day = e.startUtc.slice(0, 10);
    (byDay[day] ||= []).push(e);
  }
  const days = Object.keys(byDay)
    .sort((a, b) => b.localeCompare(a)) // newest day first
    .map((day) => ({ day, entries: byDay[day].map((e) => ({ ...e })) }));
  return {
    status: { running: false, entry: null },
    days,
    sleepFlaggedIds: [],
    settings: DEFAULT_SETTINGS,
  };
}

/**
 * §17 R11 — the LIVE_FILTER fixture. The same multi-entry / multi-client / tagged set as
 * the Entries-view list (listState), reused so a search keystroke / client selection
 * narrows BOTH the visible rows AND the live report total (#week-total) the renderer
 * derives from the in-memory snapshot (window.SU.deriveView) — no IPC round-trip. The four
 * rows are all billable (7200 + 3600 + 1800 + 5400 = 18000s = 5.00h), and a "refactor"
 * search keeps the two refactor rows (7200 + 5400 = 12600s = 3.50h), so the total visibly
 * moves 5.00h → 3.50h on the same keystroke that narrows the list.
 */
export function liveState() {
  return listState();
}

/**
 * §12 R11 — the Settings-view fixture. The panel renders from getState().settings (the
 * eight §14 settings), so the empty-state snapshot's DEFAULT_SETTINGS is enough; the
 * SETTINGS_VIEW scene opens the panel, asserts a control for every setting, and screenshots
 * the editable controls (main-settings.png) for rubric/human review.
 */
export function settingsState() {
  return emptyState();
}

/**
 * §19 R03/R04/R06 — the SOFTWARE_UPDATE scene's snapshot. The Settings view's Software Update
 * group reads its version over the GUI-only window.stint.update bridge (injected by initScript's
 * `update` option), so the snapshot itself is just the empty-state shape; the version, the
 * check verdict, and the download progress frames are supplied via UPDATE_FIXTURE below.
 */
export function softwareUpdateState() {
  return emptyState();
}

/**
 * §19 R03/R04 — the canned Software Update bridge config the SOFTWARE_UPDATE scene injects.
 *   - `version`  — the stamped APP_VERSION the Current-version row prints (R06; the SAME value
 *                  `tt --version` reports — see GOLD contracts for the one shared constant).
 *   - `verdict`  — the update-available check result (R03) Check now resolves: a newer release
 *                  with its tag + release URL, so the result line + pill paint "update available".
 *   - `progress` — the ordered progress frames download() replays over onUpdateProgress (R04):
 *                  a mid-download 'downloading' frame (drives the progress bar) and the terminal
 *                  'ready' frame, carrying the numbered guided steps incl. the one-time Gatekeeper
 *                  beat (download → replace the app → approve once at first launch, no Developer ID).
 */
export const UPDATE_FIXTURE = {
  version: '2026.6.24',
  verdict: {
    status: 'update-available',
    currentVersion: '2026.6.24',
    latestVersion: '2026.7.1',
    releaseUrl: 'https://github.com/kdbanman/stint/releases/tag/v2026.7.1',
  },
  steps: [
    'Download the new version',
    'Replace the app in /Applications (Stint reveals the installer for you)',
    'Approve once at first launch in System Settings → Privacy & Security — one-time Gatekeeper clearance, no Developer ID needed',
  ],
  progress: [
    {
      phase: 'downloading',
      percent: 42,
      version: '2026.7.1',
      steps: [
        'Download the new version',
        'Replace the app in /Applications (Stint reveals the installer for you)',
        'Approve once at first launch in System Settings → Privacy & Security — one-time Gatekeeper clearance, no Developer ID needed',
      ],
      artifactPath: null,
      message: null,
    },
    {
      phase: 'ready',
      percent: 100,
      version: '2026.7.1',
      steps: [
        'Download the new version',
        'Replace the app in /Applications (Stint reveals the installer for you)',
        'Approve once at first launch in System Settings → Privacy & Security — one-time Gatekeeper clearance, no Developer ID needed',
      ],
      artifactPath: '/tmp/stint-update/Stint-2026.7.1.pkg',
      message: null,
    },
  ],
};

/** The empty-state snapshot the START_ATTRIBUTES scene drives the Start form over. */
export function startFormState() {
  return emptyState();
}

/**
 * §12 R5 — the START_FORM scene's running snapshot. A single open/running entry, so the
 * start surface presents the dedicated Switch affordance (the atomic stop-then-start,
 * §05 R8) that only appears mid-timer; the START_FORM scene asserts the inline
 * description/client/project/tags/billable form on the idle snapshot (startFormState) and
 * that Switch is visible on THIS running one. Reuses the canonical runningState so the
 * count-up/accent stay byte-for-byte reproducible under the pinned JUDGE clock.
 */
export function switchState() {
  return runningState();
}

/** The empty-state snapshot the ADD_FORM scene drives the manual-backfill form over. */
export function addFormState() {
  return emptyState();
}

/**
 * §12 R15 (G9) — the TIME_RANGE_PICKER fixture. The manual-add form reads the snapshot's
 * CLOSED entries (via app.js snapshotEntries) so the visual picker can draw them gray on
 * its day column and paint overlaps yellow (warn-only). Two closed entries on 2026-06-24
 * (the day the scene fills #add-from/#add-to against, under the UTC-pinned picker page):
 *   - 09:00–11:00 — above the dragged span, no overlap.
 *   - 14:00–15:00 — overlaps the seeded 13:00–14:30 "me" span (14:00–14:30 → yellow).
 * The scene runs its page in timezoneId 'UTC' so these UTC instants land on the SAME local
 * day as the filled 2026-06-24T13:00 start, making the gray/overlap geometry deterministic.
 */
export function pickerState() {
  const closed = [
    { id: 1, description: 'morning sync', clientLabel: 'Acme / API', startUtc: '2026-06-24T09:00:00Z', endUtc: '2026-06-24T11:00:00Z', billableSeconds: 7200, billable: true, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 7200, tags: [] },
    { id: 2, description: 'market research', clientLabel: 'Globex / Ops', startUtc: '2026-06-24T14:00:00Z', endUtc: '2026-06-24T15:00:00Z', billableSeconds: 3600, billable: true, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 3600, tags: [] },
  ];
  return {
    status: { running: false, entry: null },
    days: [{ day: '2026-06-24', entries: closed }],
    sleepFlaggedIds: [],
    settings: DEFAULT_SETTINGS,
  };
}

/**
 * §08 R3 / §12 R8 / §09 R1 — the report-builder fixture. The report view paints from the
 * mock's window.stint.report (it does not read the UiState days), so the snapshot itself is
 * the empty-state shape; the report data lives in the keyed REPORTS below. The initScript
 * mock returns a Report keyed first by the date range (preset name, or a custom from/to),
 * then — for the default This-week range — by billableFilter. Three deterministic totals
 * for the §08 R3 billable toggle (billable-only < non-billable < all), and a distinct
 * report per §09 R1 preset (each with its own resolved range + total) so selecting a chip
 * or applying a custom range visibly changes the painted range header and rows.
 */
export function reportState() {
  return emptyState();
}

/**
 * §09 R6 / §12 R8 — the report-SUMMARY fixture. The REPORT_SUMMARY scene drives the
 * on-screen grouped summary with flags surfaced in context and the two Export buttons. The
 * report itself (REPORT_SUMMARY below) is a client→project nested grouping carrying ONE
 * overlap flag and ONE unreviewed-sleep flag on distinct affected sub-rows, so the scene can
 * assert the flags appear ON the affected summary rows (not in a separate list). The mock's
 * exportEntries records the requested format + range and returns a written-shaped result so
 * the scene can assert the Export CSV / Export JSON buttons drive a real export call.
 */
export function reportSummaryState() {
  return emptyState();
}

/**
 * §12 R08 / §09 R08–R09 — the saved-reports fixture. emptyState plus a seeded list of saved
 * report definitions (window.stint.listReports returns SAVED_REPORTS below). The REPORTS_VIEW
 * scene drives the real in-shell Reports view: the saved-definition list paints one card per
 * def (name + spec summary + Run/Edit affordances); + New report / Edit opens the inline
 * builder; Run paints the grouped run-output with flags in context; Export CSV/JSON drive a
 * real exportEntries call carrying the saved ref; and the sidebar stays present with Reports
 * active. The mock's runReport returns the flag-carrying REPORT_SUMMARY report so the run-
 * output paints overlap + unreviewed-sleep flags on the affected rows (reusing the
 * REPORT_SUMMARY shape).
 */
export function savedReportsState() {
  return emptyState();
}

/**
 * §09 R09 — the saved-report run-output fixture. Same as savedReportsState (the run-output
 * is driven by clicking Run on a card); kept as a named entry point so a scene reads clearly.
 */
export function savedReportSummaryState() {
  return emptyState();
}

/**
 * §09 R4 — the rounding-toggle fixture. Settings carry rounding ON at the default 15-min
 * increment, so the report view loads with the toggle checked and the increment picker
 * enabled; the ROUNDING_TOGGLE scene then drives the toggle off/on and the increment
 * picker (6/10/15/30) and asserts the displayed billable line equals the rounded total
 * when on and the exact total when off. The report itself is keyed by rounding/increment
 * (REPORT_BY_ROUNDING) against a total that is NOT a clean multiple of any increment, so
 * the line visibly moves. Stored time is never touched — only the displayed line rounds.
 */
export function roundingState() {
  const s = emptyState();
  s.settings = { ...DEFAULT_SETTINGS, rounding: true, roundingIncrementMin: 15 };
  return s;
}

/**
 * §12 R14 (G5) — the TIMER_VIEW fixture. The same canonical runningState (a single open entry
 * 'auth refactor' for 'Client A / API', started a fixed 01:24:07 before the pinned JUDGE clock),
 * so the Timer view's live clock reads a deterministic 01:24:07 that advances +3s on a pinned-
 * clock step, the running state shows, and the live-edit-running strip seeds from this entry. The
 * scene asserts the strip's Save sends an `edit` patch carrying the start-time/attributes but
 * NEVER endUtc (window.__EDITED__ recorded by the edit mock), so the row stays open.
 */
export function timerViewRunningState() {
  return runningState();
}

/** §05 R09 — three seeded favorites for the FAVORITES_RAIL scene (name + client/project/billable
 * meta + a one-click Resume), so the rail paints one row per FavoriteView deterministically. */
export const FAVORITES = [
  { id: 10, name: 'Standup', description: 'daily standup', clientId: 1, projectId: 2, billable: false, tags: ['daily'] },
  { id: 11, name: 'Deep work', description: 'focus block', clientId: 1, projectId: 3, billable: true, tags: ['deep'] },
  { id: 12, name: 'Admin / email', description: null, clientId: null, projectId: null, billable: true, tags: ['admin'] },
];

/**
 * §05 R09 / §12 R14 — the FAVORITES_RAIL fixture. The running snapshot (so the Pin-as-favorite
 * affordance reads the open entry) plus the seeded FAVORITES list the listFavorites mock returns;
 * the scene asserts one rail row per favorite, a one-click Resume firing startFavorite({name})
 * exactly once, the Pin/kebab affordances, and that window.stint exposes a callable method for
 * each of the five favorite channels.
 */
export function timerViewFavoritesState() {
  return runningState();
}

/** §05 R09 — the empty-favorites variant: idle, with NO favorites seeded, so the rail paints its
 * empty state ('pin a favorite' / mentions `tt fav`) the FAVORITES_RAIL scene asserts. */
export function timerViewEmptyFavoritesState() {
  return emptyState();
}

// Deterministic Report objects keyed by billableFilter, so the three-way Billable toggle
// changes the reported total under the pinned JUDGE clock. Totals chosen distinct:
// billable only 5h, non-billable 3h, all 8h (= 5h + 3h).
const REPORT_BY_FILTER = {
  billable: {
    lines: [{ key: 'Acme', children: [], entryIds: [1], totalSeconds: 18000, roundedSeconds: 18000 }],
    grandTotalSeconds: 18000,
    grandRoundedSeconds: 18000,
    overlappedEntryIds: [],
    unreviewedSleepEntryIds: [],
    options: { by: 'client', billableFilter: 'billable', rounding: false, roundingIncrementMin: 15 },
    rangeFromUtc: '2026-06-22T00:00:00.000Z',
    rangeToUtc: '2026-06-29T00:00:00.000Z',
  },
  'non-billable': {
    lines: [{ key: '(no client)', children: [], entryIds: [2], totalSeconds: 10800, roundedSeconds: 10800 }],
    grandTotalSeconds: 10800,
    grandRoundedSeconds: 10800,
    overlappedEntryIds: [],
    unreviewedSleepEntryIds: [],
    options: { by: 'client', billableFilter: 'non-billable', rounding: false, roundingIncrementMin: 15 },
    rangeFromUtc: '2026-06-22T00:00:00.000Z',
    rangeToUtc: '2026-06-29T00:00:00.000Z',
  },
  all: {
    lines: [
      { key: '(no client)', children: [], entryIds: [2], totalSeconds: 10800, roundedSeconds: 10800 },
      { key: 'Acme', children: [], entryIds: [1], totalSeconds: 18000, roundedSeconds: 18000 },
    ],
    grandTotalSeconds: 28800,
    grandRoundedSeconds: 28800,
    overlappedEntryIds: [],
    unreviewedSleepEntryIds: [],
    options: { by: 'client', billableFilter: 'all', rounding: false, roundingIncrementMin: 15 },
    rangeFromUtc: '2026-06-22T00:00:00.000Z',
    rangeToUtc: '2026-06-29T00:00:00.000Z',
  },
};

// §09 R1 — deterministic Report objects keyed by the date-range PRESET, so selecting a
// chip visibly changes the painted resolved-range header and the grouped rows. Each range
// mirrors what core's resolveRange would return for the pinned JUDGE clock under a Monday
// week start (the renderer never derives these — the mock stands in for core's resolution).
// Totals are distinct per preset so a chip change is observable; the default 'week' preset
// is intentionally OMITTED here so the existing billable-toggle path (keyed by filter) is
// untouched — week falls through to REPORT_BY_FILTER below.
const REPORT_BY_PRESET = {
  today: {
    lines: [{ key: 'Acme', children: [], entryIds: [1], totalSeconds: 3600, roundedSeconds: 3600 }],
    grandTotalSeconds: 3600,
    grandRoundedSeconds: 3600,
    overlappedEntryIds: [],
    unreviewedSleepEntryIds: [],
    options: { by: 'client', billableFilter: 'billable', rounding: false, roundingIncrementMin: 15 },
    rangeFromUtc: '2026-06-24T00:00:00.000Z',
    rangeToUtc: '2026-06-25T00:00:00.000Z',
  },
  'last-week': {
    lines: [{ key: 'Globex', children: [], entryIds: [3], totalSeconds: 25200, roundedSeconds: 25200 }],
    grandTotalSeconds: 25200,
    grandRoundedSeconds: 25200,
    overlappedEntryIds: [],
    unreviewedSleepEntryIds: [],
    options: { by: 'client', billableFilter: 'billable', rounding: false, roundingIncrementMin: 15 },
    rangeFromUtc: '2026-06-15T00:00:00.000Z',
    rangeToUtc: '2026-06-22T00:00:00.000Z',
  },
  month: {
    lines: [{ key: 'Acme', children: [], entryIds: [1, 4], totalSeconds: 90000, roundedSeconds: 90000 }],
    grandTotalSeconds: 90000,
    grandRoundedSeconds: 90000,
    overlappedEntryIds: [],
    unreviewedSleepEntryIds: [],
    options: { by: 'client', billableFilter: 'billable', rounding: false, roundingIncrementMin: 15 },
    rangeFromUtc: '2026-06-01T00:00:00.000Z',
    rangeToUtc: '2026-07-01T00:00:00.000Z',
  },
  'last-month': {
    lines: [{ key: 'Acme', children: [], entryIds: [5], totalSeconds: 54000, roundedSeconds: 54000 }],
    grandTotalSeconds: 54000,
    grandRoundedSeconds: 54000,
    overlappedEntryIds: [],
    unreviewedSleepEntryIds: [],
    options: { by: 'client', billableFilter: 'billable', rounding: false, roundingIncrementMin: 15 },
    rangeFromUtc: '2026-05-01T00:00:00.000Z',
    rangeToUtc: '2026-06-01T00:00:00.000Z',
  },
};

// §09 R2 — deterministic Report objects keyed by the GROUP-BY value, so switching the
// Group-by segment (Client / Project / Day / Tag) visibly regroups the SAME week's time
// into different lines while the grand total stays put (grouping is invariant on the
// total — the property the GUI control relies on). Consulted only for the default
// This-week + billable-only request (the report view's load default), so the existing
// billable-toggle and range-picker paths (keyed by filter / preset) are untouched. The
// `client` grouping is intentionally identical to REPORT_BY_FILTER.billable (Acme 5h) so
// the REPORT_BILLABLE_TOGGLE scene's default total is unchanged. Every grouping totals 5h.
const REPORT_BY_GROUP = {
  client: {
    lines: [
      { key: 'Acme', children: [], entryIds: [1], totalSeconds: 7200, roundedSeconds: 7200 },
      { key: 'Globex', children: [], entryIds: [2], totalSeconds: 10800, roundedSeconds: 10800 },
    ],
    grandTotalSeconds: 18000,
    grandRoundedSeconds: 18000,
    overlappedEntryIds: [],
    unreviewedSleepEntryIds: [],
    options: { by: 'client', billableFilter: 'billable', rounding: false, roundingIncrementMin: 15 },
    rangeFromUtc: '2026-06-22T00:00:00.000Z',
    rangeToUtc: '2026-06-29T00:00:00.000Z',
  },
  project: {
    lines: [
      { key: 'API', children: [], entryIds: [1], totalSeconds: 7200, roundedSeconds: 7200 },
      { key: 'Ops', children: [], entryIds: [2], totalSeconds: 10800, roundedSeconds: 10800 },
    ],
    grandTotalSeconds: 18000,
    grandRoundedSeconds: 18000,
    overlappedEntryIds: [],
    unreviewedSleepEntryIds: [],
    options: { by: 'project', billableFilter: 'billable', rounding: false, roundingIncrementMin: 15 },
    rangeFromUtc: '2026-06-22T00:00:00.000Z',
    rangeToUtc: '2026-06-29T00:00:00.000Z',
  },
  day: {
    lines: [
      { key: '2026-06-23', children: [], entryIds: [2], totalSeconds: 10800, roundedSeconds: 10800 },
      { key: '2026-06-24', children: [], entryIds: [1], totalSeconds: 7200, roundedSeconds: 7200 },
    ],
    grandTotalSeconds: 18000,
    grandRoundedSeconds: 18000,
    overlappedEntryIds: [],
    unreviewedSleepEntryIds: [],
    options: { by: 'day', billableFilter: 'billable', rounding: false, roundingIncrementMin: 15 },
    rangeFromUtc: '2026-06-22T00:00:00.000Z',
    rangeToUtc: '2026-06-29T00:00:00.000Z',
  },
  tag: {
    // The 2h entry carries two tags, so it lands under BOTH deep and urgent (§09 tag fan-out);
    // the grand total is still 5h (it counts each entry once, not each tag-line).
    lines: [
      { key: 'deep', children: [], entryIds: [1], totalSeconds: 7200, roundedSeconds: 7200 },
      { key: 'meeting', children: [], entryIds: [2], totalSeconds: 10800, roundedSeconds: 10800 },
      { key: 'urgent', children: [], entryIds: [1], totalSeconds: 7200, roundedSeconds: 7200 },
    ],
    grandTotalSeconds: 18000,
    grandRoundedSeconds: 18000,
    overlappedEntryIds: [],
    unreviewedSleepEntryIds: [],
    options: { by: 'tag', billableFilter: 'billable', rounding: false, roundingIncrementMin: 15 },
    rangeFromUtc: '2026-06-22T00:00:00.000Z',
    rangeToUtc: '2026-06-29T00:00:00.000Z',
  },
};

// §09 R3 — deterministic Report objects keyed by the CLIENT filter id, so selecting a
// client in the report's client filter visibly narrows the painted rows + total. Keyed by
// the canned CLIENTS ids (1 = Acme, 2 = Globex); the filtered report carries only that
// client's line and a smaller total than the unfiltered This-week default (5h), so the
// REPORT_FILTERS scene can assert the control actually re-queried and the rows changed.
const REPORT_BY_CLIENT = {
  1: {
    lines: [{ key: 'Acme', children: [], entryIds: [1], totalSeconds: 7200, roundedSeconds: 7200 }],
    grandTotalSeconds: 7200,
    grandRoundedSeconds: 7200,
    overlappedEntryIds: [],
    unreviewedSleepEntryIds: [],
    options: { by: 'client', billableFilter: 'billable', rounding: false, roundingIncrementMin: 15 },
    rangeFromUtc: '2026-06-22T00:00:00.000Z',
    rangeToUtc: '2026-06-29T00:00:00.000Z',
  },
  2: {
    lines: [{ key: 'Globex', children: [], entryIds: [2], totalSeconds: 5400, roundedSeconds: 5400 }],
    grandTotalSeconds: 5400,
    grandRoundedSeconds: 5400,
    overlappedEntryIds: [],
    unreviewedSleepEntryIds: [],
    options: { by: 'client', billableFilter: 'billable', rounding: false, roundingIncrementMin: 15 },
    rangeFromUtc: '2026-06-22T00:00:00.000Z',
    rangeToUtc: '2026-06-29T00:00:00.000Z',
  },
};

// §09 R3 — the report a TAG filter returns. A distinct line + total so typing a tag into
// the tag filter visibly re-queries and narrows the rows (the renderer sends `tag` only
// when non-blank — the mock keys on its presence, not the exact value).
const REPORT_BY_TAG = {
  lines: [{ key: 'Acme', children: [], entryIds: [1], totalSeconds: 3600, roundedSeconds: 3600 }],
  grandTotalSeconds: 3600,
  grandRoundedSeconds: 3600,
  overlappedEntryIds: [],
  unreviewedSleepEntryIds: [],
  options: { by: 'client', billableFilter: 'billable', rounding: false, roundingIncrementMin: 15 },
  rangeFromUtc: '2026-06-22T00:00:00.000Z',
  rangeToUtc: '2026-06-29T00:00:00.000Z',
};

// §09 R4 — the report the ROUNDING_TOGGLE scene drives. The single billable line totals
// 1h 37m (5820s) — deliberately NOT a clean multiple of any offered increment — so the
// displayed billable line VISIBLY differs between rounding off (exact 5820s) and on. The
// rounded values are core's nearest-increment results (never re-derived in the renderer),
// and they demonstrate nearest-NOT-always-up: nearest 15 → 1h30m (5400s, 97min rounds DOWN
// to 90), nearest 30 → 1h30m (5400s), nearest 10 → 1h40m (6000s), nearest 6 → 1h36m (5760s).
// One report object per increment, plus the exact (rounding off) view, all over the same
// week so only the rounding choice moves the line.
const ROUND_EXACT_S = 5820; // 1h 37m — not a multiple of 6/10/15/30 min
const ROUNDED_BY_INCREMENT = { 6: 5760, 10: 6000, 15: 5400, 30: 5400 };
function roundingReport(incrementMin) {
  const rounded = ROUNDED_BY_INCREMENT[incrementMin] ?? ROUND_EXACT_S;
  return {
    lines: [{ key: 'Acme', children: [], entryIds: [1], totalSeconds: ROUND_EXACT_S, roundedSeconds: rounded }],
    grandTotalSeconds: ROUND_EXACT_S,
    grandRoundedSeconds: rounded,
    overlappedEntryIds: [],
    unreviewedSleepEntryIds: [],
    options: { by: 'client', billableFilter: 'billable', rounding: true, roundingIncrementMin: incrementMin },
    rangeFromUtc: '2026-06-22T00:00:00.000Z',
    rangeToUtc: '2026-06-29T00:00:00.000Z',
  };
}
const REPORT_BY_ROUNDING = {
  6: roundingReport(6),
  10: roundingReport(10),
  15: roundingReport(15),
  30: roundingReport(30),
};

// §09 R1 — the report the custom-range path returns. Distinct range + total so applying a
// custom from/to visibly repaints the resolved-range header and rows. The mock echoes the
// requested from/to back as the resolved range (the renderer passes them straight through).
const CUSTOM_REPORT = {
  lines: [{ key: 'Acme', children: [], entryIds: [6], totalSeconds: 12600, roundedSeconds: 12600 }],
  grandTotalSeconds: 12600,
  grandRoundedSeconds: 12600,
  overlappedEntryIds: [],
  unreviewedSleepEntryIds: [],
  options: { by: 'client', billableFilter: 'billable', rounding: false, roundingIncrementMin: 15 },
  rangeFromUtc: '2026-06-10T00:00:00.000Z',
  rangeToUtc: '2026-06-13T00:00:00.000Z',
};

// §09 R6 — the report the REPORT_SUMMARY scene drives. A client→project NESTED grouping
// (so the summary shows group rows with indented sub-rows), carrying ONE overlap flag and
// ONE unreviewed-sleep flag on distinct affected leaf entries — surfaced IN CONTEXT on the
// affected summary rows via the report's overlapped / unreviewed-sleep id sets. Globex / Q3
// Strategy (entry 2) overlaps; Initech / Market research (entry 4) has unreviewed sleep.
const REPORT_SUMMARY = {
  lines: [
    {
      key: 'Globex',
      children: [
        { key: 'Project Alpha', children: [], entryIds: [1], totalSeconds: 27000, roundedSeconds: 27000 },
        { key: 'Q3 Strategy', children: [], entryIds: [2], totalSeconds: 33600, roundedSeconds: 33600 },
      ],
      entryIds: [1, 2],
      totalSeconds: 60600,
      roundedSeconds: 60600,
    },
    {
      key: 'Initech',
      children: [
        { key: 'Market research', children: [], entryIds: [4], totalSeconds: 17100, roundedSeconds: 17100 },
      ],
      entryIds: [4],
      totalSeconds: 17100,
      roundedSeconds: 17100,
    },
  ],
  grandTotalSeconds: 77700,
  grandRoundedSeconds: 77700,
  overlappedEntryIds: [2],
  unreviewedSleepEntryIds: [4],
  options: { by: 'client', billableFilter: 'billable', rounding: false, roundingIncrementMin: 15 },
  rangeFromUtc: '2026-06-22T00:00:00.000Z',
  rangeToUtc: '2026-06-29T00:00:00.000Z',
};

// §12 R08 / §09 R08 — the seeded saved report definitions the Reports view's REPORTS_VIEW
// scene lists. Each is the renderer-safe SavedReportView shape (the mirror of core's
// SavedReport): a relative preset or absolute range-spec + group-by + billable + rounding.
// Distinct so the list paints recognisable cards (name + spec summary) and Edit re-opens the
// matching def. listReports returns these; showReport looks one up by name; runReport returns
// the flag-carrying REPORT_SUMMARY report so the run-output paints flags in context.
const SAVED_REPORTS = [
  {
    id: 1,
    name: 'Weekly billables — Globex',
    rangeSpec: { kind: 'preset', preset: 'week' },
    by: 'project',
    billableFilter: 'billable',
    clientId: 2,
    rounding: false,
    roundingIncrementMin: 15,
    createdUtc: '2026-06-20T10:00:00.000Z',
  },
  {
    id: 2,
    name: 'Monthly — all clients by client',
    rangeSpec: { kind: 'preset', preset: 'last-month' },
    by: 'client',
    billableFilter: 'all',
    rounding: true,
    roundingIncrementMin: 15,
    createdUtc: '2026-06-18T10:00:00.000Z',
  },
];

/**
 * The mock window.stint, as an init script string parameterised by a state. When
 * `overlap` is true, every write resolves to a WriteAck carrying an overlap warning —
 * so the OVERLAP_BANNER scene can drive a real write and assert the inline banner
 * appears (§06 R4). Otherwise writes resolve to an empty-warnings ack.
 */
export function initScript(stateJson, { overlap = false, rounding = false, summary = false, favorites = FAVORITES, update = null, switchOnStart = false } = {}) {
  return `
    window.__STATE__ = ${stateJson};
    // §05 R01 (RECORD only) — when set, the start mock performs core's atomic stop-then-start
    // ON the injected snapshot: it closes any currently-open row at the pinned now and inserts a
    // single fresh open row from the submitted attributes, so the subsequent load()/getState
    // repaint visibly SHOWS the previous timer stopping and the new entry becoming the one live
    // count-up (the start-while-running switch). Off by default → JUDGE's start mock is unchanged.
    window.__SWITCH_ON_START__ = ${switchOnStart ? 'true' : 'false'};
    window.__JUDGE_NOW__ = '${JUDGE_NOW}';
    // §09 R6: in the REPORT_SUMMARY scene the report mock routes EVERY report request to the
    // single flag-carrying REPORT_SUMMARY report, so the summary always paints the nested
    // grouping with the overlap + unreviewed-sleep flags on their affected rows.
    window.__SUMMARY_SCENE__ = ${summary ? 'true' : 'false'};
    // §09 R4: in the ROUNDING_TOGGLE scene the report mock routes EVERY report request to
    // the rounding-keyed reports (REPORT_BY_ROUNDING), so the SAME underlying total drives
    // both the rounding-off (exact) and rounding-on (rounded) views — the renderer chooses
    // which to display via lineSeconds(). Off otherwise, so the other report scenes are
    // untouched (they fall through to the filter/preset/group reports below).
    window.__ROUNDING_SCENE__ = ${rounding ? 'true' : 'false'};
    // §06 R4: the WriteAck a write IPC channel returns. With overlap on, it mirrors the
    // shape main.ts forwards from core's overlap Warning; the renderer reads it to decide
    // whether to raise the inline overlap banner.
    window.__ACK__ = ${
      overlap
        ? `{ warnings: [{ kind: 'overlap', message: 'entry 60 overlaps 1 other entry (10); allowed but flagged in reports', overlapsWith: [10] }] }`
        : `{ warnings: [] }`
    };
    window.__GETSTATE_CALLS__ = 0;
    window.stint = {
      // §17 R11: count getState calls so the LIVE_FILTER scene can assert a search keystroke
      // updates the list + the report total LIVE off the in-memory snapshot, with NO getState
      // round-trip during the keystroke (the live derivation never reloads).
      getState: () => { window.__GETSTATE_CALLS__++; return Promise.resolve(window.__STATE__); },
      onChange: () => () => {},
      // §12 R9: the Entries-view control bar's read-only query. The mock applies the SAME
      // matchesQuery (case-insensitive substring over description / client / project / tag)
      // and grouping (day DESC, others ASC; tags fan out) core's buildEntryList does, over
      // the canned LIST_ENTRIES set, so the headless renderer narrows / regroups exactly as
      // production. Returns the grouped shape the renderer paints: { key, billableSeconds,
      // entries } per group, plus the (echoed) resolved range.
      __LIST_ENTRIES__: ${JSON.stringify(LIST_ENTRIES)},
      listEntries: function (q) {
        window.__LIST_REQ__ = q;
        let rows = this.__LIST_ENTRIES__.slice();
        if (q && q.billable === 'billable') rows = rows.filter((e) => e.billable);
        if (q && q.billable === 'non-billable') rows = rows.filter((e) => !e.billable);
        if (q && q.search) {
          const needle = String(q.search).trim().toLowerCase();
          rows = rows.filter((e) => {
            const hay = [e.description, e.client, e.project, ...(e.tags || [])];
            return hay.some((h) => h != null && String(h).toLowerCase().includes(needle));
          });
        }
        const keysOf = (e) => {
          const by = (q && q.by) || 'day';
          if (by === 'day') return [e.startUtc.slice(0, 10)];
          if (by === 'client') return [e.client || '(no client)'];
          if (by === 'project') return [e.project || '(no project)'];
          return (e.tags && e.tags.length) ? e.tags : ['(untagged)'];
        };
        const map = new Map();
        for (const e of rows) for (const k of keysOf(e)) {
          if (!map.has(k)) map.set(k, []);
          map.get(k).push(e);
        }
        let keys = [...map.keys()].sort((a, b) => a.localeCompare(b));
        if (!q || (q.by || 'day') === 'day') keys.reverse();
        const groups = keys.map((key) => ({
          key,
          billableSeconds: map.get(key).reduce((s, e) => s + e.billableSeconds, 0),
          entries: map.get(key).map((e) => ({ ...e })),
        }));
        return Promise.resolve({ groups, rangeFromUtc: '2026-06-22T00:00:00.000Z', rangeToUtc: '2026-06-29T00:00:00.000Z' });
      },
      toggle: () => Promise.resolve(window.__ACK__),
      // Records the attributed-start payload so the harness can assert the Start form
      // sends description/client/project/tags/billable (not a parameterless start).
      start: (p) => {
        window.__STARTED__ = p;
        // §05 R01 (RECORD): emulate core's atomic stop-then-start on the snapshot so the
        // recording shows the switch. Close the open row at the pinned now, then make the
        // submitted attributes the single new open row; getState repaints the new live count-up.
        if (window.__SWITCH_ON_START__ && window.__STATE__) {
          const now = window.__JUDGE_NOW__;
          const st = window.__STATE__;
          const day = now.slice(0, 10);
          for (const d of (st.days || [])) {
            for (const e of d.entries) {
              if (e.endUtc == null) {
                e.endUtc = now;
                const sec = Math.max(0, Math.round((Date.parse(now) - Date.parse(e.startUtc)) / 1000) - (e.excludedSeconds || 0));
                e.billableSeconds = sec;
                e.rawSeconds = sec;
              }
            }
          }
          const tags = Array.isArray(p && p.tags) ? p.tags.slice() : [];
          const fresh = {
            id: 200,
            description: (p && p.description) || null,
            clientLabel: [(p && p.client) || null, (p && p.project) || null].filter(Boolean).join(' / ') || null,
            startUtc: now,
            endUtc: null,
            billableSeconds: 0,
            billable: !(p && p.billable === false),
            overlapped: false, overlapMinutes: 0, overlapRelation: null,
            sleptThrough: false, excludedSeconds: 0, rawSeconds: 0,
            tags,
          };
          let dayBlock = (st.days || []).find((d) => d.day === day);
          if (!dayBlock) { dayBlock = { day, entries: [] }; (st.days ||= []).unshift(dayBlock); }
          dayBlock.entries.unshift(fresh);
          st.status = { running: true, entry: { id: fresh.id, description: fresh.description, clientLabel: fresh.clientLabel, startUtc: now, billableSeconds: 0, billable: fresh.billable, sleptThrough: false, tags } };
        }
        return Promise.resolve(window.__ACK__);
      },
      // Records the backfill payload so the harness can assert the Add form sends an
      // explicit from/to plus the same attributes tt add accepts. Returns the uniform
      // WriteAck (window.__ACK__) so a backfill that lands on an overlap (overlap scene)
      // carries the warning the renderer raises into the non-blocking inline banner — the
      // entry still saved (§06 R4) — and otherwise an empty-warnings ack so the form closes.
      add: (p) => { window.__ADDED__ = p; return Promise.resolve(window.__ACK__); },
      // §07: the reference-data reads/mutators the Clients view drives. listClients /
      // listProjects return the canned active clients/projects (archived excluded by
      // default); the mutators record their payload so the CLIENTS_VIEW scene can assert
      // the rename/archive affordances send the entity id over the same IPC tt uses.
      __CLIENTS__: ${JSON.stringify(CLIENTS)},
      __PROJECTS__: ${JSON.stringify(PROJECTS)},
      listClients: function () { return Promise.resolve(this.__CLIENTS__); },
      listProjects: function (p) { return Promise.resolve((this.__PROJECTS__[(p && p.clientId)] || [])); },
      addClient: (p) => { window.__ADDED_CLIENT__ = p; return Promise.resolve({ id: 99, name: (p && p.name) || '', archived: false }); },
      addProject: (p) => { window.__ADDED_PROJECT__ = p; return Promise.resolve({ id: 98, clientId: (p && p.clientId), name: (p && p.name) || '', archived: false }); },
      renameClient: (p) => { window.__RENAMED_CLIENT__ = p; return Promise.resolve(); },
      archiveClient: (p) => { window.__ARCHIVED_CLIENT__ = p; return Promise.resolve(); },
      renameProject: (p) => { window.__RENAMED_PROJECT__ = p; return Promise.resolve(); },
      archiveProject: (p) => { window.__ARCHIVED_PROJECT__ = p; return Promise.resolve(); },
      // §12 R10: the tag-management channels the Clients view's tag strip drives (parity
      // with tt tag ls/add/rename/archive). listTags returns the canned active tags; the
      // mutators record their payload so a scene could assert what the strip sends. Present
      // here so window.stint exposes EVERY IPC channel — the PARITY_REACH deterministic
      // sub-fact (every channel has a window.stint method) reads this surface.
      __TAGS__: [{ id: 1, name: 'deep', archived: false }, { id: 2, name: 'urgent', archived: false }],
      listTags: function () { return Promise.resolve(this.__TAGS__); },
      addTag: (p) => { window.__ADDED_TAG__ = p; return Promise.resolve({ id: 97, name: (p && p.name) || '', archived: false }); },
      renameTag: (p) => { window.__RENAMED_TAG__ = p; return Promise.resolve(); },
      archiveTag: (p) => { window.__ARCHIVED_TAG__ = p; return Promise.resolve(); },
      // §09 R7: the free-text search the search box drives (parity with tt list --search).
      // Returns the same UiState the renderer paints from, narrowed to matching rows — the
      // mock applies the SAME case-insensitive substring match over description/client/project/
      // tag the listEntries mock and core's filter use, so a search scene narrows like production.
      search: function (q) {
        window.__SEARCH_REQ__ = q;
        const needle = String(q || '').trim().toLowerCase();
        const base = window.__STATE__;
        if (!needle) return Promise.resolve(base);
        const days = (base.days || []).map((d) => ({
          day: d.day,
          entries: d.entries.filter((e) => {
            const hay = [e.description, e.clientLabel, ...(e.tags || [])];
            return hay.some((h) => h != null && String(h).toLowerCase().includes(needle));
          }),
        })).filter((d) => d.entries.length > 0);
        return Promise.resolve({ ...base, days });
      },
      subtractSleep: () => Promise.resolve(),
      // Records that a removal actually fired, so the DELETE_CONFIRM / CONFIRM_DELETE
      // scenes can assert the first Delete click only ARMS the confirm step and does not
      // remove yet. __REMOVED__ is the boolean the legacy DELETE_CONFIRM reads; __REMOVE_CALLS__
      // records each invocation's payload so CONFIRM_DELETE (§12 R13) can assert remove fired
      // EXACTLY ONCE, and only from the explicit confirm — never the stray first click.
      remove: (p) => {
        window.__REMOVED__ = true;
        (window.__REMOVE_CALLS__ ||= []).push(p);
        // §17 R11: drop the removed entry from the snapshot so the subsequent load()/getState
        // reflects the deletion — the CONFIRM_DESTRUCTIVE scene can then assert the entry is
        // PRESENT before the confirm and GONE after it (a real destroy, only on confirm).
        if (p && p.id != null && window.__STATE__ && Array.isArray(window.__STATE__.days)) {
          for (const d of window.__STATE__.days) d.entries = d.entries.filter((e) => e.id !== p.id);
          window.__STATE__.days = window.__STATE__.days.filter((d) => d.entries.length > 0);
        }
        return Promise.resolve();
      },
      stop: () => Promise.resolve(window.__ACK__),
      resume: () => Promise.resolve(window.__ACK__),
      // Records the edit payload so the harness can assert inline editing of the
      // running entry sends a patch that never carries endUtc (so it cannot stop it).
      // Returns the WriteAck so the OVERLAP_BANNER scene can drive an overlapping edit.
      edit: (p) => { window.__EDITED__ = p; return Promise.resolve(window.__ACK__); },
      // Records the split payload so the SPLIT_AFFORDANCE scene can drive the inline
      // picker without erroring; core owns the in-span rule, so the mock just resolves.
      split: (p) => { window.__SPLIT__ = p; return Promise.resolve(window.__ACK__); },
      // Records the merge payload so the MERGE_CONFLICT / MERGE_NOCONFLICT scenes can
      // assert what the conflict prompt (or direct merge) sends — { ids, winnerId,
      // billable }; core owns the actual fold, so the mock just resolves.
      merge: (p) => { window.__MERGED__ = p; return Promise.resolve(window.__ACK__); },
      // §09 R4: the report view's Rounding controls persist the choice through setSetting
      // (the same channel tt config set uses — parity-covered, no new channel). The mock
      // records the last payload so the ROUNDING_TOGGLE scene can assert the toggle and the
      // increment picker send { key:'rounding' } / { key:'roundingIncrementMin' }; core owns
      // the actual persistence, so the mock just resolves (and mirrors the value into the
      // injected settings so a re-read would reflect it).
      setSetting: function (p) {
        window.__SET_SETTING__ = p;
        if (p && p.key && window.__STATE__ && window.__STATE__.settings) {
          window.__STATE__.settings[p.key] = p.value;
        }
        return Promise.resolve();
      },
      // §20 R04–R05 / §17 R12: the Settings → Backups section. listBackups returns the canned
      // backups (the restore list + "Last backup" status); restoreBackup records its payload so a
      // scene could assert the Restore… action's argument. Present here so window.stint exposes
      // EVERY IPC channel — the PARITY_REACH deterministic sub-fact reads this surface.
      __BACKUPS__: [
        { name: 'timetracker.sqlite.bak-20260627T101500Z', path: '/db/timetracker.sqlite.bak-20260627T101500Z', createdUtc: '2026-06-27T10:15:00Z', sizeBytes: 40960 },
        { name: 'timetracker.sqlite.bak-20260626T090000Z', path: '/db/timetracker.sqlite.bak-20260626T090000Z', createdUtc: '2026-06-26T09:00:00Z', sizeBytes: 36864 },
      ],
      listBackups: function () { return Promise.resolve(this.__BACKUPS__); },
      restoreBackup: (p) => {
        window.__RESTORED_BACKUP__ = p;
        return Promise.resolve({ recoveredFrom: (p && p.name) || '', quarantinedTo: '/db/timetracker.sqlite.replaced-20260627T120000Z' });
      },
      // §08 R3 / §12 R8: the report builder calls this on load and on every control
      // change. Records the request (so the harness can assert the billableFilter the
      // Billable toggle passes) and returns a deterministic Report keyed by that filter,
      // so switching the toggle visibly changes the rendered total.
      __REPORTS__: ${JSON.stringify(REPORT_BY_FILTER)},
      __REPORTS_BY_PRESET__: ${JSON.stringify(REPORT_BY_PRESET)},
      __REPORTS_BY_GROUP__: ${JSON.stringify(REPORT_BY_GROUP)},
      __REPORTS_BY_CLIENT__: ${JSON.stringify(REPORT_BY_CLIENT)},
      __REPORT_BY_TAG__: ${JSON.stringify(REPORT_BY_TAG)},
      __REPORTS_BY_ROUNDING__: ${JSON.stringify(REPORT_BY_ROUNDING)},
      __CUSTOM_REPORT__: ${JSON.stringify(CUSTOM_REPORT)},
      __REPORT_SUMMARY__: ${JSON.stringify(REPORT_SUMMARY)},
      // §09 R6: the report view's Export CSV / Export JSON. The renderer rounds the export
      // through main (it cannot touch fs); the mock records the requested format + range so
      // the REPORT_SUMMARY scene can assert each button drives a real exportEntries call,
      // and returns a written-shaped result (a fixed path + count) without touching disk.
      exportEntries: function (p) {
        window.__EXPORTED__ = p;
        return Promise.resolve({ written: 3, path: '/tmp/stint-export.' + ((p && p.format) || 'csv') });
      },
      // §09 R1: the report request now carries EITHER a preset name (resolved to bounds by
      // core via the report IPC channel) OR explicit fromUtc/toUtc (custom). Resolve the
      // canned Report in that order — a non-default preset → its keyed report; a custom
      // from/to → the custom report (echoing the requested bounds back as the resolved
      // range); otherwise (the default This-week preset) fall through to the §08 R3
      // filter-keyed reports so the existing billable-toggle path is unchanged.
      report: function (p) {
        window.__REPORT_REQ__ = p;
        // §09 R6: the REPORT_SUMMARY scene routes EVERY request to the single flag-carrying
        // report, so the summary always paints the nested grouping with its overlap +
        // unreviewed-sleep flags on the affected rows regardless of the load defaults.
        if (window.__SUMMARY_SCENE__) {
          return Promise.resolve(this.__REPORT_SUMMARY__);
        }
        // §09 R4: the ROUNDING_TOGGLE scene routes EVERY request to the rounding-keyed
        // report for the requested increment, so the same underlying total (1h37m, not a
        // clean multiple of any increment) drives both the rounding-off (exact) and
        // rounding-on (rounded) views — the renderer picks which seconds to show.
        if (window.__ROUNDING_SCENE__) {
          const inc = (p && p.roundingIncrementMin) || 15;
          return Promise.resolve(this.__REPORTS_BY_ROUNDING__[inc] || this.__REPORTS_BY_ROUNDING__[15]);
        }
        if (p && p.preset && this.__REPORTS_BY_PRESET__[p.preset]) {
          return Promise.resolve(this.__REPORTS_BY_PRESET__[p.preset]);
        }
        if (p && p.fromUtc && p.toUtc) {
          return Promise.resolve({ ...this.__CUSTOM_REPORT__, rangeFromUtc: p.fromUtc, rangeToUtc: p.toUtc });
        }
        // §09 R3: a client/project/tag filter narrows the report. Consulted before the
        // group-by fallthrough since a filtered request still carries the default by/filter;
        // a clientId keys the client-filtered report, a non-blank tag keys the tag report —
        // each with a distinct total so the REPORT_FILTERS scene sees the rows re-query.
        if (p && p.clientId != null && this.__REPORTS_BY_CLIENT__[p.clientId]) {
          return Promise.resolve(this.__REPORTS_BY_CLIENT__[p.clientId]);
        }
        if (p && p.tag) {
          return Promise.resolve(this.__REPORT_BY_TAG__);
        }
        // §09 R2: for the default This-week + billable-only request, key by the Group-by
        // value so switching the Group-by segment visibly regroups the same week's totals.
        // Only when the billable filter is the default 'billable' (the 'all'/'non-billable'
        // toggle still resolves through the filter-keyed reports below, untouched).
        const filter = (p && p.billableFilter) || 'billable';
        if (p && p.by && filter === 'billable' && this.__REPORTS_BY_GROUP__[p.by]) {
          return Promise.resolve(this.__REPORTS_BY_GROUP__[p.by]);
        }
        return Promise.resolve(this.__REPORTS__[(p && p.billableFilter)] || this.__REPORTS__.billable);
      },
      // §12 R08 / §09 R08–R09: the saved report definitions the Reports view drives, at parity
      // with tt report save|ls|show|rename|edit|rm|run. listReports returns the seeded defs;
      // showReport looks one up by name (so Edit re-opens it); the mutators record their payload
      // (and keep the in-memory list current) so a scene can assert what the builder/kebab sent;
      // runReport returns the flag-carrying REPORT_SUMMARY report so the run-output paints the
      // grouped totals with overlap + unreviewed-sleep flags on the affected rows. Present here
      // so window.stint exposes EVERY IPC channel — the PARITY_REACH sub-fact reads this surface.
      __SAVED_REPORTS__: ${JSON.stringify(SAVED_REPORTS)},
      listReports: function () { return Promise.resolve(this.__SAVED_REPORTS__.map((d) => ({ ...d }))); },
      showReport: function (p) {
        const name = p && p.name;
        const def = this.__SAVED_REPORTS__.find((d) => d.name === name);
        return Promise.resolve(def ? { ...def } : null);
      },
      saveReport: function (p) {
        window.__SAVED_REPORT__ = p;
        const def = { id: 99, createdUtc: '2026-06-24T00:00:00.000Z', ...p };
        this.__SAVED_REPORTS__.push(def);
        return Promise.resolve({ ...def });
      },
      renameReport: function (p) {
        window.__RENAMED_REPORT__ = p;
        const def = this.__SAVED_REPORTS__.find((d) => d.name === (p && p.name));
        if (def) def.name = (p && p.newName) || def.name;
        return Promise.resolve(def ? { ...def } : null);
      },
      editReport: function (p) {
        window.__EDITED_REPORT__ = p;
        const def = this.__SAVED_REPORTS__.find((d) => d.name === (p && p.name));
        if (def && p && p.patch) Object.assign(def, p.patch);
        return Promise.resolve(def ? { ...def } : null);
      },
      removeReport: function (p) {
        window.__REMOVED_REPORT__ = p;
        this.__SAVED_REPORTS__ = this.__SAVED_REPORTS__.filter((d) => d.name !== (p && p.name));
        return Promise.resolve();
      },
      // §09 R09: run a saved report → the SAME core Report shape the ad-hoc report channel
      // returns. Records the ref so the scene can assert Run sent the card's name, and returns
      // the flag-carrying summary so the run-output paints flags in context.
      __SAVED_RUN__: ${JSON.stringify(REPORT_SUMMARY)},
      runReport: function (p) { window.__RUN_REPORT__ = p; return Promise.resolve(this.__SAVED_RUN__); },
      // §05 R09 / §12 R14: the Timer view's favorites rail. All five favorite channels are
      // present so window.stint exposes a callable for each (the PARITY_REACH + FAVORITES_RAIL
      // sub-fact) and the FAVORITES_RAIL scene can drive the rail end-to-end. listFavorites
      // returns the seeded set (the empty-favorites variant injects []); pinFavorite records its
      // payload and (for an explicit-name pin) appends a row so the rail repaints; rename/unpin
      // mutate the in-memory list; startFavorite (resume) records the name so the scene asserts a
      // one-click resume fired exactly once. Core owns the real template capture / atomic start.
      __FAVORITES__: ${JSON.stringify(favorites)},
      listFavorites: function () { return Promise.resolve(this.__FAVORITES__.map((f) => ({ ...f }))); },
      pinFavorite: function (p) {
        window.__PINNED__ = p;
        const fav = { id: 90 + this.__FAVORITES__.length, description: null, clientId: null, projectId: null, billable: true, tags: [], ...p };
        this.__FAVORITES__.push(fav);
        return Promise.resolve({ ...fav });
      },
      renameFavorite: function (p) {
        window.__RENAMED_FAV__ = p;
        const f = this.__FAVORITES__.find((x) => x.id === (p && p.ref) || x.name === (p && p.ref));
        if (f) f.name = (p && p.name) || f.name;
        return Promise.resolve(f ? { ...f } : null);
      },
      unpinFavorite: function (p) {
        window.__UNPINNED__ = p;
        this.__FAVORITES__ = this.__FAVORITES__.filter((x) => x.id !== (p && p.ref) && x.name !== (p && p.ref));
        return Promise.resolve();
      },
      startFavorite: function (p) {
        (window.__RESUMED__ ||= []).push(p);
        return Promise.resolve(window.__ACK__);
      },
    };
    // §19 R03/R04 — the GUI-only Software Update bridge (window.stint.update), mirroring the
    // EXACT preload shape (getVersion / check / download / reveal / onUpdateProgress). It is
    // off the parity-asserted CHANNELS set (in-app update has no tt twin), so it is injected
    // here only for the SOFTWARE_UPDATE scene and ONLY when an update config is supplied. The
    // mock is fully deterministic: getVersion returns the stamped version, check returns the
    // canned verdict, and download replays the canned progress frames over the same
    // onUpdateProgress listener the real renderer subscribes — so the harness scores the real
    // version row, Check-now result line, progress bar, and numbered guided steps.
    window.__UPDATE__ = ${update ? JSON.stringify(update) : 'null'};
    if (window.__UPDATE__) {
      window.__UPDATE_LISTENERS__ = [];
      window.stint.update = {
        getVersion: () => Promise.resolve(window.__UPDATE__.version),
        check: () => { window.__CHECKED__ = true; return Promise.resolve(window.__UPDATE__.verdict); },
        download: () => {
          window.__DOWNLOADED__ = true;
          for (const frame of (window.__UPDATE__.progress || [])) {
            for (const cb of window.__UPDATE_LISTENERS__) cb(frame);
          }
          return Promise.resolve({ started: true });
        },
        reveal: () => { window.__REVEALED__ = true; return Promise.resolve(window.__UPDATE__.steps || []); },
        onUpdateProgress: (cb) => {
          window.__UPDATE_LISTENERS__.push(cb);
          return () => {
            window.__UPDATE_LISTENERS__ = window.__UPDATE_LISTENERS__.filter((x) => x !== cb);
          };
        },
      };
    }
  `;
}
