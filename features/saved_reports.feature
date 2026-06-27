Feature: Saved reports
  # PRD §09 R08–R09 — a saved report is a named, persistent preset of {range-spec,
  # group-by, filters, rounding}. Its range is stored as a RELATIVE preset (e.g.
  # "this-week") that re-resolves against current data on every run through the SAME core
  # resolveRange the ad-hoc report uses — so a saved report and an ad-hoc report over the
  # same resolved window can never diverge. This locks the saved-report CONTRACT the GUI
  # Reports view drives; it runs TWICE — once over @stint/core (store.saveReport/runReport/
  # editReport/…) and once over tt (`tt report save|ls|run|edit|rename|rm`) — so CRUD
  # persistence, relative-spec resolution, and run totals are proven at full parity
  # (§17 R8/R14). The fixed clock is a Wednesday, so "this week"/"last week" are unambiguous.

  Background:
    Given an empty database
    And a client "Acme" with project "API"
    And a client "Globex" with project "Ops"

  Scenario: A saved report's run total matches an equivalent ad-hoc report
    # The saved relative "this-week" spec re-resolves through core's resolveRange on run; the
    # last-week entry falls outside it. The run total must equal an ad-hoc this-week report
    # over the same window — proving the saved and ad-hoc range resolution cannot diverge.
    Given a closed entry "review" for "Acme" this week lasting 1 hour
    And a closed entry "ops sync" for "Globex" last week lasting 2 hours
    When I save a report "Weekly" for this week grouped by client over billable time
    Then the saved report list includes "Weekly"
    When I run the saved report "Weekly"
    Then the saved report run totals 1 billable hour
    And the saved report run total equals an ad-hoc this week report grouped by client over billable time

  Scenario: Editing a saved report's range re-resolves it on the next run
    # Save with a this-week range (total 1h), then change the range to last week and re-run:
    # the new total reflects the last-week entry alone (the relative spec re-resolves).
    Given a closed entry "review" for "Acme" this week lasting 1 hour
    And a closed entry "ops sync" for "Globex" last week lasting 2 hours
    When I save a report "Flexible" for this week grouped by client over billable time
    And I run the saved report "Flexible"
    Then the saved report run totals 1 billable hour
    When I change the saved report "Flexible" range to last week
    And I run the saved report "Flexible"
    Then the saved report run totals 2 billable hours

  Scenario: Exporting from a saved report yields the raw entries for the resolved range
    # The saved "last-week" spec re-resolves on export; only the last-week entry falls in the
    # window, so the export carries it alone (raw, billable='all', no narrowing) — byte-
    # identical to `tt export` over that window. Run TWICE so CSV export-from-saved is proven
    # reachable + identical on @stint/core (store.exportSavedReport) and tt (`report run --csv`).
    Given a closed entry "review" for "Acme" this week lasting 1 hour
    And a closed entry "ops sync" for "Globex" last week lasting 2 hours
    When I save a report "Archive" for last week grouped by client over billable time
    And I export the saved report "Archive"
    Then the saved report export has 1 row
    And the saved report export has a row "ops sync" for "Globex" of 7200 seconds
    And the saved report export does not have a row "review"

  Scenario: Editing a saved report's group-by regroups the same total
    # The grand total is invariant on the grouping (it only changes how the totals are
    # bucketed, never their sum). Save grouped by client, run; then change the group-by to
    # project and re-run — the regrouped run totals the SAME billable hours. Proven on both
    # surfaces (store.editReport --by / `tt report edit --by`).
    Given a closed entry "review" for "Acme" this week lasting 1 hour
    And a closed entry "build" for "Globex" this week lasting 2 hours
    When I save a report "Grouped" for this week grouped by client over billable time
    And I run the saved report "Grouped"
    Then the saved report run totals 3 billable hours
    When I change the saved report "Grouped" grouping to project
    And I run the saved report "Grouped"
    Then the saved report run totals 3 billable hours
    And the saved report run total is unchanged

  Scenario: Renaming then deleting a saved report removes it from the list
    Given a closed entry "review" for "Acme" this week lasting 1 hour
    When I save a report "Draft" for this week grouped by client over billable time
    Then the saved report list includes "Draft"
    When I rename the saved report "Draft" to "Final"
    Then the saved report list includes "Final"
    And the saved report list does not include "Draft"
    When I delete the saved report "Final"
    Then the saved report list does not include "Final"
