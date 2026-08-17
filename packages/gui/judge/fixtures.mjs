// Canned UiState snapshots for the JUDGE harness (acceptance.html §09). Each drives
// the real renderer through an injected window.stint mock so the agent can capture
// screenshots and score them against the rubric.

// The SHIPPING update-failure copy, from the built main bundle — the same import discipline
// run-judge.mjs uses for CHANNELS. A fixture that re-typed the sentence would keep passing
// after the copy was reworded (or reverted to forwarding a transport code), which is exactly
// the regression issue 138 fixed. ipc.ts is electron-free, so plain node can read it.
import { UPDATE_CHECK_FAILED } from '../dist/ipc.js';
export { UPDATE_CHECK_FAILED };

// §14 — the settings every snapshot below carries: CORE's defaults, by the same import
// discipline UPDATE_CHECK_FAILED states above. A re-typed field list here is a fixture that
// keeps passing after the thing it stands for has moved — every scene would go on rendering a
// settings block core no longer serves. Core is electron-free, so plain node reads it (the
// same route the vitest suites take).
import { DEFAULT_SETTINGS } from '@stint/core';

// A pinned wall clock so the captured evidence is byte-for-byte reproducible: the
// harness installs this as the page clock, the running fixture starts a fixed
// 01:24:07 before it, and the count-up advances only by an explicit fast-forward.
export const JUDGE_NOW = '2026-06-24T23:00:00Z';

// Issue #126 — the geometry the shipped windows actually have (main.ts): the main window's
// 1040×800 default, which is also its minimum. Both harnesses render every scene at a size the
// window can be, so no committed evidence shows a size it cannot — that is a false green of
// presentation (process.html §02), and it is why the cramped calendar and the clipped popover
// card survived review. A scene needing a second viewport sweeps from WINDOW, never below it.
// The shipped popover auto-sizes to its rendered card (§12 R22), so popover pages open at the
// same pre-measure placeholder main.ts uses and are then fitted with the same clamp
// (popoverWindowSize) the shipped window applies on show.
export const WINDOW = { width: 1040, height: 800 };
export { POPOVER_FALLBACK as POPOVER } from '../dist/popoversize.js';
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

// §12 R10 — the flag-detail fixture the recording (§12 R10 recipe) drives: an OVERLAP pair
// (10↔11, 30m) and a SLEPT entry (12, raw 4h trimmed to 3h). On the readonly calendar the pair
// paints `.ov` warn bands and the slept entry the `.zz` hatch; opening each in the unified editor
// shows the overlap detail and the reversible subtract/restore control (struck raw-vs-trimmed).
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
            // §12 R10: a slept entry whose billable was trimmed — in the editor the raw 4h reads
            // struck through beside the trimmed 3h billable (rawSeconds > billableSeconds), and the
            // control reads Restore. `sleptSeconds` is the recorded-sleep amount the subtractSleep
            // mock restores/re-subtracts so the recording can toggle it both ways.
            billableSeconds: 10800,
            billable: true,
            overlapped: false,
            overlapMinutes: 0,
            overlapRelation: null,
            sleptThrough: true,
            excludedSeconds: 3600,
            rawSeconds: 14400,
            sleptSeconds: 3600,
          },
        ],
      },
    ],
    sleepFlaggedIds: [12],
    settings: DEFAULT_SETTINGS,
  };
}

/**
 * Issue #146 — the INLINE_GATE_CONTAINMENT fixture. Two CLOSED entries pinned to the two
 * EDGE columns of the rendered week: id=40 on Monday 2026-06-22 (the week grid's FIRST day
 * column) and id=41 on Friday 2026-06-26 (its LAST — the week-only grid shows Mon–Fri with
 * the weekend hidden, §12 R09, so Friday is the right edge at the default settings). Both
 * dates sit in one Mon–Sun week, so calendarModel paints exactly those five columns and the
 * two entries land hard against the grid's left and right edges.
 *
 * The edges are the whole point. A gate armed on a MIDDLE column overflows its day column
 * but still lands inside the calendar, so it cannot tell a positioned, clamped layer from
 * the in-flow run that shipped — the escape only becomes visible where there is no
 * neighbouring column left to spill into. Two entries, not one, so a clamp that only pulls
 * the left edge in (or only the right) fails on the other.
 *
 * Entry 42 OVERLAPS 40 in the first column so the gate opens with a neighbouring block's own
 * chrome across it. That chrome is not incidental: a block at rest sets no z-index, so its
 * corner checkbox competes at z-6 in the strip's stacking context — above the ops chip (z-5)
 * the gate is mounted in. Without the neighbour the layer would only ever be probed over empty
 * track, and nothing would hold the gate's rank against the chrome it actually has to cover.
 */
export function edgeColumnState() {
  const entry = (id, day, description, fromHour = 10, toHour = 12) => ({
    id,
    description,
    clientLabel: 'Acme / API',
    startUtc: `${day}T${String(fromHour).padStart(2, '0')}:00:00Z`,
    endUtc: `${day}T${String(toHour).padStart(2, '0')}:00:00Z`,
    billableSeconds: (toHour - fromHour) * 3600,
    billable: true,
    overlapped: false,
    sleptThrough: false,
    excludedSeconds: 0,
  });
  return {
    status: { running: false, entry: null },
    days: [
      {
        day: '2026-06-22',
        entries: [
          entry(40, '2026-06-22', 'first column'),
          // Starts 50 minutes into 40's span — far enough down that 40's own top line (its ops
          // chip and the strip the scene hovers) stays clear, close enough that the neighbour's
          // block and its z-6 corner checkbox land inside the ~50px band the gate opens across.
          { ...entry(42, '2026-06-22', 'overlapping neighbour', 10, 13), startUtc: '2026-06-22T10:50:00Z' },
        ],
      },
      { day: '2026-06-26', entries: [entry(41, '2026-06-26', 'last column')] },
    ],
    sleepFlaggedIds: [],
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
 * A single closed entry on the pinned day, so the delete-gate scenes (DELETE_CONFIRM /
 * CONFIRM_DELETE) can open the entry's row affordances deterministically. Closed (it has
 * an endUtc) so it offers the full field set including End when opened.
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
 * §05 R10 — the MULTILINE_DESC fixture. A single CLOSED entry whose description carries an
 * embedded newline (two lines), so the judge can open the entry's edit form and assert the
 * description control is a 3-line scrollable <textarea> rendering the stored newline VERBATIM
 * (not flattened to one line). The interior '\n' lives here, in the fixture, not in any DOM
 * markup, so a surface that flattened stored text would be caught.
 */
export function multilineDescState() {
  return {
    status: { running: false, entry: null },
    days: [
      {
        day: '2026-06-24',
        entries: [
          {
            id: 30,
            description: 'line one\nline two',
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
 * §12 R06 — the UNIFIED_FORM edit-mode fixture. A CLOSED entry (80) seeding EVERY tt-editable
 * field, whose client/project match the canned reference data (Acme / API → CLIENTS id 1,
 * PROJECTS 11) so the unified entry form opens INLINE (not a modal) in edit mode with its Client
 * + Project selects pre-selectable, the description textarea, the tag chips, the billable toggle
 * and the Start/Stop fields all seeded from the entry. Closed (it has an endUtc), so the form
 * carries End and the footer offers Split (only a bounded span can be cut).
 *
 * §12 R10 — plus an OVERLAPPED entry (81, 30m with the previous entry) and a SLEPT entry (82, raw
 * 4h with a 1h recorded sleep to subtract) so the same scene can open the editor on each and assert
 * the overlap DETAIL and the reversible sleep subtract/restore control (struck raw-vs-trimmed
 * billable). `sleptSeconds` is the fixture stand-in for core's recorded sleep spans that the
 * subtractSleep mock (initScript) excludes/restores; both start UN-subtracted (excludedSeconds 0).
 *
 * §12 R15 — plus a CLOSED entry (83, 15:00–16:00Z) that OVERLAPS entry 80's span (14:00–15:30Z) on
 * the same UTC-pinned day, so when the UNIFIED_FORM scene opens entry 80's editor the INLINE interval
 * picker paints entry 83 both as a gray other block AND, where it overlaps the edited "me" span
 * (15:00–15:30), a yellow inert warn band (warn-only, never blocks Save).
 *
 * §12 R15 (issue #49) — plus a CLOSED entry (84, 09:07:33–11:03:00Z) whose times are deliberately
 * NOT 5-minute-aligned (and carry seconds), so the UNIFIED_FORM scene can assert the exact-times
 * contract: opening its editor renders the stored start/stop to the second, Save with no drag
 * sends a patch with NO startUtc/endUtc (the store round-trips unchanged), and only an actively
 * dragged stop grip lands on the :05 grid.
 */
export function unifiedFormState() {
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
          {
            id: 81,
            description: 'client call',
            clientLabel: 'Acme / API',
            startUtc: '2026-06-24T08:00:00Z',
            endUtc: '2026-06-24T09:00:00Z',
            billableSeconds: 3600,
            billable: true,
            overlapped: true,
            overlapMinutes: 30,
            overlapRelation: 'previous',
            sleptThrough: false,
            excludedSeconds: 0,
            rawSeconds: 3600,
            tags: [],
          },
          {
            // Moved to the evening (raw 4h unchanged) so the exact-times entry 84 below owns the
            // 09:07–11:03 slot overlap-free — its hover/edit ops stay reachable without stacking.
            id: 82,
            description: 'deep work',
            clientLabel: 'Acme / API',
            startUtc: '2026-06-24T16:30:00Z',
            endUtc: '2026-06-24T20:30:00Z',
            billableSeconds: 14400,
            billable: true,
            overlapped: false,
            overlapMinutes: 0,
            overlapRelation: null,
            sleptThrough: true,
            excludedSeconds: 0,
            rawSeconds: 14400,
            sleptSeconds: 3600,
            tags: [],
          },
          {
            // §12 R15 (issue #49) — the EXACT-TIMES entry: 09:07:33 → 11:03:00, sub-5-min stored
            // truth (6927s). The editor must show these to the second and a no-drag Save must not
            // rewrite them; only a dragged handle snaps.
            id: 84,
            description: 'standup notes',
            clientLabel: 'Acme / API',
            startUtc: '2026-06-24T09:07:33Z',
            endUtc: '2026-06-24T11:03:00Z',
            billableSeconds: 6927,
            billable: true,
            overlapped: false,
            overlapMinutes: 0,
            overlapRelation: null,
            sleptThrough: false,
            excludedSeconds: 0,
            rawSeconds: 6927,
            tags: [],
          },
          {
            // §12 R15 — overlaps entry 80 (14:00–15:30Z) at 15:00–15:30, so entry 80's inline
            // picker paints this both gray (other) and, over the shared minutes, yellow (warn-only).
            id: 83,
            description: 'follow-up',
            clientLabel: 'Acme / API',
            startUtc: '2026-06-24T15:00:00Z',
            endUtc: '2026-06-24T16:00:00Z',
            billableSeconds: 3600,
            billable: true,
            overlapped: false,
            overlapMinutes: 0,
            overlapRelation: null,
            sleptThrough: false,
            excludedSeconds: 0,
            rawSeconds: 3600,
            tags: [],
          },
        ],
      },
    ],
    sleepFlaggedIds: [82],
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
 * Two CLOSED entries that AGREE on client and billable but are NOT contiguous — a positive
 * gap sits between them (10:00 → 14:00). Folding them fabricates that 4-hour gap as billable
 * time, so the MERGE_GAP scene can assert clicking Merge raises the gap confirm stating the
 * resulting span/duration BEFORE any merge commits (§06 R3, §12 R13) — never a silent fold.
 */
export function mergeGapState() {
  return {
    status: { running: false, entry: null },
    days: [
      {
        day: '2026-06-24',
        entries: [
          {
            id: 60,
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
            id: 61,
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
 * A single closed entry the OVERLAP_BANNER scene edits to create an overlap. The state
 * itself carries no overlap flag yet — the banner is the AT-WRITE-TIME signal, raised by
 * the WriteAck the mock returns when the edit fires (initScript's `overlap` option, which
 * fills `window.__ACK__`), which is independent of the durable per-row flag (§06 R4).
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
// §12 R13 — `referenced` marks a client any entry points at (archiving it hides history, so it
// takes the two-step confirm). Acme is referenced (its projects carry the LIST_ENTRIES work);
// Globex is not, so archiving it is direct — which is what the CLIENTS_VIEW scene drives, while
// the CONFIRM_ARCHIVE scene drives the referenced Acme through the two-step gate.
const CLIENTS = [
  { id: 1, name: 'Acme', archived: false, referenced: true },
  { id: 2, name: 'Globex', archived: false, referenced: false },
];
const PROJECTS = {
  1: [
    { id: 11, clientId: 1, name: 'API', archived: false },
    { id: 12, clientId: 1, name: 'Web', archived: false },
  ],
  2: [
    { id: 21, clientId: 2, name: 'Onboarding', archived: false },
    // Issue #55: the Entries-toolbar scenes filter by project over the LIST_ENTRIES rows,
    // whose Globex entries live under Ops — present here so #el-project can offer it.
    { id: 22, clientId: 2, name: 'Ops', archived: false },
  ],
};

export function clientsState() {
  return emptyState();
}

// §12 R9 — the Entries-view dataset. A MULTI-WEEK, multi-client, multi-project, tagged,
// mixed-billable set (issue #55: a single-context fixture cannot tell "filtered" from
// "shows everything", which is exactly how the dead-toolbar regression slipped), so the
// ENTRIES_CALENDAR / LIVE_FILTER scenes can drive EVERY toolbar control and watch the
// visible event set move to the expected subset. Shaped as the flat row list the
// listEntries mock filters + groups (mirroring core) — clientId/projectId carried so the
// client/project filters narrow like production. Relative to the pinned JUDGE clock
// (Wed 2026-06-24, weekStart monday):
//   THIS WEEK (Jun 22–28) — ids 1–4 billable (5.00h) + id 7 NON-billable (the billable
//     toggle moves counts); ids 1,2,7 fall on "today" (Jun 24, billable 3.00h);
//   LAST WEEK — id 5 'refactor planning' (2.00h; also a "refactor" match, so a default-
//     week search proves range + search COMPOSE by excluding it);
//   LAST MONTH — id 6 'may retro' (1.00h).
// The multi-week shape (all-time 8.00h vs the 5.00h week) predates #264's retirement of
// the toolbar's range-total chip; it still earns its keep by making every narrowing move
// a visibly different event count.
const LIST_ENTRIES = [
  { id: 1, description: 'auth refactor', clientLabel: 'Acme / API', client: 'Acme', project: 'API', clientId: 1, projectId: 11, startUtc: '2026-06-24T09:00:00Z', endUtc: '2026-06-24T11:00:00Z', billableSeconds: 7200, billable: true, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 7200, tags: ['deep'] },
  { id: 2, description: 'deploy pipeline', clientLabel: 'Globex / Ops', client: 'Globex', project: 'Ops', clientId: 2, projectId: 22, startUtc: '2026-06-24T11:00:00Z', endUtc: '2026-06-24T12:00:00Z', billableSeconds: 3600, billable: true, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 3600, tags: ['ci'] },
  { id: 3, description: 'standup', clientLabel: 'Acme / Web', client: 'Acme', project: 'Web', clientId: 1, projectId: 12, startUtc: '2026-06-23T09:00:00Z', endUtc: '2026-06-23T09:30:00Z', billableSeconds: 1800, billable: true, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 1800, tags: ['meeting', 'deep'] },
  { id: 4, description: 'refactor tests', clientLabel: 'Globex / Ops', client: 'Globex', project: 'Ops', clientId: 2, projectId: 22, startUtc: '2026-06-23T13:00:00Z', endUtc: '2026-06-23T14:30:00Z', billableSeconds: 5400, billable: true, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 5400, tags: ['ci'] },
  { id: 5, description: 'refactor planning', clientLabel: 'Acme / API', client: 'Acme', project: 'API', clientId: 1, projectId: 11, startUtc: '2026-06-17T09:00:00Z', endUtc: '2026-06-17T11:00:00Z', billableSeconds: 7200, billable: true, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 7200, tags: ['deep'] },
  { id: 6, description: 'may retro', clientLabel: 'Globex / Ops', client: 'Globex', project: 'Ops', clientId: 2, projectId: 22, startUtc: '2026-05-20T10:00:00Z', endUtc: '2026-05-20T11:00:00Z', billableSeconds: 3600, billable: true, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 3600, tags: ['meeting'] },
  { id: 7, description: 'team lunch', clientLabel: 'Acme / Web', client: 'Acme', project: 'Web', clientId: 1, projectId: 12, startUtc: '2026-06-24T12:00:00Z', endUtc: '2026-06-24T13:00:00Z', billableSeconds: 3600, billable: false, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 3600, tags: [] },
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
 * §17 R11 — the LIVE_FILTER fixture. The same multi-week / multi-client / tagged set as
 * the Entries-view list (listState), reused so a search keystroke / client selection
 * narrows the visible rows live. A "refactor" search keeps the two IN-WEEK refactor rows
 * (last week's 'refactor planning' stays excluded — range + search compose), so the
 * narrowing is visibly a subset, never "shows everything". (The toolbar's range-total
 * chip this fixture also fed is retired — #264, §12 R09.)
 */
export function liveState() {
  return listState();
}

/**
 * §12 R16 — the CALENDAR_LAYOUT fixture. The current Monday-start week (Jun 22–28, containing
 * the pinned Wednesday JUDGE clock) that exercises every week-grid fact the scene asserts. The
 * scene runs its page in timezoneId 'UTC' so each UTC instant lands on a deterministic local
 * time on the 24h track:
 *   Mon 06-22 — an OVERLAP pair (09:00–11:00 vs 10:30–12:00, 30m warn band), an OFF-HOURS
 *               entry BEFORE working-start (06:00–06:45, above the 07:00 default viewport),
 *               and a CROSS-MIDNIGHT span (22:30 → Tue 06:15) whose two segments both land on
 *               SHOWN columns;
 *   Tue 06-23 — a SLEPT entry (13:00–17:00, raw 4h trimmed to 3h billable → the `.zz` hatch) plus
 *               an OFF-HOURS entry AFTER working-end (19:00–20:00, below the 18:00 default viewport);
 *   Wed 06-24 — TODAY (the `.dd.today` ink ring): the RUNNING/open entry (09:00–, future-fade,
 *               no end) plus a plain closed entry;
 *   Thu       — an EMPTY day (present-but-empty `.dcol`);
 *   Fri 06-26 — a CROSS-MIDNIGHT span into the HIDDEN weekend (22:30 → Sat 06:15): with
 *               show_weekend off only its start-day segment is drawn (§12 R09/R16 — a segment
 *               on a day the grid does not show is simply not drawn), while Friday's header
 *               still counts the full 7.75h (start-day attribution); toggling the weekend on
 *               reveals the Sat seg-end without giving Sat's header a total.
 * All entries are billable, so the per-day header totals are deterministic: Mon 12.00h
 * (4.25h same-day + the 7.75h overnight span), Tue 4.00h, Wed 1.00h, Fri 7.75h. The off-hours
 * entries prove the 24h track SCROLLS (never clips): they are in the DOM and reachable though
 * the viewport opens on working hours.
 */
export function entriesCalendarState() {
  const ev = (o) => ({
    overlapped: false,
    overlapMinutes: 0,
    overlapRelation: null,
    sleptThrough: false,
    excludedSeconds: 0,
    rawSeconds: o.billableSeconds,
    tags: [],
    ...o,
  });
  const running = {
    id: 6,
    description: 'drafting proposals',
    clientLabel: 'Globex / Ops',
    startUtc: '2026-06-24T09:00:00Z',
    billableSeconds: 0,
    billable: true,
    sleptThrough: false,
    tags: [],
  };
  return {
    status: { running: true, entry: running },
    days: [
      {
        day: '2026-06-22',
        entries: [
          ev({ id: 3, description: 'early standup', clientLabel: 'Acme / API', startUtc: '2026-06-22T06:00:00Z', endUtc: '2026-06-22T06:45:00Z', billableSeconds: 2700, billable: true }),
          ev({ id: 1, description: 'client call', clientLabel: 'Acme / API', startUtc: '2026-06-22T09:00:00Z', endUtc: '2026-06-22T11:00:00Z', billableSeconds: 7200, billable: true, overlapped: true, overlapMinutes: 30, overlapRelation: 'next' }),
          ev({ id: 2, description: 'market research', clientLabel: 'Globex / Ops', startUtc: '2026-06-22T10:30:00Z', endUtc: '2026-06-22T12:00:00Z', billableSeconds: 5400, billable: true, overlapped: true, overlapMinutes: 30, overlapRelation: 'previous' }),
          // §12 R16 (issue #71): a CROSS-MIDNIGHT span — 22:30 on the 22nd → 06:15 on the 23rd
          // (7h45m). It is grouped under and totalled on its START day (the 22nd) but renders as
          // TWO segments sharing data-id 8: a start-day segment (22:30 → the 22nd's track bottom)
          // and an end-day segment (the 23rd's track top → 06:15) — never the single 18px sliver
          // the same-day end-min math used to collapse it to. The end column (the 23rd) shows the
          // segment WITHOUT the 7.75h counting toward its header total (start-day attribution).
          ev({ id: 8, description: 'overnight render', clientLabel: 'Globex / Ops', startUtc: '2026-06-22T22:30:00Z', endUtc: '2026-06-23T06:15:00Z', billableSeconds: 27900, billable: true }),
        ],
      },
      {
        day: '2026-06-23',
        entries: [
          ev({ id: 4, description: 'deep work', clientLabel: 'Globex / Ops', startUtc: '2026-06-23T13:00:00Z', endUtc: '2026-06-23T17:00:00Z', billableSeconds: 10800, billable: true, sleptThrough: true, excludedSeconds: 3600, rawSeconds: 14400 }),
          ev({ id: 5, description: 'evening wrap', clientLabel: 'Acme / API', startUtc: '2026-06-23T19:00:00Z', endUtc: '2026-06-23T20:00:00Z', billableSeconds: 3600, billable: true }),
        ],
      },
      {
        day: '2026-06-24',
        entries: [
          ev({ id: 6, description: 'drafting proposals', clientLabel: 'Globex / Ops', startUtc: '2026-06-24T09:00:00Z', endUtc: null, billableSeconds: 0, billable: true }),
          ev({ id: 7, description: 'invoice prep', clientLabel: 'Initech', startUtc: '2026-06-24T14:00:00Z', endUtc: '2026-06-24T15:00:00Z', billableSeconds: 3600, billable: true }),
        ],
      },
      {
        day: '2026-06-26',
        entries: [
          // §12 R09/R16: the weekend-crossing span (Fri 22:30 → Sat 06:15, 7.75h — the mockup's
          // own "Overnight render"). With the weekend hidden only the start-day segment draws;
          // Sat's seg-end appears when show_weekend flips on, and Sat's header never counts it.
          ev({ id: 9, description: 'overnight render', clientLabel: 'Globex / Ops', startUtc: '2026-06-26T22:30:00Z', endUtc: '2026-06-27T06:15:00Z', billableSeconds: 27900, billable: true }),
        ],
      },
    ],
    sleepFlaggedIds: [4],
    settings: DEFAULT_SETTINGS,
  };
}

// design.html D11 (issue #143) — the daily rhythm the dense-week fixture lays down. One rota
// per elapsed weekday of the current week, six blocks each, so the view reads as a genuinely
// busy freelance week rather than a copy-pasted wall. `at` is a local (UTC, under the scene's
// pinned timezone) start time; `mins` its length. Tuesday's lunch is the set's one
// non-billable block.
const DENSE_WEEKDAY_ROTA = {
  1: [
    { at: '09:00', mins: 30, description: 'standup', clientLabel: 'Acme / Web' },
    { at: '09:45', mins: 75, description: 'sprint planning', clientLabel: 'Acme / API' },
    { at: '11:15', mins: 90, description: 'auth refactor', clientLabel: 'Acme / API' },
    { at: '13:00', mins: 150, description: 'deep work', clientLabel: 'Acme / API' },
    { at: '15:45', mins: 60, description: 'code review', clientLabel: 'Globex / Ops' },
    { at: '17:00', mins: 45, description: 'docs pass', clientLabel: 'Acme / API' },
  ],
  2: [
    { at: '09:00', mins: 30, description: 'standup', clientLabel: 'Acme / Web' },
    { at: '10:00', mins: 120, description: 'deploy pipeline', clientLabel: 'Globex / Ops' },
    { at: '12:15', mins: 45, description: 'team lunch', clientLabel: 'Acme / Web', billable: false },
    { at: '14:00', mins: 105, description: 'refactor tests', clientLabel: 'Globex / Ops' },
    { at: '16:00', mins: 60, description: 'invoice prep', clientLabel: 'Initech' },
    { at: '17:15', mins: 30, description: 'inbox triage', clientLabel: 'Acme / Web' },
  ],
  3: [
    { at: '09:00', mins: 30, description: 'standup', clientLabel: 'Acme / Web' },
    { at: '10:15', mins: 105, description: 'market research', clientLabel: 'Globex / Ops' },
    { at: '13:30', mins: 90, description: 'invoice prep', clientLabel: 'Initech' },
    { at: '15:15', mins: 75, description: 'prototype spike', clientLabel: 'Initech' },
    { at: '16:45', mins: 45, description: 'weekly wrap', clientLabel: 'Acme / Web' },
  ],
};

/**
 * design.html D11 (issue #143) — the CALENDAR_ACCENT_BUDGET fixture: the Entries week grid at
 * REALISTIC density. The accent-wallpaper defect is invisible at toy density, and since the
 * view went week-only (§12 R09) the DENSEST surface the app can show is one busy week — so
 * this seeds the current week's elapsed days full: **Mon 2026-06-22 through the pinned JUDGE
 * Wednesday 2026-06-24** on DENSE_WEEKDAY_ROTA (6 + 6 + 5 blocks) plus the open row =
 * **17 entry blocks**, the last of which is the OPEN row (the live running state, the
 * calendar's one sanctioned accent). Ids are assigned in day order, so they are stable.
 *
 * No toolbar control is touched to reach it: the default Entries paint IS the current week
 * (calendarModel), so the scene measures the view AT REST — Thu/Fri paint as empty columns.
 */
export function denseCalendarState() {
  const days = [];
  let id = 0;
  for (let d = new Date(Date.UTC(2026, 5, 22)); d <= new Date(Date.UTC(2026, 5, 24)); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const templates = DENSE_WEEKDAY_ROTA[d.getUTCDay()] ?? [];
    const entries = templates.map((t) => {
      const startUtc = `${day}T${t.at}:00Z`;
      const billable = t.billable !== false;
      return {
        id: ++id,
        description: t.description,
        clientLabel: t.clientLabel,
        startUtc,
        endUtc: new Date(Date.parse(startUtc) + t.mins * 60_000).toISOString(),
        billableSeconds: billable ? t.mins * 60 : 0,
        rawSeconds: t.mins * 60,
        billable,
        overlapped: false,
        overlapMinutes: 0,
        overlapRelation: null,
        sleptThrough: false,
        excludedSeconds: 0,
        tags: [],
      };
    });
    if (entries.length) days.push({ day, entries });
  }
  // A late OPEN row closes the pinned Wednesday — the one live running state on the whole
  // grid, and (after issue #143) the only block on it that may carry the accent.
  const wed = days[days.length - 1];
  const open = {
    id: ++id,
    description: 'drafting proposals',
    clientLabel: 'Globex / Ops',
    startUtc: '2026-06-24T21:00:00Z',
    endUtc: null,
    billableSeconds: 0,
    rawSeconds: 0,
    billable: true,
    overlapped: false,
    overlapMinutes: 0,
    overlapRelation: null,
    sleptThrough: false,
    excludedSeconds: 0,
    tags: [],
  };
  wed.entries.push(open);
  return { status: { running: true, entry: { ...open } }, days, sleepFlaggedIds: [], settings: DEFAULT_SETTINGS };
}

/**
 * §12 R16 (issues #187 / #151) — the SHORT-ENTRY calendar fixture. One day carrying the four
 * durations the design audit measured — 10 / 30 / 45 / 180 minutes — because the block height is
 * `duration × 1px/min` (the week grid's 60px hours, floored at 18px) while the content height is
 * fixed by text flow at ~55px, so the two cross at about 55 minutes and only a fixture that
 * reaches BELOW that line can catch a spill. Fixture realism is the whole guard: the audit first killed a narrower version of
 * this finding by measuring a 132px block — very nearly the longest plausible entry — and a scene
 * seeded only with hour-plus entries would repeat that mistake. A 30-minute standup is the common
 * case, not an edge case.
 *
 * Every entry is billable, unflagged and same-day, so the CALENDAR_ENTRY_CONTAINMENT scene reads
 * pure geometry: no overlap band, slept hatch or cross-midnight segment perturbs the blocks. The
 * 180-minute entry is the control — it has room to spare, so a containment assertion that passes
 * only on it proves nothing.
 *
 * TARGET_SIZE sweeps this fixture too (#224): the 10-minute entry (id 201, an 18px block) is the
 * sub-24-minute target design.html §07's A03 duration-true exemption names, and the scene's
 * shortBlockMet guard REQUIRES one — lengthen every entry past 24 minutes and TARGET_SIZE fails
 * rather than passing blind. Its clip probe also focuses id 201, so that entry must stay closed
 * (an open block grows a 180px future span and stops being short).
 */
export function shortEntriesCalendarState() {
  const ev = (o) => ({
    overlapped: false,
    overlapMinutes: 0,
    overlapRelation: null,
    sleptThrough: false,
    excludedSeconds: 0,
    rawSeconds: o.billableSeconds,
    tags: [],
    billable: true,
    ...o,
  });
  return {
    status: { running: false, entry: null },
    days: [
      {
        day: '2026-06-24',
        entries: [
          // 10 min → an 18px block (the floor): only the description can fit.
          ev({ id: 201, description: 'quick call', clientLabel: 'Acme / API', startUtc: '2026-06-24T08:00:00Z', endUtc: '2026-06-24T08:10:00Z', billableSeconds: 600 }),
          // 30 min → 30px: the ordinary standup the audit named.
          ev({ id: 202, description: 'standup', clientLabel: 'Acme / API', startUtc: '2026-06-24T09:00:00Z', endUtc: '2026-06-24T09:30:00Z', billableSeconds: 1800 }),
          // 45 min → 45px: still ~10px short of the content's ~55px. (This was the audit's
          // 60-minute case; at the week grid's 60px hours a 60-minute block now FITS its
          // content, so 45 keeps a genuinely-overflowing mid duration in the fixture.)
          ev({ id: 203, description: 'invoice prep', clientLabel: 'Initech', startUtc: '2026-06-24T10:00:00Z', endUtc: '2026-06-24T10:45:00Z', billableSeconds: 2700 }),
          // 180 min → 180px: the control, with room for every line.
          ev({ id: 204, description: 'deep work', clientLabel: 'Globex / Ops', startUtc: '2026-06-24T13:00:00Z', endUtc: '2026-06-24T16:00:00Z', billableSeconds: 10800 }),
        ],
      },
    ],
    sleepFlaggedIds: [],
    settings: DEFAULT_SETTINGS,
  };
}

/**
 * §12 R12 — the Settings-view fixture. The panel renders from getState().settings (the
 * §14 settings), so the empty-state snapshot's DEFAULT_SETTINGS is enough; the
 * SETTINGS_VIEW scene opens the panel, asserts a control for every setting, and screenshots
 * the editable controls (main-settings.png) for rubric/human review.
 */
export function settingsState() {
  return emptyState();
}

/**
 * §14 / §12 R12 — the TIMELINE_WINDOW fixtures. Non-default working hours (09:00–15:00,
 * mode working_hours) so the scene can assert SU.timelineWindow returns exactly 540–900
 * minutes AND that the Settings → Timeline group renders the stored values (not the
 * defaults); plus an around_now/8 variant whose window is JUDGE_NOW ± 4h (clamped to the
 * 24h track), deterministic under the pinned page clock.
 */
export function timelineWindowState() {
  const s = emptyState();
  s.settings = {
    ...DEFAULT_SETTINGS,
    workingHoursStart: '09:00',
    workingHoursEnd: '15:00',
    pickerWindowMode: 'working_hours',
    pickerAroundHours: 8,
  };
  return s;
}

export function timelineAroundState() {
  const s = timelineWindowState();
  s.settings = { ...s.settings, pickerWindowMode: 'around_now', pickerAroundHours: 8 };
  return s;
}

/**
 * §14 / §12 R23 — the SNAP_RESOLUTION fixtures: the drag-snap pair at a NON-DEFAULT resolution.
 *
 * Every other fixture carries `DEFAULT_SETTINGS`' 5/15, and every snap assertion in the harness
 * is a literal default (`% 15 === 0`, `=== '2026-06-24 20:20:00'`). So nothing anywhere proved
 * the two §14 rows are CONSUMED: core/CLI/BDD prove they store and validate, and the renderer
 * could have gone on hardcoding 5 and 15 with all 57 machine-scored items green — which is
 * exactly what the reviewer's mutation showed. A settings pair that is read by no acceptance
 * criterion is a preference the user can set and the app can ignore.
 *
 * 2/20 rather than another multiple pair, because 15 is a multiple of 5 and 5/15 is therefore a
 * poor discriminator: a coarse landing on the 15-grid is often on the 5-grid too. At 2/20 the
 * grids separate — a coarse drag lands ≡ 0 mod 20 but OFF the 15-grid, and a fine drag lands
 * ≡ 0 mod 2 but off the 5-grid — so neither hardcoded default can produce either value.
 * Both surfaces §12 R23 names get one: the Entries week grid (app.js) and the Timer view's
 * start-only picker (timepicker.js). Core validates the pair (whole 1–30, fine ≤ coarse); 2/20
 * is inside that domain, so this is a configuration a user can really hold.
 */
const SNAP_NON_DEFAULT = { snapFineMinutes: 2, snapCoarseMinutes: 20 };

export function snapGridState() {
  const s = addFormState();
  s.settings = { ...DEFAULT_SETTINGS, ...SNAP_NON_DEFAULT };
  return s;
}

export function snapPickerState() {
  const s = timerViewRunningState();
  s.settings = { ...s.settings, ...SNAP_NON_DEFAULT };
  return s;
}

/**
 * §14 / §12 R15 / G16 — the timeline-window CONSUMER fixture: the canonical running entry (so the
 * Timer view's start-only picker mounts, which is where the `data-timeline-track` scroll window
 * actually lives) carrying the same non-default 09:00–15:00 working hours the Settings half of
 * TIMELINE_WINDOW seeds. The two halves therefore read ONE configuration: whatever the Settings
 * group shows is the window the picker opens at. Before the redesign landed §12 R15/R16 there was
 * no mounted consumer at all and the scene's `consumerTrack` fact passed vacuously; this fixture
 * is what retires that stub (the post-wave AC pass the rubric deferred it to).
 */
export function timelineConsumerState() {
  const s = timerViewRunningState();
  s.settings = {
    ...s.settings,
    workingHoursStart: '09:00',
    workingHoursEnd: '15:00',
    pickerWindowMode: 'working_hours',
    pickerAroundHours: 8,
  };
  return s;
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
 * §20 R04 / §17 R12 — the Settings → Backups fixture. emptyState plus the snapshot fields the
 * Backups group paints: a "Last backup <ts>" status (lastBackupUtc, the newest backup's
 * createdUtc, matching the __BACKUPS__ list the listBackups mock returns), the retention count
 * (settings.backupRetention, default 5), and NO recovery notice (the un-recovered launch). The
 * BACKUPS_SECTION scene routes to Settings, asserts the restore list + retention render from this
 * state, and drives a Restore… through the confirm gate (window.stint.restoreBackup).
 */
export function backupsState() {
  const s = emptyState();
  s.lastBackupUtc = '2026-06-27T10:15:00Z';
  s.recoveryNotice = null;
  return s;
}

// §20 R04 — the canned backup files the listBackups mock returns by default (newest first;
// the newest one's createdUtc matches backupsState().lastBackupUtc). The initScript `backups`
// option overrides this list so the BACKUPS_SECTION scene's empty variant can inject [].
const BACKUPS = [
  { name: 'timetracker.sqlite.bak-20260627T101500Z', path: '/db/timetracker.sqlite.bak-20260627T101500Z', createdUtc: '2026-06-27T10:15:00Z', sizeBytes: 40960 },
  { name: 'timetracker.sqlite.bak-20260626T090000Z', path: '/db/timetracker.sqlite.bak-20260626T090000Z', createdUtc: '2026-06-26T09:00:00Z', sizeBytes: 36864 },
];

/**
 * §12 R25 / §13 — the canned `getStoragePaths` view every scene's mock serves (the default
 * `storagePaths` knob). Mirrors mockups/settings.html's Storage group exactly: a CONFIG-set
 * database row (Change… enabled + Reset to default… present), an ENV-overridden backup
 * folder (labeled `env · TT_BACKUP_DIR`, Change… disabled, no Reset), the caption naming
 * the config file's own effective path, the default-rung targets the Reset flow aims at,
 * and a healthy §20 R14 probe.
 */
export const STORAGE_PATHS = {
  db: { path: '/home/kirby/tracking/timetracker.sqlite', source: 'config' },
  backupDir: { path: '/mnt/nas/stint-backups', source: 'env' },
  configFile: { path: '/home/kirby/.config/stint/config.json', source: 'default' },
  defaults: {
    dbPath: '/home/kirby/.local/share/stint/timetracker.sqlite',
    backupDir: '/home/kirby/tracking',
  },
  backupDirState: { ok: true, problem: null },
};

/**
 * §20 R14 — the broken-backup-directory variant: a CONFIG-set backup folder whose directory
 * is gone. The STORAGE_CHANGE_REFUSAL scene's second page asserts BOTH surfaces §20 R14
 * names render the error state — the Storage row and the Backups section — rather than an
 * innocent empty list.
 */
export function storageBrokenPaths() {
  return {
    ...STORAGE_PATHS,
    backupDir: { path: '/mnt/nas/stint-backups', source: 'config' },
    backupDirState: { ok: false, problem: 'does not exist' },
  };
}

/**
 * §12 R26 — the destination the mocked OS picker returns (the `storagePicked` knob's
 * default), and the §20 R12 migrate refusal the STORAGE_CHANGE_REFUSAL scene injects. The
 * refusal is the SHIPPING wording pinned by GOLD `contracts.test.ts` "migrate refuses an
 * existing destination file" — matching mockups/storage-change.html state 4 — so the scene
 * scores what the user reads, not a fixture-local sentence.
 */
export const STORAGE_PICKED = '/home/kirby/moved/timetracker.sqlite';
export const STORAGE_EXISTS_REFUSAL =
  `a file already exists at ${STORAGE_PICKED} — migrate never overwrites; pick a ` +
  `different location, or choose start fresh to adopt the existing file (it must ` +
  `pass the integrity and version checks); nothing has changed`;

/**
 * §20 R05 — the corruption-recovery fixture. Same Backups snapshot, but carrying a non-null
 * recoveryNotice (the DB was recovered from a backup on this launch): recoveredFrom names the
 * backup, quarantinedTo the `.corrupted` sibling the launch set aside. The RECOVERY_NOTICE scene
 * routes to Settings and asserts the one-shot recovery banner renders both, then that a Restore…
 * is still reachable from the same surface.
 */
export function recoveryState() {
  const s = backupsState();
  s.recoveryNotice = {
    recoveredFrom: 'timetracker.sqlite.bak-20260627T101500Z',
    quarantinedTo: '/db/timetracker.sqlite.corrupted-20260627T120500Z',
  };
  return s;
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
 *   - `failedVerdict` — the R03 FAILED-check verdict (STATES.md Settings × error): the error
 *                  result checkForUpdates returns when it cannot reach GitHub. Its message is
 *                  the SHIPPING copy, imported from the built ipc.js — the Check-now button
 *                  used to report the transport's words instead (`net::ERR_NAME_NOT_RESOLVED`,
 *                  issue 138), and a re-typed sentence here would keep passing after a reword.
 */
export const UPDATE_FIXTURE = {
  version: '2026.6.24',
  verdict: {
    status: 'update-available',
    currentVersion: '2026.6.24',
    latestVersion: '2026.7.1',
    releaseUrl: 'https://github.com/kdbanman/stint/releases/tag/v2026.7.1',
  },
  failedVerdict: {
    status: 'error',
    currentVersion: '2026.6.24',
    message: UPDATE_CHECK_FAILED,
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
 * §12 R07 (G5/G7) — the UNIFIED_FORM_ADD fixture. The unified add form's inline interval picker
 * reads the snapshot's CLOSED entries (via app.js snapshotEntries) so it can draw them gray on its
 * day column and paint overlaps yellow (warn-only). Two closed entries on 2026-06-24, under the
 * UNIFIED_FORM_ADD page's UTC pin so the pinned-clock default seed (22:00–23:00) lands on the same
 * local day:
 *   - 19:00–20:00 — well above the seeded 22:00–23:00 "me" span, a plain gray other (no overlap).
 *   - 22:15–23:15 — overlaps the seeded span (22:15–23:00 → yellow warn band).
 * listClients/listProjects (the CLIENTS/PROJECTS mocks) feed the form's client + project selects,
 * so the scene can pick Acme / API; the `add` mock records the Save payload into __ADDED__.
 */
export function addFormState() {
  const closed = [
    { id: 1, description: 'morning sync', clientLabel: 'Acme / API', startUtc: '2026-06-24T19:00:00Z', endUtc: '2026-06-24T20:00:00Z', billableSeconds: 3600, billable: true, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 3600, tags: [] },
    { id: 2, description: 'client call', clientLabel: 'Globex / Ops', startUtc: '2026-06-24T22:15:00Z', endUtc: '2026-06-24T23:15:00Z', billableSeconds: 3600, billable: true, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 3600, tags: [] },
  ];
  return {
    status: { running: false, entry: null },
    days: [{ day: '2026-06-24', entries: closed }],
    sleepFlaggedIds: [],
    settings: DEFAULT_SETTINGS,
  };
}

/**
 * §12 R15 — the inline interval-picker RECORDING fixture (record.mjs's §05 R05 / §12 R15 picker
 * tour). The unified form's inline picker reads the snapshot's CLOSED entries (via app.js
 * snapshotEntries) so it can draw them gray on its single-day column and paint overlaps yellow
 * (warn-only). Two closed entries on 2026-06-24, under the recording's UTC-pinned page so these
 * UTC instants land on a deterministic local day:
 *   - 09:00–11:00 — 'morning sync', the closed row the EDIT-CLOSED tour beat edits.
 *   - 14:00–15:00 — 'market research', the gray other the extended stop overlaps (→ yellow).
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
 * §12 R14 (G5) / §05 R06 — the TIMER_VIEW fixture. The canonical runningState (a single open
 * entry 'auth refactor' for 'Client A / API', started a fixed 01:24:07 before the pinned JUDGE
 * clock), so the Timer view's live clock reads a deterministic 01:24:07 that advances +3s on a
 * pinned-clock step, plus two CLOSED same-day entries so the inline START-ONLY picker
 * disclosure has other entries to paint gray on its track (the scene runs its page in
 * timezoneId 'UTC' so these UTC instants land on the same local day as the running start).
 * The scene drags the disclosure's start grip and asserts the recorded `edit` patch
 * (window.__EDITED__) carries startUtc but NEVER endUtc, so the row stays open.
 */
export function timerViewRunningState() {
  const s = runningState();
  s.days[0].entries.unshift(
    { id: 2, description: 'morning sync', clientLabel: 'Client A / API', startUtc: '2026-06-24T19:00:00Z', endUtc: '2026-06-24T20:00:00Z', billableSeconds: 3600, billable: true, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 3600, tags: [] },
    { id: 3, description: 'inbox triage', clientLabel: null, startUtc: '2026-06-24T20:30:00Z', endUtc: '2026-06-24T21:00:00Z', billableSeconds: 0, billable: false, overlapped: false, overlapMinutes: 0, overlapRelation: null, sleptThrough: false, excludedSeconds: 0, rawSeconds: 1800, tags: [] },
  );
  return s;
}

/**
 * design.html D04/D14 (issue #160) — the TIMER_VIEW attribute-vs-flag fixture. The canonical
 * running entry, still `billable`, but with its machine having slept mid-entry: so the running
 * card's attribute row paints BOTH kinds of thing side by side in one row — the `billable`
 * ATTRIBUTE (the entry's normal state) and the `slept` FLAG (the advisory). The scene reads the
 * computed colours off both at once, which is the only way to score the distinction rather than
 * one colour in isolation: `slept` must be the --flag warn triple and `billable` must not be.
 */
export function timerViewSleptRunningState() {
  const s = timerViewRunningState();
  s.status.entry.sleptThrough = true;
  s.days[0].entries.find((e) => e.id === 1).sleptThrough = true;
  return s;
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
export function initScript(stateJson, { overlap = false, rounding = false, summary = false, favorites = FAVORITES, update = null, startStopsOpen = false, toggleStarts = false, rejectWrites = false, futureStartGuard = false, emptyRefData = false, savedReports = SAVED_REPORTS, backups = BACKUPS, storagePaths = STORAGE_PATHS, storagePicked = STORAGE_PICKED, storageChangeResult = null } = {}) {
  return `
    window.__STATE__ = ${stateJson};
    // §12 R21 (WRITE_REJECTION_FEEDBACK) — when set, the write mocks REJECT like a strict core
    // (the strict-listEntries precedent, issue #55): add/edit/split/toggle/rename each reject with
    // a StoreError-shaped message, so the scene can drive a real refused write and assert the
    // renderer SURFACES it (an announced message region, the form staying open) instead of
    // swallowing it. Off by default → every other scene's writes resolve as before.
    window.__REJECT_WRITES__ = ${rejectWrites ? 'true' : 'false'};
    // Issue 138: every mocked rejection rejects the way ELECTRON does — ipcRenderer.invoke wraps
    // the reason in its own sentence and the thrown class name ("Error invoking remote method
    // 'edit': StoreError: <reason>"), and the app used to paint the whole string. A mock that
    // rejects with a pre-cleaned reason makes any "what does the user read" assertion vacuous:
    // there is nothing to strip, so a renderer that stripped nothing would still pass. This is
    // the shape the QA driver reproduces verbatim (packages/gui/qa/driver.mjs).
    window.__IPC_REJECT__ = (channel, reason) =>
      Promise.reject(new Error("Error invoking remote method '" + channel + "': StoreError: " + reason));
    // §05 R06 / §03 / issue #61 (FUTURE_START_GUARD) — when set, the edit mock refuses a live
    // start edit that lands AFTER now exactly as core's edit() refuses a future start on the open
    // row, so the scene can drive the REAL live-edit commit of a mistyped future start and assert
    // the Timer view SURFACES the refusal (#timer-warning) instead of a swallowed rejection — while
    // a start at-or-before now still commits. Off by default → every other scene's edits are unchanged.
    window.__FUTURE_START_GUARD__ = ${futureStartGuard ? 'true' : 'false'};
    // §05 R01 (RECORD only) — when set, the start mock performs core's atomic stop-then-start
    // ON the injected snapshot: it closes any currently-open row at the pinned now and inserts a
    // single fresh open row from the submitted attributes, so the subsequent load()/getState
    // repaint visibly SHOWS the previous timer stopping and the new entry becoming the one live
    // count-up (starting while a timer runs IS the atomic stop-then-start, §05 R01 — there is no
    // separate switch verb). Off by default → JUDGE's start mock is unchanged.
    window.__START_STOPS_OPEN__ = ${startStopsOpen ? 'true' : 'false'};
    // §12 R04 / issue #50 (CROSS_VIEW_FRESHNESS) — when set, the toggle mock mutates the
    // injected snapshot the way main's toggleTimer over core does: idle → a fresh open row at
    // the pinned now (status flips to running); running → the open row closes at now (status
    // flips to idle). The subsequent load()/getState repaint must then SHOW the flip, so a
    // scene can assert the Timer card mirrors tt status after a real toggle click. Off by
    // default → every other scene keeps the state-preserving, ack-only toggle.
    window.__TOGGLE_STARTS__ = ${toggleStarts ? 'true' : 'false'};
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
      // §07/§12 / issue #66: onChange is the main-process changed-broadcast the renderer
      // subscribes to; production emits it after EVERY write, so a Clients-view mutation
      // triggers a SECOND renderClients on top of the handler's own direct call. The mock now
      // CAPTURES the renderer's callback (and returns the unsubscribe) so the reference-data
      // mutators below can fire it after each write — reproducing the concurrent direct-call +
      // broadcast repaint the double-render bug rode (a no-op stub made that race structurally
      // impossible, so any cardinality assertion would have been vacuous).
      // MULTIPLE listeners, like the real ipcRenderer.on('changed', …): app.js, reports.js and
      // settings.js each subscribe, and production fires ALL of them on every broadcast. A single
      // slot would let the last registrant clobber app.js's clients-repaint callback — so the
      // broadcast would never re-render the Clients view and the double-render race could not occur.
      __ONCHANGE__: [],
      onChange: function (cb) { this.__ONCHANGE__.push(cb); return () => { this.__ONCHANGE__ = this.__ONCHANGE__.filter((f) => f !== cb); }; },
      __FIRE_CHANGED__: function () { for (const f of this.__ONCHANGE__.slice()) { try { f(); } catch { /* one listener throwing must not stop the rest (ipcRenderer parity) */ } } },
      // §12 R9: the Entries-view control bar's read-only query. The mock applies the SAME
      // narrowing core does — range (preset OR plain-date pair), billable, client/project
      // ids, tag, matchesQuery search — and the same grouping (day DESC, others ASC; tags
      // fan out), over the canned LIST_ENTRIES set, so the headless renderer narrows /
      // regroups exactly as production. Issue #55: it is also STRICT exactly where core
      // is — 'by' is REQUIRED (ListEntriesQuery), so a query without it REJECTS like
      // production instead of papering over the dropped key (which is how the dead-toolbar
      // regression slipped past JUDGE). Every request is logged (window.__LIST_REQS__) and
      // every rejection counted (window.__LIST_ERRORS__) so scenes can assert "no
      // listEntries call threw" and "every query carried the grouping". Returns the
      // grouped shape the renderer paints: { key, billableSeconds, entries } per group,
      // plus the (echoed) resolved range.
      __LIST_ENTRIES__: ${JSON.stringify(LIST_ENTRIES)},
      listEntries: function (q) {
        window.__LIST_REQ__ = q;
        (window.__LIST_REQS__ = window.__LIST_REQS__ || []).push(q);
        if (!q || q.by === undefined) {
          window.__LIST_ERRORS__ = (window.__LIST_ERRORS__ || 0) + 1;
          return Promise.reject(new TypeError(
            "listEntries: required grouping 'by' is missing — core's buildEntryList rejects this query (issue #55)",
          ));
        }
        let rows = this.__LIST_ENTRIES__.slice();
        // A named preset resolves to its local-day window, pinned to the JUDGE clock
        // (Wed 2026-06-24, weekStart monday) — the mock stand-in for core's resolveRange,
        // so the toolbar's range chips genuinely narrow the multi-week fixture.
        if (q.preset) {
          const windows = {
            'today': ['2026-06-24', '2026-06-24'],
            'week': ['2026-06-22', '2026-06-28'],
            'last-week': ['2026-06-15', '2026-06-21'],
            'month': ['2026-06-01', '2026-06-30'],
            'last-month': ['2026-05-01', '2026-05-31'],
          };
          const w = windows[q.preset];
          if (w) rows = rows.filter((e) => {
            const day = e.startUtc.slice(0, 10);
            return day >= w[0] && day <= w[1];
          });
        }
        // §09 R01 (G3): a custom range arrives as a PAIR OF PLAIN DATES (fromDate/toDate,
        // the raw YYYY-MM-DD strings of the two toolbar date fields — never a derived
        // instant). The mock narrows to the entries whose day falls inside the INCLUSIVE
        // day pair, standing in for main's resolveDateRange half-open local window, so the
        // ENTRIES_CALENDAR scene can assert the fields apply LIVE and narrow the rows.
        if (q.fromDate && q.toDate) {
          rows = rows.filter((e) => {
            const day = e.startUtc.slice(0, 10);
            return day >= q.fromDate && day <= q.toDate;
          });
        }
        if (q.billable === 'billable') rows = rows.filter((e) => e.billable);
        if (q.billable === 'non-billable') rows = rows.filter((e) => !e.billable);
        if (q.clientId !== undefined && q.clientId !== null) rows = rows.filter((e) => e.clientId === q.clientId);
        if (q.projectId !== undefined && q.projectId !== null) rows = rows.filter((e) => e.projectId === q.projectId);
        if (q.tag) rows = rows.filter((e) => (e.tags || []).includes(q.tag));
        if (q.search) {
          const needle = String(q.search).trim().toLowerCase();
          rows = rows.filter((e) => {
            const hay = [e.description, e.client, e.project, ...(e.tags || [])];
            return hay.some((h) => h != null && String(h).toLowerCase().includes(needle));
          });
        }
        const keysOf = (e) => {
          if (q.by === 'day') return [e.startUtc.slice(0, 10)];
          if (q.by === 'client') return [e.client || '(no client)'];
          if (q.by === 'project') return [e.project || '(no project)'];
          return (e.tags && e.tags.length) ? e.tags : ['(untagged)'];
        };
        const map = new Map();
        for (const e of rows) for (const k of keysOf(e)) {
          if (!map.has(k)) map.set(k, []);
          map.get(k).push(e);
        }
        let keys = [...map.keys()].sort((a, b) => a.localeCompare(b));
        if (q.by === 'day') keys.reverse();
        const groups = keys.map((key) => ({
          key,
          billableSeconds: map.get(key).reduce((s, e) => s + e.billableSeconds, 0),
          entries: map.get(key).map((e) => ({ ...e })),
        }));
        return Promise.resolve({ groups, rangeFromUtc: '2026-06-22T00:00:00.000Z', rangeToUtc: '2026-06-29T00:00:00.000Z' });
      },
      toggle: () => {
        // §12 R21: a strict core can refuse a stop (e.g. stop time before the entry started,
        // #61). The renderer must route it to the banner area, never a silent no-op.
        if (window.__REJECT_WRITES__) return window.__IPC_REJECT__('toggle', 'stop time is before the entry started');
        // issue #50 (CROSS_VIEW_FRESHNESS): the opt-in state-mutating toggle — see
        // window.__TOGGLE_STARTS__ above. Mirrors main.ts toggleTimer over core: stop the
        // open row when running, else start a fresh open row at the pinned now.
        if (window.__TOGGLE_STARTS__ && window.__STATE__) {
          const st = window.__STATE__;
          const now = window.__JUDGE_NOW__;
          if (st.status && st.status.running) {
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
            st.status = { running: false, entry: null };
          } else {
            const day = now.slice(0, 10);
            const fresh = {
              id: 300,
              description: null,
              clientLabel: null,
              startUtc: now,
              endUtc: null,
              billableSeconds: 0,
              billable: true,
              overlapped: false, overlapMinutes: 0, overlapRelation: null,
              sleptThrough: false, excludedSeconds: 0, rawSeconds: 0,
              tags: [],
            };
            let dayBlock = (st.days || []).find((d) => d.day === day);
            if (!dayBlock) { dayBlock = { day, entries: [] }; (st.days ||= []).unshift(dayBlock); }
            dayBlock.entries.unshift(fresh);
            st.status = { running: true, entry: { id: fresh.id, description: null, clientLabel: null, startUtc: now, billableSeconds: 0, billable: true, sleptThrough: false, excludedSeconds: 0, tags: [] } };
          }
        }
        return Promise.resolve(window.__ACK__);
      },
      // Records the attributed-start payload so the harness can assert the Start form
      // sends description/client/project/tags/billable (not a parameterless start).
      start: (p) => {
        window.__STARTED__ = p;
        // §05 R01 (RECORD): emulate core's atomic stop-then-start on the snapshot so the
        // recording shows the start-while-running close. Close the open row at the pinned now,
        // then make the submitted attributes the single new open row; getState repaints the new
        // live count-up — starting while a timer runs IS the atomic stop-then-start (no switch verb).
        if (window.__START_STOPS_OPEN__ && window.__STATE__) {
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
      // §12 R21 / design.html D15: under __REJECT_WRITES__ the backfill rejects like core refusing
      // an inverted span (store.add's 'stop time must be after start time'), so the
      // ADD_REFUSAL_PALETTE scene can drive a real refused Save and score what the region paints.
      add: (p) => {
        if (window.__REJECT_WRITES__) return window.__IPC_REJECT__('add', 'stop time must be after start time');
        window.__ADDED__ = p;
        return Promise.resolve(window.__ACK__);
      },
      // §07: the reference-data reads/mutators the Clients view drives. listClients /
      // listProjects return the canned active clients/projects (archived excluded by
      // default); the mutators record their payload so the CLIENTS_VIEW scene can assert
      // the rename/archive affordances send the entity id over the same IPC tt uses.
      // §12 R05/R10 (STATES.md Clients × empty): the emptyRefData knob (the favorites:[]
      // precedent) injects a NEVER-POPULATED reference-data store — no clients, no projects,
      // no tags, nothing archived — so a scene can assert the instructive "No clients yet" /
      // "No tags yet" empty states. Off by default → every other scene's data is unchanged.
      __CLIENTS__: ${JSON.stringify(emptyRefData ? [] : CLIENTS)},
      __PROJECTS__: ${JSON.stringify(emptyRefData ? {} : PROJECTS)},
      // §12 R13: includeArchived merges the archived-record store so the "show archived" toggle
      // can reveal the hidden clients/projects (parity with tt ... ls --archived).
      listClients: function (p) { return Promise.resolve((p && p.includeArchived) ? this.__CLIENTS__.concat(this.__ARCHIVED_STORE__.clients) : this.__CLIENTS__); },
      listProjects: function (p) { const cid = p && p.clientId; const base = this.__PROJECTS__[cid] || []; const arch = (p && p.includeArchived) ? this.__ARCHIVED_STORE__.projects.filter((x) => x.clientId === cid) : []; return Promise.resolve(base.concat(arch)); },
      // The mutators are STATEFUL like production core: they record their payload (so a scene
      // §12 R21: under __REJECT_WRITES__ the rename mutators reject like core refusing a
      // colliding name (§13 UNIQUE COLLATE NOCASE), so the inline rename form surfaces it
      // instead of no-op'ing — the WRITE_REJECTION_FEEDBACK scene drives this.
      // can assert what the renderer sent), apply the change to the canned lists (create appends,
      // rename updates the name, archive drops from the active list), and fire the changed
      // broadcast (issue #66) — so a write → re-render actually lands / renames / removes the
      // item in the active list (the end-to-end fact the CLIENTS_VIEW scene drives, issue #48)
      // AND drives the broadcast repaint on top of the handler's own direct renderClients call.
      addClient: function (p) { window.__ADDED_CLIENT__ = p; const c = { id: 99, name: (p && p.name) || '', archived: false }; this.__CLIENTS__.push(c); this.__FIRE_CHANGED__(); return Promise.resolve(c); },
      addProject: function (p) { window.__ADDED_PROJECT__ = p; const pr = { id: 98, clientId: (p && p.clientId), name: (p && p.name) || '', archived: false }; (this.__PROJECTS__[pr.clientId] = this.__PROJECTS__[pr.clientId] || []).push(pr); this.__FIRE_CHANGED__(); return Promise.resolve(pr); },
      renameClient: function (p) { if (window.__REJECT_WRITES__) return window.__IPC_REJECT__('renameClient', 'a client named that already exists'); window.__RENAMED_CLIENT__ = p; const c = this.__CLIENTS__.find((x) => x.id === (p && p.id)); if (c && p && p.name) c.name = p.name; this.__FIRE_CHANGED__(); return Promise.resolve(); },
      // §12 R13: __ARCHIVE_CLIENT_CALLS__ records EACH archiveClient invocation so the
      // CONFIRM_ARCHIVE scene can assert the stray first click fired ZERO and only the explicit
      // confirm fired exactly ONE. restoreClient/Project/Tag re-add the record (archived → active).
      archiveClient: function (p) { window.__ARCHIVED_CLIENT__ = p; (window.__ARCHIVE_CLIENT_CALLS__ ||= []).push(p); this.__CLIENTS__ = this.__CLIENTS__.filter((x) => x.id !== (p && p.id)); this.__FIRE_CHANGED__(); return Promise.resolve(); },
      restoreClient: function (p) { window.__RESTORED_CLIENT__ = p; const c = this.__ARCHIVED_STORE__.clients.find((x) => x.id === (p && p.id)); if (c) { c.archived = false; this.__CLIENTS__.push(c); this.__ARCHIVED_STORE__.clients = this.__ARCHIVED_STORE__.clients.filter((x) => x.id !== c.id); } this.__FIRE_CHANGED__(); return Promise.resolve(); },
      restoreProject: function (p) { window.__RESTORED_PROJECT__ = p; const pr = this.__ARCHIVED_STORE__.projects.find((x) => x.id === (p && p.id)); if (pr) { pr.archived = false; (this.__PROJECTS__[pr.clientId] = this.__PROJECTS__[pr.clientId] || []).push(pr); this.__ARCHIVED_STORE__.projects = this.__ARCHIVED_STORE__.projects.filter((x) => x.id !== pr.id); } this.__FIRE_CHANGED__(); return Promise.resolve(); },
      restoreTag: function (p) { window.__RESTORED_TAG__ = p; const t = this.__ARCHIVED_STORE__.tags.find((x) => x.id === (p && p.id)); if (t) { t.archived = false; this.__TAGS__.push(t); this.__ARCHIVED_STORE__.tags = this.__ARCHIVED_STORE__.tags.filter((x) => x.id !== t.id); } this.__FIRE_CHANGED__(); return Promise.resolve(); },
      // §12 R13: the archived-record store the "show archived" listing reads from and Restore
      // moves back. Seeded with one archived client/project/tag so the RESTORE_ARCHIVED scene can
      // reveal them (listClients/listProjects/listTags with includeArchived) and Restore each.
      __ARCHIVED_STORE__: ${emptyRefData ? `{ clients: [], projects: [], tags: [] }` : `{ clients: [{ id: 3, name: 'Initech', archived: true, referenced: true }], projects: [{ id: 13, clientId: 1, name: 'Legacy', archived: true, referenced: true }], tags: [{ id: 3, name: 'stale', archived: true }] }`},
      renameProject: function (p) { if (window.__REJECT_WRITES__) return window.__IPC_REJECT__('renameProject', 'a project named that already exists'); window.__RENAMED_PROJECT__ = p; for (const k of Object.keys(this.__PROJECTS__)) { const pr = this.__PROJECTS__[k].find((x) => x.id === (p && p.id)); if (pr && p && p.name) pr.name = p.name; } this.__FIRE_CHANGED__(); return Promise.resolve(); },
      archiveProject: function (p) { window.__ARCHIVED_PROJECT__ = p; for (const k of Object.keys(this.__PROJECTS__)) { this.__PROJECTS__[k] = this.__PROJECTS__[k].filter((x) => x.id !== (p && p.id)); } this.__FIRE_CHANGED__(); return Promise.resolve(); },
      // §12 R10: the tag-management channels the Clients view's tag strip drives (parity
      // with tt tag ls/add/rename/archive). listTags returns the canned active tags; the
      // mutators record their payload so a scene could assert what the strip sends. Present
      // here so window.stint exposes EVERY IPC channel — the PARITY_REACH deterministic
      // sub-fact (every channel has a window.stint method) reads this surface.
      __TAGS__: ${JSON.stringify(emptyRefData ? [] : [{ id: 1, name: 'deep', archived: false }, { id: 2, name: 'urgent', archived: false }])},
      listTags: function (p) { return Promise.resolve((p && p.includeArchived) ? this.__TAGS__.concat(this.__ARCHIVED_STORE__.tags) : this.__TAGS__); },
      addTag: function (p) { window.__ADDED_TAG__ = p; const t = { id: 97, name: (p && p.name) || '', archived: false }; this.__TAGS__.push(t); this.__FIRE_CHANGED__(); return Promise.resolve(t); },
      renameTag: function (p) { if (window.__REJECT_WRITES__) return window.__IPC_REJECT__('renameTag', 'a tag named that already exists'); window.__RENAMED_TAG__ = p; const t = this.__TAGS__.find((x) => x.id === (p && p.id)); if (t && p && p.name) t.name = p.name; this.__FIRE_CHANGED__(); return Promise.resolve(); },
      archiveTag: function (p) { window.__ARCHIVED_TAG__ = p; this.__TAGS__ = this.__TAGS__.filter((x) => x.id !== (p && p.id)); this.__FIRE_CHANGED__(); return Promise.resolve(); },
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
      // §12 R10: toggle the excluded/slept seconds on the snapshot entry so a re-read (getState)
      // shows the trimmed then restored billable — the unified editor's reversible sleep control
      // reads this back after each call (core's store.subtractSleep is the real toggle; the mock
      // mirrors it). sleptSeconds is the fixture's recorded-sleep stand-in (core sums real spans).
      subtractSleep: (p) => {
        const id = p && p.id;
        if (id != null && window.__STATE__ && Array.isArray(window.__STATE__.days)) {
          for (const d of window.__STATE__.days)
            for (const e of d.entries) {
              if (e.id !== id || !e.sleptThrough) continue;
              const raw = e.rawSeconds != null ? e.rawSeconds : e.billableSeconds;
              const slept =
                e.sleptSeconds != null ? e.sleptSeconds : Math.max(0, raw - e.billableSeconds);
              const restore = (e.excludedSeconds || 0) > 0;
              e.rawSeconds = raw;
              e.excludedSeconds = restore ? 0 : slept;
              e.billableSeconds = raw - e.excludedSeconds;
            }
        }
        return Promise.resolve();
      },
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
      // §12 R21: under __REJECT_WRITES__ the edit rejects like core refusing a Stop-before-Start
      // (§05 R11), so the WRITE_REJECTION_FEEDBACK scene can assert the editor surfaces it inline.
      edit: (p) => {
        if (window.__REJECT_WRITES__) return window.__IPC_REJECT__('edit', 'entry end must be after its start');
        // §05 R06 / issue #61: under the future-start guard, a live start edit landing AFTER now is
        // refused exactly as core's edit() refuses it (a future start on the running row bricks Stop),
        // so the FUTURE_START_GUARD scene can assert the Timer view surfaces it, never a swallowed
        // rejection. A start at-or-before now still records + resolves, so the corrected retype commits.
        if (window.__FUTURE_START_GUARD__ && p && p.patch && p.patch.startUtc &&
            Date.parse(p.patch.startUtc) > Date.parse(window.__JUDGE_NOW__)) {
          return window.__IPC_REJECT__('edit', 'start time is in the future');
        }
        window.__EDITED__ = p; return Promise.resolve(window.__ACK__);
      },
      // Records the split payload so the SPLIT_AFFORDANCE scene can drive the inline
      // picker without erroring; core owns the in-span rule, so the mock just resolves.
      // §12 R21: under __REJECT_WRITES__ it rejects like core's strictly-in-span rule.
      split: (p) => {
        if (window.__REJECT_WRITES__) return window.__IPC_REJECT__('split', 'split point must be strictly inside the entry span');
        window.__SPLIT__ = p; return Promise.resolve(window.__ACK__);
      },
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
      // §20 R04 (STATES.md Settings × empty): the backups knob (default BACKUPS) lets a scene
      // inject [] — a never-backed-up launch — so the "No backups yet…" / "No backups to
      // restore from yet." empty copies can be asserted. Default → every other scene unchanged.
      __BACKUPS__: ${JSON.stringify(backups)},
      listBackups: function () { return Promise.resolve(this.__BACKUPS__); },
      restoreBackup: (p) => {
        window.__RESTORED_BACKUP__ = p;
        return Promise.resolve({ recoveredFrom: (p && p.name) || '', quarantinedTo: '/db/timetracker.sqlite.replaced-20260627T120000Z' });
      },
      // §12 R25 / §13: the Settings Storage group's read — the three effective paths +
      // sources + the §20 R14 probe (parity twin: tt paths). The storagePaths knob
      // (default STORAGE_PATHS, mirroring mockups/settings.html) lets the refusal scene
      // inject the broken-backup-directory variant. Present so window.stint exposes EVERY
      // IPC channel — PARITY_REACH's deterministic sub-fact reads this surface.
      __STORAGE_PATHS__: ${JSON.stringify(storagePaths)},
      getStoragePaths: function () { return Promise.resolve(this.__STORAGE_PATHS__); },
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
      // §09 R06/R09: the Reports view's exports — the report's own filtered Export CSV/JSON
      // (scope 'filtered') and Export All Data (scope 'all'). The renderer rounds the export
      // through main (it cannot touch fs); the mock records the requested format + scope + range
      // so the REPORTS_VIEW scene can assert each button drives a real exportEntries call, and
      // returns a written-shaped result (a fixed path + count) without touching disk.
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
      // §12 R08 (STATES.md Reports × empty): the savedReports knob (default SAVED_REPORTS)
      // lets a scene inject [] so the #rep-defs-empty "No saved reports yet." state can be
      // asserted. Default → every other scene's seeded defs are unchanged.
      __SAVED_REPORTS__: ${JSON.stringify(savedReports)},
      listReports: function () { return Promise.resolve(this.__SAVED_REPORTS__.map((d) => ({ ...d }))); },
      showReport: function (p) {
        const name = p && p.name;
        const def = this.__SAVED_REPORTS__.find((d) => d.name === name);
        return Promise.resolve(def ? { ...def } : null);
      },
      saveReport: function (p) {
        // §12 R21 / §09 R01: core refuses an inverted absolute range (From after To) — it only
        // ever resolves to an empty window, so it is rejected rather than stored. The mock mirrors
        // that guard on the plain-date pair (lexical YYYY-MM-DD compare, the same order the UTC
        // window carries; same-day from == to is VALID, ≤ not <) so the REPORTS_VIEW inverted-range
        // refusal fact drives a real rejection. Rejects BEFORE recording, so nothing persists.
        const rs = p && p.rangeSpec;
        if (rs && rs.kind === 'absolute' && rs.fromDate && rs.toDate && rs.fromDate > rs.toDate) {
          return window.__IPC_REJECT__('saveReport', 'report range end must not be before its start');
        }
        // §12 R21 / §13: core refuses a duplicate report name (UNIQUE COLLATE NOCASE). The mock
        // mirrors that guard (case-insensitive) so the REPORTS_VIEW duplicate-name refusal fact
        // drives a real rejection — it rejects BEFORE recording, so a refused save leaves no trace.
        const dup = this.__SAVED_REPORTS__.some((d) => d.name.toLowerCase() === String((p && p.name) || '').toLowerCase());
        if (dup) return window.__IPC_REJECT__('saveReport', 'a saved report named that already exists');
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
        // §05 R09: __UNPIN_CALLS__ records EACH invocation so the FAVORITES_RAIL scene can
        // assert the kebab's Unpin fired EXACTLY once (the CONFIRM_ARCHIVE call-list precedent).
        (window.__UNPIN_CALLS__ ||= []).push(p);
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
        // §19 R03 / issue 138 — with checkFails set, Check now resolves the FAILED verdict
        // (checkForUpdates never throws; a failure is a value), so the scene can assert what
        // the Settings result line READS when the check cannot reach GitHub.
        check: () => {
          window.__CHECKED__ = true;
          const u = window.__UPDATE__;
          return Promise.resolve(u.checkFails ? u.failedVerdict : u.verdict);
        },
        download: () => {
          // §19 R04 (STATES.md Settings × error): with the fixture's downloadError flag set the
          // download REJECTS before any progress frame — the failed-fetch path — so the scene
          // can assert the panel flips to its error phase ("The update download failed.") and
          // stays operable. __DOWNLOAD_FAILED__ records the rejection; __DOWNLOADED__ stays
          // unset. Off by default → the happy-path replay below is unchanged.
          if (window.__UPDATE__.downloadError) {
            window.__DOWNLOAD_FAILED__ = true;
            return Promise.reject(new Error('network unreachable'));
          }
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
    // §12 R26 — the GUI-only storage-change bridge (window.stint.storage), mirroring the
    // EXACT preload shape (pickDbPath / pickBackupDir / changeDb / changeBackupDir). Off
    // the parity-asserted CHANNELS set like update (architecture.html §08 — the write
    // side's CLI counterpart is the documented §13 config-file procedure, not a verb).
    // Deterministic: the pickers resolve the canned destination (the storagePicked knob),
    // and the two change calls RECORD their payload on window.__STORAGE_CHANGES__ (so the
    // armed scene can prove arming writes NOTHING and the confirm fires EXACTLY ONCE)
    // before resolving the storageChangeResult knob — null means the success value main
    // returns just before relaunching; the refusal scene injects an { ok: false } value
    // carrying the SHIPPING §20 R12 wording (STORAGE_EXISTS_REFUSAL).
    window.__STORAGE_PICKED__ = ${JSON.stringify(storagePicked)};
    window.__STORAGE_RESULT__ = ${storageChangeResult ? JSON.stringify(storageChangeResult) : 'null'};
    window.__STORAGE_CHANGES__ = [];
    window.stint.storage = {
      pickDbPath: () => Promise.resolve(window.__STORAGE_PICKED__),
      pickBackupDir: () => Promise.resolve(window.__STORAGE_PICKED__),
      changeDb: (p) => {
        window.__STORAGE_CHANGES__.push({ kind: 'db', payload: p });
        return Promise.resolve(window.__STORAGE_RESULT__ || { ok: true, message: 'migrated the database to ' + ((p && p.newDbPath) || '') + '; the old database is kept in place, untouched' });
      },
      changeBackupDir: (p) => {
        window.__STORAGE_CHANGES__.push({ kind: 'backupDir', payload: p });
        return Promise.resolve(window.__STORAGE_RESULT__ || { ok: true, message: 'the backup directory is now ' + ((p && p.newBackupDir) || '') });
      },
    };
  `;
}
