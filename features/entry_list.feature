Feature: Entries-view grouping, filtering & search (§12 R9)
  # PRD §12 R9 — the Entries view's control bar: group the entry list by day / client /
  # project / tag, narrow it by a range preset (or custom range) and by client / project /
  # tag, and search it free-text — all over one core model (buildEntryList) so the GUI
  # Entries view (gui/renderer/index.html #entries-ctrl → window.stint.listEntries) and
  # `tt list --by/--search/--range/--client/--project/--tag` group and match identically.
  # This locks that CONTRACT; it runs TWICE — over @stint/core (store.listEntries +
  # buildEntryList) and over tt (`tt list … --json` re-grouped through the SAME core
  # buildEntryList) — so the surfaces are proven identical (§17 R8). The fixed clock is a
  # Wednesday (2026-06-24); the entries below all fall in that week, on day 1 (Jun 24) or
  # day 2 (Jun 23) so by-day grouping is observable.

  Background:
    Given an empty database
    And a client "Acme" with project "Billing"
    And a client "Globex" with project "Ops"
    And a closed entry "auth refactor" for "Acme" / "Billing" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "deploy pipeline" for "Globex" / "Ops" tagged "ci,deep" this week on day 2 lasting 1 hour
    And a closed entry "standup" for "Acme" / "Billing" tagged "meeting" this week on day 2 lasting 1 hour

  Scenario: Grouping by client buckets each client's entries
    When I view entries this week grouped by client
    Then the entry list has groups exactly "Acme,Globex"
    And the entry list shows "auth refactor" under group "Acme"
    And the entry list shows "standup" under group "Acme"
    And the entry list shows "deploy pipeline" under group "Globex"

  Scenario: Grouping by project buckets each project's entries
    When I view entries this week grouped by project
    Then the entry list has groups exactly "Billing,Ops"
    And the entry list shows "auth refactor" under group "Billing"
    And the entry list shows "deploy pipeline" under group "Ops"

  Scenario: Grouping by day buckets each day, newest first
    When I view entries this week grouped by day
    Then the entry list has groups exactly "2026-06-24,2026-06-23"
    And the entry list shows "auth refactor" under group "2026-06-24"
    And the entry list shows "deploy pipeline" under group "2026-06-23"
    And the entry list shows "standup" under group "2026-06-23"

  Scenario: Grouping by tag fans a multi-tag entry into each of its tags
    When I view entries this week grouped by tag
    Then the entry list has groups exactly "ci,deep,meeting"
    And the entry list shows "auth refactor" under group "deep"
    And the entry list shows "deploy pipeline" under group "deep"
    And the entry list shows "deploy pipeline" under group "ci"
    And the entry list shows "standup" under group "meeting"

  Scenario: A custom range includes only in-range entries
    # A range covering only day 2 (Jun 23) captures that day's entries and excludes day 1's.
    When I view entries grouped by day for the range 2026-06-23T00:00:00Z to 2026-06-24T00:00:00Z
    Then the entry list shows "deploy pipeline" under group "2026-06-23"
    And the entry list shows "standup" under group "2026-06-23"
    And the entry list does not show "auth refactor"

  Scenario: A client filter narrows the list
    When I view entries this week grouped by day
    And I filter the entry list to client "Acme"
    Then the entry list shows "auth refactor" under group "2026-06-24"
    And the entry list shows "standup" under group "2026-06-23"
    And the entry list does not show "deploy pipeline"

  Scenario: A project filter narrows the list
    When I view entries this week grouped by client
    And I filter the entry list to project "Ops"
    Then the entry list shows "deploy pipeline" under group "Globex"
    And the entry list does not show "auth refactor"

  Scenario: A tag filter narrows the list
    When I view entries this week grouped by client
    And I filter the entry list to tag "meeting"
    Then the entry list shows "standup" under group "Acme"
    And the entry list does not show "deploy pipeline"

  Scenario: A search query matches live on description, excluding non-matches
    When I view entries this week grouped by client
    And I search the entry list for "refactor"
    Then the entry list shows "auth refactor" under group "Acme"
    And the entry list does not show "deploy pipeline"
    And the entry list does not show "standup"

  Scenario: Search matches the client / project / tag, not just the description
    When I view entries this week grouped by day
    And I search the entry list for "globex"
    Then the entry list shows "deploy pipeline" under group "2026-06-23"
    And the entry list does not show "auth refactor"

  Scenario: An empty query and no filters returns every in-range entry grouped by day
    When I view entries this week grouped by day
    Then the entry list shows "auth refactor" under group "2026-06-24"
    And the entry list shows "deploy pipeline" under group "2026-06-23"
    And the entry list shows "standup" under group "2026-06-23"
