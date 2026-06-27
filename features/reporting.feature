Feature: Report grouping (group by client / project / day / tag)
  # PRD §09 R2 — the report's Group by control. The same range of this-week entries can be
  # regrouped by client, project, day, or tag; each grouping sums the SAME underlying
  # billable time into different buckets, so the grand total is grouping-invariant. This
  # locks the grouping CONTRACT the GUI Group-by segment drives (gui/renderer/report.html
  # #by-seg → window.stint.report({ by })). It runs TWICE — once over @stint/core
  # (store.report with the chosen `by`) and once over tt (`tt report --by <client|project|
  # day|tag> --json`) — so the grouping engine the GUI control drives is proven identical on
  # both logic surfaces (§17 R8). The fixed clock is a Wednesday (2026-06-24); the entries
  # below all fall in that week, on two distinct days, under two clients/projects, with tags.

  Background:
    Given an empty database
    And a client "Acme" with project "API"
    And a client "Globex" with project "Ops"

  # PRD §08 R3 — the report's Billable filter (the GUI three-way Billable control:
  # Billable / All / Non-billable; the CLI twin `tt report --all` / `--non-billable`).
  # A report defaults to billable-only; the same week's time can instead be totalled across
  # ALL entries or only the NON-billable ones. This locks that filter CONTRACT surface-
  # neutrally — it runs TWICE, over @stint/core (store.report's filterByBillable) and over tt
  # (`tt report --all|--non-billable --json`) — so the filter the GUI segment drives is proven
  # identical on both logic surfaces (§17 R8). The non-billable entry is CLIENTLESS, which
  # defaults to non-billable (PRD §08 clientless default); the billable entry is attributed.
  Scenario: The billable filter includes, totals all, or isolates non-billable time
    # 2 billable hours (Acme) plus 3 non-billable hours (clientless) in the same week. The
    # default billable-only report sees 2h; All sees the full 5h; Non-billable isolates 3h.
    Given a closed entry "build" for "Acme" this week lasting 2 hours
    And a closed non-billable entry "personal" this week lasting 3 hours
    Then a billable report for this week totals 2 hours
    And an all report for this week totals 5 hours
    And a non-billable report for this week totals 3 hours

  Scenario: Grouping by project sums each project's time
    # Two entries under distinct projects regroup apart; each project line sums only its own.
    Given a closed entry "build" for "Acme" / "API" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "ops sync" for "Globex" / "Ops" tagged "meeting" this week on day 2 lasting 3 hours
    Then a report for this week grouped by project groups 2 billable hours under "API"
    And a report for this week grouped by project groups 3 billable hours under "Ops"

  Scenario: Grouping by tag sums each tag's time, with an entry counted under every tag
    # Tags fan out: a two-tag entry contributes to BOTH tag lines (§09 tag grouping), so the
    # sum of the tag lines can exceed the grand total — but the grand total itself is unchanged.
    Given a closed entry "build" for "Acme" / "API" tagged "deep,urgent" this week on day 1 lasting 2 hours
    And a closed entry "ops sync" for "Globex" / "Ops" tagged "meeting" this week on day 2 lasting 3 hours
    Then a report for this week grouped by tag groups 2 billable hours under "deep"
    And a report for this week grouped by tag groups 2 billable hours under "urgent"
    And a report for this week grouped by tag groups 3 billable hours under "meeting"

  Scenario: Grouping by day buckets entries on different days apart
    # Two entries on two distinct days produce two day lines; one entry per day, summed.
    Given a closed entry "build" for "Acme" / "API" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "more build" for "Acme" / "API" tagged "deep" this week on day 1 lasting 1 hour
    And a closed entry "ops sync" for "Globex" / "Ops" tagged "meeting" this week on day 2 lasting 3 hours
    Then a report for this week grouped by day has 2 group lines
    And a report for this week grouped by day totals 6 billable hours

  Scenario: The grand total is grouping-invariant
    # Regrouping never changes the underlying time: the same week's entries total the same
    # number of billable hours whether grouped by client, project, day, or tag — the property
    # the GUI Group-by control relies on (switching the segment regroups the SAME totals).
    Given a closed entry "build" for "Acme" / "API" tagged "deep,urgent" this week on day 1 lasting 2 hours
    And a closed entry "ops sync" for "Globex" / "Ops" tagged "meeting" this week on day 2 lasting 3 hours
    Then a report for this week totals 5 billable hours grouped by client
    And a report for this week totals 5 billable hours grouped by project
    And a report for this week totals 5 billable hours grouped by day
    And a report for this week totals 5 billable hours grouped by tag

  # PRD §09 R4 — the report's Rounding control (the GUI report builder's Off/On toggle +
  # 6/10/15/30-min increment picker, gui/renderer/report.html #rounding). Rounding applies to
  # the grouped BILLABLE LINE nearest the chosen increment (NOT always up), and never alters
  # stored time. This locks that CONTRACT surface-neutrally — it runs TWICE, over @stint/core
  # (store.report with rounding on) and over tt (`tt report --round <min> --json`) — so the
  # rounded line the GUI toggle drives is proven identical on both logic surfaces (§17 R8).
  Scenario: Rounding rounds the grouped line nearest the increment, not the stored time
    # A 97-minute entry (5820s) rounds to the NEAREST 15 minutes — that is 90m (5400s), rounding
    # DOWN, not up — on the displayed grouped line; the entry's own stored billable seconds are
    # untouched (still 5820s), so rounding is a display concern only (PRD §09 R4 / §17 R4).
    Given a closed entry "build" for "Acme" / "API" this week lasting 97 minutes
    Then a report for this week grouped by client rounded to 15 minutes groups 5400 seconds under "Acme"
    And a report for this week grouped by client has an exact 5820 seconds under "Acme"
    And the entry "build" still has a billable duration of 5820 seconds

  # PRD §06 R4 / §09 — overlap is allowed but FLAGGED in a report: two entries whose spans
  # intersect are both surfaced as overlapped (the GUI report summary paints the flag in
  # context on the affected rows). Surface-neutral over the World `report`/overlap capability,
  # so the same flagging is proven on @stint/core and `tt report --json` (§17 R8).
  Scenario: A report flags two overlapping entries within the range
    # Both entries are anchored to the same day-1 instant, so their spans intersect; the
    # report must surface BOTH as overlapped (allowed-but-flagged, never silently merged).
    Given a closed entry "build" for "Acme" / "API" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "call" for "Acme" / "API" tagged "meeting" this week on day 1 lasting 3 hours
    Then a report covering this week flags 2 overlapping entries

  # PRD §09 R6 — the report view's Export CSV / Export JSON buttons write the RAW entries for
  # the shown range via core's toCsv/toJsonEntries (byte-identical to `tt export --csv/--json`,
  # the renderer cannot touch fs so the GUI rounds the bytes through main). This locks the
  # export SHAPE surface-neutrally — it runs TWICE, over @stint/core (the core exporters) and
  # over tt (`tt export --range … --csv|--json`) — so the GUI export reaches nothing tt cannot.
  Scenario: CSV and JSON export the raw entries for the range with the same shape
    Given a closed entry "build" for "Acme" / "API" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "ops sync" for "Globex" / "Ops" tagged "meeting" this week on day 2 lasting 3 hours
    When I export the range 2026-06-22T00:00:00Z to 2026-06-29T00:00:00Z as csv
    Then the export has 2 rows
    And the export has a row "build" for "Acme" of 7200 seconds
    And the export has a row "ops sync" for "Globex" of 10800 seconds
    And every exported row carries its billable flag
    When I export the range 2026-06-22T00:00:00Z to 2026-06-29T00:00:00Z as json
    Then the export has 2 rows
    And the export has a row "build" for "Acme" of 7200 seconds
    And the export has a row "ops sync" for "Globex" of 10800 seconds
    And every exported row carries its billable flag
