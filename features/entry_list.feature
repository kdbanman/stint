Feature: Entry list — range, filtering & search (§11)
  # PRD §11 — `tt list` (and core store.listEntries) return ONE flat, ungrouped set of entries
  # for a range, narrowed by client / project / tag and free-text search. Grouping left the
  # list entirely for Reports (`tt report --by` / GUI Reports, G11) — there is no `--by` flag.
  # This locks that CONTRACT; it runs TWICE — over @stint/core (store.listEntries) and over tt
  # (`tt list … --json`) — so the surfaces are proven to list the identical flat set (§17 R8).
  # The fixed clock is a Wednesday (2026-06-24); the entries below all fall in that week, on
  # day 1 (Jun 24) or day 2 (Jun 23). (The 60-char first-line description cap is a CLI-human
  # rendering concern — asserted in GOLD, not here.)

  Background:
    Given an empty database
    And a client "Acme" with project "Billing"
    And a client "Globex" with project "Ops"
    And a closed entry "auth refactor" for "Acme" / "Billing" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "deploy pipeline" for "Globex" / "Ops" tagged "ci,deep" this week on day 2 lasting 1 hour
    And a closed entry "standup" for "Acme" / "Billing" tagged "meeting" this week on day 2 lasting 1 hour

  Scenario: The whole week lists as one flat, ungrouped set
    When I list entries this week
    Then the entry list is exactly "auth refactor,deploy pipeline,standup"

  Scenario: A custom range includes only in-range entries
    # A range covering only day 2 (Jun 23) captures that day's entries and excludes day 1's.
    When I list entries for the range 2026-06-23T00:00:00Z to 2026-06-24T00:00:00Z
    Then the entry list is exactly "deploy pipeline,standup"
    And the entry list does not show "auth refactor"

  Scenario: A client filter narrows the list
    When I list entries this week
    And I filter the entry list to client "Acme"
    Then the entry list is exactly "auth refactor,standup"
    And the entry list does not show "deploy pipeline"

  Scenario: A project filter narrows the list
    When I list entries this week
    And I filter the entry list to project "Ops"
    Then the entry list is exactly "deploy pipeline"
    And the entry list does not show "auth refactor"

  Scenario: A tag filter narrows the list
    When I list entries this week
    And I filter the entry list to tag "meeting"
    Then the entry list is exactly "standup"
    And the entry list does not show "deploy pipeline"

  Scenario: A search query matches on description, excluding non-matches
    When I list entries this week
    And I search the entry list for "refactor"
    Then the entry list is exactly "auth refactor"
    And the entry list does not show "deploy pipeline"
    And the entry list does not show "standup"

  Scenario: Search matches the client / project / tag, not just the description
    When I list entries this week
    And I search the entry list for "globex"
    Then the entry list is exactly "deploy pipeline"
    And the entry list does not show "auth refactor"

  Scenario: A tag filter keeps each surviving entry once (no fan-out)
    # A multi-tag entry ("deploy pipeline" is tagged ci,deep) appears exactly ONCE in the flat
    # list — the by-tag fan-out that grouping used to do is gone with grouping (G11).
    When I list entries this week
    And I filter the entry list to tag "deep"
    Then the entry list is exactly "auth refactor,deploy pipeline"
    And the entry list does not show "standup"

  Scenario: A range with client + project + tag filters and a free-text search list the same flat set on both surfaces
    # §11 / §17 R8 — every narrowing field applied together returns exactly the same flat,
    # ungrouped set on core (store.listEntries) and tt (`tt list … --json`), proving the two
    # surfaces list identically after grouping left the command.
    When I list entries this week
    And I filter the entry list to client "Globex"
    And I filter the entry list to project "Ops"
    And I filter the entry list to tag "deep"
    And I search the entry list for "deploy"
    Then the entry list is exactly "deploy pipeline"
    And the entry list does not show "auth refactor"
    And the entry list does not show "standup"

  Scenario: A description with embedded newlines is stored and reported verbatim
    # §05 R10 / §17 R8 — a description typed with a line break is kept VERBATIM: the interior
    # newline survives storage and full-fidelity reporting identically on both surfaces (core
    # store.listEntries description, tt list --all --json description). The newline lives in the
    # step definition, not this Gherkin cell, so the feature text stays single-line.
    When I add a closed entry with a two-line description
    Then the stored description keeps both lines verbatim
