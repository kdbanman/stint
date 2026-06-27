Feature: Report by date range
  # PRD §09 R1 — the report's date-range picker. The five presets (today / week /
  # last-week / month / last-month) resolve through core's resolveRange, and a custom
  # from/to passes straight through. This locks the range-resolution CONTRACT the GUI
  # picker calls into; it runs TWICE — once over @stint/core (resolveRange + store.report)
  # and once over tt (`tt report --week/--last-week/--range … --by … --json`) — so the
  # preset/custom window the picker drives is proven at full parity (§17 R8). The fixed
  # clock is a Wednesday, so "this week" and "last week" are unambiguous on both surfaces.

  Background:
    Given an empty database
    And a client "Acme" with project "API"
    And a client "Globex" with project "Ops"

  Scenario: The This-week preset includes only this-week entries
    # The preset window is core's resolveRange('week', …); the last-week entry falls
    # outside it, so the total counts the this-week entry alone.
    Given a closed entry "review" for "Acme" this week lasting 1 hour
    And a closed entry "ops sync" for "Globex" last week lasting 2 hours
    Then a report for this week totals 1 billable hour
    And a report for this week has no time under "Globex"

  Scenario: The Last-week preset excludes this week
    # Symmetric to the above: resolveRange('last-week', …) bounds the prior week, so the
    # this-week entry is excluded and only the last-week entry counts.
    Given a closed entry "review" for "Acme" this week lasting 1 hour
    And a closed entry "ops sync" for "Globex" last week lasting 2 hours
    Then a report for last week totals 2 billable hours
    And a report for last week has no time under "Acme"

  Scenario: A custom from/to range bounds the totals
    # The custom path passes explicit UTC bounds straight through (no preset). A range
    # covering only the last-week day captures that entry and excludes the this-week one.
    Given a closed entry "review" for "Acme" this week lasting 1 hour
    And a closed entry "ops sync" for "Globex" last week lasting 2 hours
    Then a report for the range 2026-06-17T00:00:00Z to 2026-06-18T00:00:00Z totals 2 billable hours
    And a report for the range 2026-06-17T00:00:00Z to 2026-06-18T00:00:00Z has no time under "Acme"

  Scenario: Grouping by client sums each client's this-week time
    # Two this-week entries under different clients group apart; each client's line sums
    # only its own entries (the §09 grouping the picker drives by the chosen Group by).
    Given a closed entry "review" for "Acme" this week lasting 1 hour
    And a closed entry "standup" for "Globex" this week lasting 3 hours
    Then a report for this week groups 1 billable hour under "Acme"
    And a report for this week groups 3 billable hours under "Globex"
