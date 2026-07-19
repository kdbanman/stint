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

  Scenario: A saved report's two export scopes differ — the filtered export drops an off-filter row the raw keeps
    # PRD §09 R06/R09 — a saved report exports at TWO honest scopes. The FILTERED scope (the rows
    # the report SHOWS) is byte-identical to `tt report run <name> --csv|--json` / the GUI report's
    # Export; ALL DATA (every raw entry in the resolved range) is byte-identical to `tt export` /
    # the GUI "Export All Data". An off-filter entry INSIDE the range tells them apart: "audit" is
    # non-billable, so it sits in last week yet fails the report's billable filter — the filtered
    # export drops it while the raw range export keeps it. "review" (this week) proves the range
    # itself excludes out-of-window entries. Run TWICE so both scopes are proven on @stint/core
    # (store.exportSavedReport / listEntries) and tt (`report run --csv` / `export --range`), §17 R8.
    Given a closed entry "review" for "Acme" this week lasting 1 hour
    And a closed entry "ops sync" for "Globex" last week lasting 2 hours
    And a closed non-billable entry "audit" for "Globex" last week lasting 1 hour
    When I save a report "Archive" for last week grouped by client over billable time
    And I export the saved report "Archive"
    Then the saved report export has 1 row
    And the saved report export has a row "ops sync" for "Globex" of 7200 seconds
    And the saved report export does not have a row "audit"
    And the saved report export does not have a row "review"
    When I export the range 2026-06-15T00:00:00Z to 2026-06-22T00:00:00Z as csv
    Then the export has 2 rows
    And the export has a row "ops sync" for "Globex" of 7200 seconds
    And the export has a row "audit" for "Globex" of 3600 seconds

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

  Scenario: A duplicate report name is refused and persists nothing
    # PRD §13 (UNIQUE COLLATE NOCASE) — a saved report's name is unique, case-insensitively.
    # A second save under the same name (any case) is REFUSED by core; the original stays the
    # only "Weekly" in the list. This is the rejection the GUI builder surfaces inline (§12 R21):
    # proving the CONTRACT holds identically on @stint/core (store.saveReport throws) and tt
    # (`tt report save` exits non-zero), and that the refused save adds nothing.
    Given a closed entry "review" for "Acme" this week lasting 1 hour
    When I save a report "Weekly" for this week grouped by client over billable time
    Then the saved report list includes "Weekly"
    When saving a report "weekly" for last week grouped by project over all time is rejected
    Then the saved report list includes "Weekly"
    And the saved report list does not include "weekly"

  Scenario: A saved report with an inverted custom range is rejected and stores nothing
    # PRD §09 R01/R08 — a custom range whose From is AFTER its To can only ever resolve to an
    # EMPTY window, so core REFUSES it rather than storing a definition that always runs empty
    # (the guarantee §14 gives working hours, and add()'s from<to gives entries). The refused
    # save persists nothing; this is the rejection the GUI builder surfaces inline (§12 R21).
    # Proven on BOTH surfaces (store.saveReport throws / `tt report save --range` exits non-zero).
    When saving a report "Backwards" for the custom range 2026-07-15T00:00:00Z to 2026-07-01T00:00:00Z grouped by client over billable time is rejected
    Then the saved report list does not include "Backwards"

  Scenario: Amending a saved report to an inverted custom range is rejected
    # PRD §09 R08 — the from ≤ to guard holds on EDIT too (mirroring saveReport): a valid saved
    # definition cannot be amended into an inverted window; the amendment is refused and the
    # original definition is left untouched. Proven on both surfaces (store.editReport throws /
    # `tt report edit --range` exits non-zero).
    Given a closed entry "review" for "Acme" this week lasting 1 hour
    When I save a report "Weekly" for this week grouped by client over billable time
    Then the saved report list includes "Weekly"
    When amending the saved report "Weekly" range to the custom range 2026-07-15T00:00:00Z to 2026-07-01T00:00:00Z is rejected
    Then the saved report list includes "Weekly"

  Scenario: A saved report with a same-day (from == to) custom range is accepted
    # PRD §09 R01 — the report range rule is from ≤ to (NOT the entries' strict <): a same-day
    # window where From EQUALS To is a legitimate request, so it SAVES and RUNS (here over an
    # empty window, totalling 0h) rather than being rejected. This is the ≤-for-reports vs
    # <-for-entries asymmetry made concrete. Both surfaces (store.saveReport / `tt report save`).
    When I save a report "SameDay" for the custom range 2026-06-24T00:00:00Z to 2026-06-24T00:00:00Z grouped by client over billable time
    Then the saved report list includes "SameDay"
    When I run the saved report "SameDay"
    Then the saved report run totals 0 billable hours

  Scenario: Renaming then deleting a saved report removes it from the list
    Given a closed entry "review" for "Acme" this week lasting 1 hour
    When I save a report "Draft" for this week grouped by client over billable time
    Then the saved report list includes "Draft"
    When I rename the saved report "Draft" to "Final"
    Then the saved report list includes "Final"
    And the saved report list does not include "Draft"
    When I delete the saved report "Final"
    Then the saved report list does not include "Final"
