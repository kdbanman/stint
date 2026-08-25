Feature: GUI ↔ tt parity (§17 R8)
  # PRD §17 R8 — the GUI and tt are EQUAL surfaces over @stint/core: every capability one
  # surface exposes, the other reaches, behaving identically. The full-parity claim is proved
  # by RUNNING the SAME spec twice — once over @stint/core (CoreWorld) and once over the tt
  # executable (CliWorld) via run.test.ts — so a scenario that passes on both surfaces IS the
  # parity proof for that capability. The acceptance/criteria/parity-matrix.json + gui/test/parity.test.ts
  # bind the GUI's IPC channels to existing tt commands (the static coverage claim); THIS file
  # exercises the behaviour those channels invoke across the capability classes the §12 views
  # add (manual add, field edit, client/project create-rename-archive, setting change+read-back),
  # so the dynamic claim — same behaviour, both surfaces — is locked too. The reference-
  # data lifecycle (reference_data.feature), the settings round-trip (settings.feature) and the
  # report/range/grouping parity (reports.feature, entry_list.feature) own their own deep
  # coverage; this file is the cross-cutting parity sampler that names each capability class once.

  Background:
    Given an empty database

  # §12 R7 — the Manual-add (backfill) form: a completed entry from an explicit from/to plus the
  # same attributes tt add accepts. Reaches the `add` IPC / `tt add` — identical on both surfaces.
  Scenario: Manual add of a completed, attributed entry behaves identically on both surfaces
    When I backfill an entry "design review" for "Acme" / "API" from 09:00 to 10:30
    Then the backfill succeeds
    And the entry "design review" is for "Acme / API"
    And the entry "design review" has a billable duration of 90 minutes

  # §06 R1 — editing a field of an existing entry. Reaches the `edit` IPC / `tt edit`. The
  # entry keeps its other fields (here its client/project) when one field is amended.
  Scenario: Editing an entry's description behaves identically on both surfaces
    Given a closed entry "draft spec" for "Acme" / "API" from 09:00 to 10:00
    When I edit the entry "draft spec" description to "final spec"
    Then the entry "final spec" is for "Acme / API"

  # §07 / §12 R11 — the Clients view's client lifecycle. Reaches the addClient IPC channel,
  # parity with `tt client add`.
  Scenario: Creating a client runs identically on both surfaces
    When I add a client "Acme Corp"
    Then client "Acme Corp" is in the active client list

  # §07 / §12 R11 — reaches the renameClient IPC channel, parity with `tt client rename`.
  Scenario: Renaming a client runs identically on both surfaces
    Given I add a client "Acme Corp"
    When I rename client "Acme Corp" to "Acme Inc"
    Then client "Acme Inc" is in the active client list
    And client "Acme Corp" is not in the active client list

  # §07 / §12 R11 — reaches the archiveClient IPC channel, parity with `tt client archive`.
  Scenario: Archiving a client runs identically on both surfaces
    Given I add a client "Acme Corp"
    When I archive client "Acme Corp"
    Then client "Acme Corp" is not in the active client list

  # §07 / §12 R11 — the Clients view's per-project lifecycle. Reaches the addProject IPC
  # channel, parity with `tt project add`.
  Scenario: Creating a project runs identically on both surfaces
    Given I add a client "Globex"
    When I add a project "Platform" for client "Globex"
    Then project "Platform" is in the active project list

  # §07 / §12 R11 — reaches the renameProject IPC channel, parity with `tt project rename`.
  Scenario: Renaming a project runs identically on both surfaces
    Given I add a client "Globex"
    And I add a project "Platform" for client "Globex"
    When I rename project "Platform" to "Core Platform"
    Then project "Core Platform" is in the active project list
    And project "Platform" is not in the active project list

  # §07 / §12 R11 — reaches the archiveProject IPC channel, parity with `tt project archive`.
  Scenario: Archiving a project runs identically on both surfaces
    Given I add a client "Globex"
    And I add a project "Platform" for client "Globex"
    When I archive project "Platform"
    Then project "Platform" is not in the active project list

  # §12 R12 / §14 — the Settings view's edit + read-back over the SAME config capability `tt
  # config set` / `tt config ls` use. A chosen value persists and reads back on both surfaces.
  Scenario: Changing the week start and reading it back behaves identically on both surfaces
    When I set week start to "sunday"
    Then the configured week start is "sunday"

  # §12 R12 / §14 — the second settings example: a numeric setting round-trips the same way.
  Scenario: Changing the rounding increment and reading it back behaves identically on both surfaces
    When I set rounding increment to "30"
    Then the configured rounding increment is "30"
