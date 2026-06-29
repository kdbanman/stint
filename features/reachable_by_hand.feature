Feature: Every capability reachable by hand
  # PRD §17 R10 (new) — every @stint/core capability a freelancer reaches with `tt` must
  # ALSO be reachable by hand in the GUI main window: start-with-attributes, manual backfill,
  # edit, split, merge, report + export, reference-data (client/project/tag create/rename/
  # archive), and settings — none requiring a drop to the terminal. R10 is the converse of
  # §17 R8 (nothing GUI-only): nothing tt-only either, so a non-terminal user is whole.
  #
  # The GUI cannot itself be exercised by the surface-neutral BDD harness (it has no window),
  # so this feature does NOT test pixels — it proves the CAPABILITY SET behind the buttons is
  # real and behaves identically on BOTH surfaces. Every scenario runs TWICE via run.test.ts:
  # once over @stint/core (the engine the GUI's IPC handlers delegate to) and once over `tt`
  # (the parity twin). The companion coverage that the WINDOW actually wires each capability
  # to a control is the GOLD parity-matrix (every IPC channel maps to a tt path) + the
  # renderer-static guards (a control invoking each window.stint.* channel exists) + JUDGE
  # (a screenshot per view). Together they close R10: the capability is real (here), it has a
  # by-hand GUI channel at parity (GOLD), and the view renders it (renderer-static + JUDGE).
  #
  # Each scenario below names the GUI surface that reaches the capability and the IPC channel
  # / tt path it rides, so the by-hand path is explicit. The arithmetic of each capability is
  # owned by its dedicated feature (tracking / overlap_and_editing / reporting / entry_list /
  # reference_data / settings); this feature asserts the by-hand SET is whole, not re-deriving
  # the math.

  Background:
    Given an empty database

  Scenario: Start with attributes by hand (the Start/Switch form)
    # §12 R5 — the window's Start form carries description + client + project (and tags /
    # billable), so a timer is fully attributed without a later edit. GUI: #start-form →
    # `start` IPC → core store.start; tt: `tt start "desc" --client … --project …`.
    When I start an entry "auth refactor" for "Acme" / "Billing" at 09:00
    Then exactly one entry is open
    And the open entry is "auth refactor"
    And the open entry is for "Acme / Billing"

  Scenario: Switch by hand stops the open entry and starts the next as one action
    # §05 R8 / §12 R4 — the running card's Switch is the atomic stop-then-start, reachable
    # by hand. GUI: Switch button → `start` IPC; tt: `tt switch`.
    Given I start an entry "draft" at 09:00
    When I switch to an entry "review" at 10:00
    Then exactly one entry is open
    And the open entry is "review"
    And the entry "draft" is closed with end 10:00

  Scenario: Backfill a completed past entry by hand (the Manual-add form)
    # §12 R7 — the Manual-add form creates a completed past entry from explicit from/to plus
    # attributes, with no terminal. GUI: #add-form → `add` IPC → core store.add; tt: `tt add`.
    When I backfill an entry "design review" for "Acme" / "Billing" from 13:00 to 14:00
    Then the backfill succeeds
    And the entry "design review" is for "Acme / Billing"
    And the entry "design review" has a billable duration of 60 minutes

  Scenario: Edit any field of an entry by hand (the consolidated editor)
    # §12 R6 — the per-entry editor amends any tt-editable field in the window. GUI: the
    # editor → `edit` IPC → core store.edit; tt: `tt edit`.
    Given I start an entry "draft" at 09:00
    When I edit the entry "draft" description to "final draft"
    Then exactly one entry is open
    And the open entry is "final draft"

  Scenario: Split an entry by hand (the editor's Split-at-instant)
    # §12 R6 / §06 R2 — split a span in two from the window. GUI: editor Split → `split` IPC
    # → core store.split; tt: `tt split`.
    Given a closed entry "block" from 09:00 to 12:00
    When I split it at 10:30
    Then there are two entries covering 09:00 to 12:00

  Scenario: Merge a contiguous selection by hand (the editor's Merge-selected)
    # §12 R6 / §06 R3 — fold an adjacent selection into one entry from the window. GUI:
    # Merge selected → `merge` IPC → core store.merge; tt: `tt merge`.
    Given a closed entry "part one" for "Acme" / "Billing" from 09:00 to 10:00
    And a closed entry "part two" from 10:00 to 11:00
    When I merge those two entries
    Then there is one entry from 09:00 to 11:00
    And the merged entry is for "Acme / Billing"

  Scenario: Search and group the entry list by hand (the Entries control bar)
    # §12 R9 / §09 R7 — group the list and free-text search it from the window. GUI:
    # #entries-ctrl → `listEntries` IPC → core buildEntryList; tt: `tt list --by/--search`.
    Given a closed entry "auth refactor" for "Acme" / "Billing" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "deploy pipeline" for "Globex" / "Ops" tagged "ci" this week on day 2 lasting 1 hour
    When I view entries this week grouped by client
    Then the entry list has groups exactly "Acme,Globex"
    When I search the entry list for "auth"
    Then the entry list shows "auth refactor" under group "Acme"
    And the entry list does not show "deploy pipeline"

  Scenario: Build a grouped report by hand (the Reports view)
    # §12 R8 / §09 R1 — the report builder groups + totals billable time from the window.
    # GUI: Reports view → `report` IPC → core buildReport; tt: `tt report --by`.
    Given a closed entry "build" for "Acme" / "API" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "ops sync" for "Globex" / "Ops" tagged "meeting" this week on day 2 lasting 3 hours
    Then a report for this week totals 5 billable hours
    And a report for this week groups 2 billable hours under "Acme"
    And a report for this week groups 3 billable hours under "Globex"

  Scenario: Export the range by hand (the Reports view's Export CSV / JSON)
    # §12 R8 / §09 R6 — export the raw entries for a range from the window, byte-identical to
    # `tt export`. GUI: Export buttons → `exportEntries` IPC → core toCsv/toJsonEntries; tt:
    # `tt export --csv/--json`.
    Given a closed entry "build" for "Acme" / "API" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "ops sync" for "Globex" / "Ops" tagged "meeting" this week on day 2 lasting 3 hours
    When I export the range 2026-06-22T00:00:00Z to 2026-06-29T00:00:00Z as csv
    Then the export has 2 rows
    And the export has a row "build" for "Acme" of 7200 seconds
    And every exported row carries its billable flag

  Scenario: Create reference data by hand (the Clients view's Add)
    # §12 R10 — create a client, a project under it, and a tag from the window. GUI: Clients
    # view → `addClient` / `addProject` / `addTag` IPC; tt: `tt client add` / `tt project add`
    # / `tt tag add`.
    When I add a client "Acme Corp"
    Then client "Acme Corp" is in the active client list
    When I add a project "Platform" for client "Acme Corp"
    Then project "Platform" is in the active project list
    When I add a tag "billing"
    Then tag "billing" is in the active tag list

  Scenario: Rename and archive reference data by hand (the Clients view)
    # §12 R10 — rename + archive a client/project/tag from the window; archived records drop
    # out of the active picker lists but keep their history. GUI: Clients view →
    # `renameClient`/`archiveClient`/`renameProject`/`archiveProject`/`renameTag`/`archiveTag`;
    # tt: the `tt client`/`tt project`/`tt tag` rename/archive subcommands.
    Given a client "Acme Corp" with project "Platform"
    And a closed entry "spec" for "Acme Corp" / "Platform" from 09:00 to 10:00
    When I rename client "Acme Corp" to "Acme Global"
    Then the entry "spec" is for "Acme Global / Platform"
    When I archive project "Platform"
    Then project "Platform" is not in the active project list
    And the entry "spec" is for "Acme Global / Platform"

  Scenario: Tag lifecycle by hand (the Clients view's Tags strip)
    # §12 R10 — create → rename → archive a tag end to end from the window. GUI: Tags strip →
    # `addTag`/`renameTag`/`archiveTag`; tt: `tt tag add/rename/archive`.
    Given I add a tag "draft"
    When I rename tag "draft" to "drafts"
    Then tag "drafts" is in the active tag list
    When I archive tag "drafts"
    Then tag "drafts" is not in the active tag list

  Scenario: Change a setting by hand (the Settings view)
    # §12 R11 / §14 — every §14 setting is editable from the window over the same capability
    # `tt config set` uses. GUI: Settings view → `setSetting` IPC → core store.setSetting; tt:
    # `tt config set`.
    When I set week start to "sunday"
    Then the configured week start is "sunday"
