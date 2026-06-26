Feature: Overlap, split and merge
  # PRD §06 — editing; overlap warns-not-blocks; split/merge.

  Background:
    Given an empty database
    And a client "Client A" with project "API"

  Scenario: Backfill that overlaps an existing entry is warned, not blocked
    # PRD §06 R4 — overlap is allowed if meant, and flagged downstream.
    Given a closed entry "morning" from 09:00 to 11:00
    When I backfill an entry "call" from 10:00 to 10:30
    Then the backfill succeeds
    And a non-blocking overlap warning is surfaced
    And both entries are flagged overlapped in a report covering the day

  Scenario: Split then merge restores the original span
    # PRD §06 R2/R3 — split and merge round-trip on the covered span.
    Given a closed entry "block" from 09:00 to 12:00
    When I split it at 10:30
    Then there are two entries covering 09:00 to 12:00
    When I merge those two entries
    Then there is one entry from 09:00 to 12:00

  Scenario: Merge concatenates descriptions and keeps the first entry's client
    Given a closed entry "part one" for "Client A" / "API" from 09:00 to 10:00
    And a closed entry "part two" from 10:00 to 11:00
    When I merge those two entries
    Then the merged entry runs from 09:00 to 11:00
    And the merged entry is for "Client A / API"
