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

  Scenario: Attribute-bearing backfill that overlaps is warned, not blocked
    # PRD §12 R7 / §06 R4 — the GUI Manual-add form backfills a completed entry carrying
    # client/project alongside its explicit from/to (the same attribute set tt add accepts);
    # an overlapping span is warned, not blocked, and the entry is first-class (billable by
    # the client rule, labelled, flagged). The surface-neutral parity twin of the GUI form.
    Given a closed entry "morning" from 09:00 to 11:00
    When I backfill an entry "design review" for "Client A" / "API" from 10:00 to 10:30
    Then the backfill succeeds
    And a non-blocking overlap warning is surfaced
    And the entry "design review" is for "Client A / API"
    And the entry "design review" is billable
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

  Scenario: Merge resolving to a chosen client overrides the first-entry default
    # PRD §06 / §16 — merge keeps the first entry's attributes unless --client/--project override.
    Given a closed entry "part one" for "Client A" from 09:00 to 10:00
    And a closed entry "part two" for "Client B" from 10:00 to 11:00
    When I merge those two entries resolving to client "Client B"
    Then the merged entry runs from 09:00 to 11:00
    And the merged entry is for "Client B"

  Scenario: Editing amends a field without disturbing the open state
    # PRD §05 R6, §06 R1 — any field is editable; the entry stays as it was otherwise.
    Given I start an entry "draft" at 09:00
    When I edit the entry "draft" description to "final draft"
    Then exactly one entry is open
    And the open entry is "final draft"

  Scenario: Deleting an entry removes it and its time from the list
    # PRD §06 R1 — an entry can be deleted outright; the row is gone and the surviving
    # entries are exactly the rest (the deleted entry's time no longer counts). The
    # confirmation gate is a surface concern (GOLD/JUDGE); this proves the underlying
    # delete arithmetic is identical on core and tt.
    Given a closed entry "keep" from 09:00 to 10:00
    And a closed entry "scratch" from 10:00 to 11:00
    When I delete the entry "scratch"
    Then there is no entry "scratch"
    And there are exactly 1 entries
    And the entry "keep" is closed with end 10:00

  Scenario: Editing the running entry's start does not stop it
    # PRD §05 R6 — the open entry is editable, including its start, without closing it.
    Given I start an entry "deep work" at 09:00
    When I edit the open entry start to 08:30
    Then exactly one entry is open
    And the open entry starts at 08:30

  Scenario: Renaming a client flows the new name onto its entries
    # PRD §07 — clients/projects are renamable; labels are resolved, not copied.
    Given a closed entry "spec" for "Client A" / "API" from 09:00 to 10:00
    When I rename client "Client A" to "Acme Corp"
    Then the entry "spec" is for "Acme Corp / API"

  Scenario: Archiving a client hides it from the active list but keeps its history
    # PRD §07 — archive is reversible hiding, never deletion; past entries keep their label.
    Given a closed entry "spec" for "Client A" / "API" from 09:00 to 10:00
    When I archive client "Client A"
    Then client "Client A" is not in the active client list
    And the entry "spec" is for "Client A / API"

  Scenario: Renaming a project flows the new name onto its entries
    # PRD §07 — projects are renamable too; labels are resolved, not copied.
    Given a closed entry "spec" for "Client A" / "API" from 09:00 to 10:00
    When I rename project "API" to "Platform"
    Then the entry "spec" is for "Client A / Platform"

  Scenario: Archiving a project hides it from the active list but keeps its history
    # PRD §07 — archive is reversible hiding, never deletion; past entries keep their label.
    Given a closed entry "spec" for "Client A" / "API" from 09:00 to 10:00
    When I archive project "API"
    Then project "API" is not in the active project list
    And the entry "spec" is for "Client A / API"
