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

  Scenario: Switch stops the open entry and starts a new one as one action
    # PRD §05 R8 — Switch is a single named action: stop-then-start, atomic. Runs
    # twice (CoreWorld.switch = store.start, CliWorld.switch = `tt switch`), proving
    # the named action is at full parity across both surfaces.
    Given I start an entry "auth refactor" for "Client A" / "API" at 09:00
    When I switch to an entry "code review" at 10:30
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
  # both surfaces. The GUI from/to fields also open the §12 R15 range picker, but text
  # entry stays authoritative, so this surface-neutral scenario is the core-entry AC.
  Scenario: Backfill creates a completed entry
    When I backfill an entry "spec review" from 13:00 to 14:30
    Then exactly zero entries are open
    And the entry "spec review" has a billable duration of 90 minutes
