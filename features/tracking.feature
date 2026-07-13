Feature: Tracking and backfill
  # PRD §05 — start / stop / status / resume / backfill; billable defaults.

  Background:
    Given an empty database
    And a client "Client A" with project "API"

  Scenario: Resume copies attributes but is a new entry
    # PRD §05 R4 + glossary: resume is never a re-opening of the old row.
    Given I start an entry "auth refactor" for "Client A" / "API" at 09:00
    And I stop at 10:00
    When I resume
    Then the open entry is "auth refactor"
    And the open entry is for "Client A / API"
    And the open entry is billable
    And the open entry has a different id from the original

  Scenario: Starting while running stops the open entry first
    # PRD §05 R01 — Start is the atomic stop-then-start: starting while a timer
    # runs stops the open entry first, so switching IS starting with no separate
    # verb. Uses only the `start` step (no `switch`), run twice (core store.start +
    # tt start) — proving the start-as-switch behaviour at full parity across both
    # surfaces with no dedicated action.
    Given I start an entry "auth refactor" for "Client A" / "API" at 09:00
    When I start an entry "code review" at 10:30
    Then exactly one entry is open
    And the entry "auth refactor" is closed with end 10:30
    And the open entry is "code review"

  Scenario: A clientless timer defaults to non-billable internal time
    # PRD §05 R7, §08 — clientless defaults to non-billable.
    When I start an entry "inbox triage" at 09:00
    Then the open entry is non-billable

  Scenario: A timer with a client defaults to billable
    When I start an entry "auth refactor" for "Client A" / "API" at 09:00
    Then the open entry is billable

  Scenario: An explicit billable flag overrides the clientless non-billable default
    # PRD §08 — the client-derived default is a default, not a rule; it can be overridden.
    When I start an entry "internal demo prep" at 09:00
    And I mark the open entry billable
    Then the open entry is billable

  Scenario: A client entry can be marked non-billable as goodwill
    # PRD §08 — billable is an explicit attribute, overridable against the client default.
    When I start an entry "goodwill fix" for "Client A" / "API" at 09:00
    And I mark the open entry non-billable
    Then the open entry is non-billable

  # PRD §05 R05 (core: core data entry) — manual backfill creates a COMPLETED entry from
  # explicit from/to. Runs twice (CoreWorld.backfill = store.add, CliWorld.backfill =
  # `tt add --from --to`), proving the core-entry behaviour is identical and reachable on
  # both surfaces. In the GUI the from/to span is chosen on the unified entry form's
  # inline interval picker (§12 R07/R15) — or typed exactly in the collapsed Start/Stop
  # expander (§12 R17), the overnight path — both writing the same shared form values that
  # "Save entry" commits over the same add capability; this surface-neutral scenario stays
  # the core-entry AC regardless of which input drove the values.
  Scenario: Backfill creates a completed entry
    When I backfill an entry "spec review" from 13:00 to 14:30
    Then exactly zero entries are open
    And the entry "spec review" has a billable duration of 90 minutes

  # PRD §05 R05 + §06 R04 (core: core data entry) — a manual backfill that lands ON an
  # existing span is WARNED, not blocked: the completed entry still PERSISTS. Runs TWICE
  # (CoreWorld.backfill = store.add, CliWorld.backfill = `tt add --from --to`), proving the
  # core-entry behaviour is identical and reachable on both surfaces. In the GUI the
  # overlapping from/to is chosen on the unified entry form's inline interval picker — whose
  # yellow overlap band is advisory, never a block — or typed exactly in the collapsed
  # Start/Stop expander (§12 R07/R15/R17), both writing the same shared form values that
  # "Save entry" commits over this same add capability. This surface-neutral scenario is the
  # core-entry AC whichever GUI input drove the values. Fails if add BLOCKS on overlap, leaves
  # an entry open, or the two surfaces diverge — the exact regressions a warn-not-block
  # backfill must never introduce.
  Scenario: Backfill overlapping an existing entry is allowed
    Given a closed entry "morning sync" from 13:00 to 14:00
    When I backfill an entry "spec review" from 13:00 to 14:30
    Then exactly zero entries are open
    And a non-blocking overlap warning is surfaced
    And the entry "spec review" has a billable duration of 90 minutes
    And both entries are flagged overlapped in a report covering the day

  # PRD §05 R06 — the running entry is editable (even its start) and its end does not exist
  # until it is stopped: editing the open row never closes it and never synthesizes an end
  # instant. Runs TWICE (CoreWorld store.edit + CliWorld `tt edit`), proving the amend-start
  # path is identical on both surfaces. In the GUI the same amendment is made by dragging the
  # start grip of the START-ONLY interval-picker variant (§12 R14/R15) — an affordance that is
  # structurally incapable of producing an end value — riding the same edit capability with a
  # patch that never carries an end. Fails if any surface's edit path stops the open row or
  # writes/synthesizes an end instant (e.g. defaulting the end to "now" on edit).
  Scenario: Editing the running entry start never closes it and never synthesizes an end
    Given I start an entry "auth refactor" for "Client A" / "API" at 09:00
    When I edit the open entry start to 08:30
    Then exactly one entry is open
    And the open entry starts at 08:30
    And the open entry has no end
