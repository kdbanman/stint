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

  Scenario: Backfill creates a completed entry
    When I backfill an entry "spec review" from 13:00 to 14:30
    Then exactly zero entries are open
    And the entry "spec review" has a billable duration of 90 minutes
