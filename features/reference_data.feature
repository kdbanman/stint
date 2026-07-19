Feature: Reference-data management
  # PRD §12 R10 — the Clients view manages the reference data: create / rename / archive
  # clients & projects, and create / rename / archive tags. Every scenario runs TWICE
  # (CoreWorld over @stint/core, CliWorld over `tt client`/`tt project`/`tt tag`), so the
  # GUI Clients view is proven to reach nothing tt cannot (§17 R8 parity). Client and
  # project RENAME/ARCHIVE flow-onto-entries are already covered in overlap_and_editing.feature
  # (do not duplicate); this file owns CREATION of each kind plus the full tag lifecycle.

  Background:
    Given an empty database

  Scenario: Creating a client lists it in the active client list
    # PRD §12 R10 — the Clients view's Add-client, parity with `tt client add`.
    When I add a client "Acme Corp"
    Then client "Acme Corp" is in the active client list

  Scenario: Creating a project under a client lists it in the active project list
    # PRD §12 R10 — Add-project under a client, parity with `tt project add --client`.
    Given I add a client "Acme Corp"
    When I add a project "Platform" for client "Acme Corp"
    Then project "Platform" is in the active project list

  Scenario: Archiving a project hides it from the active list but keeps its history
    # PRD §07 / §12 R10 — archive is reversible hiding, never deletion; past entries keep
    # their label. The Clients view's per-project Archive, parity with `tt project archive`.
    Given a client "Acme Corp" with project "Platform"
    And a closed entry "spec" for "Acme Corp" / "Platform" from 09:00 to 10:00
    When I archive project "Platform"
    Then project "Platform" is not in the active project list
    And the entry "spec" is for "Acme Corp / Platform"

  Scenario: Archiving then restoring a client round-trips it back to the active list
    # PRD §07 / §12 R13 — archive hides; restore is the reverse, returning the record to every
    # picker/filter. This is the round-trip that makes "reversible hide" true rather than
    # aspirational. The Clients view's Restore button, parity with `tt client restore`.
    Given I add a client "Acme Corp"
    When I archive client "Acme Corp"
    Then client "Acme Corp" is not in the active client list
    When I restore client "Acme Corp"
    Then client "Acme Corp" is in the active client list

  Scenario: Archiving then restoring a project round-trips it back to the active list
    # PRD §07 / §12 R13 — the per-project Restore, parity with `tt project restore`.
    Given a client "Acme Corp" with project "Platform"
    When I archive project "Platform"
    Then project "Platform" is not in the active project list
    When I restore project "Platform"
    Then project "Platform" is in the active project list

  Scenario: Restoring a project whose client is still archived is refused
    # PRD §12 R13 edge — an active project under a hidden client would be unselectable, so core
    # refuses the restore (naming the archived client), steering the user to restore the client
    # first. Both surfaces refuse identically (§17 R8).
    Given a client "Acme Corp" with project "Platform"
    And I archive project "Platform"
    And I archive client "Acme Corp"
    When I try to restore project "Platform"
    Then the reference-data change is rejected
    And project "Platform" is not in the active project list

  Scenario: Creating a tag lists it in the active tag list
    # PRD §12 R10 — the Tags strip's Add-tag, the explicit manage-it-first path (tags are
    # otherwise born on the fly when first applied). Parity with `tt tag add`.
    When I add a tag "billing"
    Then tag "billing" is in the active tag list

  Scenario: Renaming a tag keeps it in the active list under the new name
    # PRD §12 R10 — the Tags strip's Rename, parity with `tt tag rename`.
    Given I add a tag "biling"
    When I rename tag "biling" to "billing"
    Then tag "billing" is in the active tag list
    And tag "biling" is not in the active tag list

  Scenario: Archiving a tag hides it from the active tag list
    # PRD §07 / §12 R10 — archive is reversible hiding; the tag drops out of the active
    # (picker) list while its history is kept. Parity with `tt tag archive`.
    Given I add a tag "deprecated"
    When I archive tag "deprecated"
    Then tag "deprecated" is not in the active tag list

  Scenario: Archiving then restoring a tag round-trips it back to the active list
    # PRD §07 / §12 R13 — restore returns the tag to the pickers, parity with `tt tag restore`.
    Given I add a tag "billing"
    When I archive tag "billing"
    Then tag "billing" is not in the active tag list
    When I restore tag "billing"
    Then tag "billing" is in the active tag list

  Scenario: Create then rename then archive a tag runs the full lifecycle
    # PRD §12 R10 — the whole tag lifecycle the Tags strip exposes, end to end.
    Given I add a tag "draft"
    When I rename tag "draft" to "drafts"
    Then tag "drafts" is in the active tag list
    When I archive tag "drafts"
    Then tag "drafts" is not in the active tag list

  # PRD §07 R03 (#64) — reference-data names are unique and resolved case-insensitively;
  # adding or renaming onto an existing name is rejected. Without this, renaming one client
  # onto another's name was accepted, and a by-client report then merged the two into one
  # line — silently conflating billing. Every scenario runs over BOTH surfaces (§17 R8).

  Scenario: Adding a client whose name already exists is rejected (case-insensitively)
    Given I add a client "Acme Corp"
    When I try to add a client "acme corp"
    Then the reference-data change is rejected
    And client "acme corp" is not in the active client list

  Scenario: Adding a project whose name already exists under the same client is rejected
    # §07 R03 — project names are unique PER CLIENT, case-insensitively.
    Given I add a client "Acme Corp"
    And I add a project "Platform" for client "Acme Corp"
    When I try to add a project "platform" for client "Acme Corp"
    Then the reference-data change is rejected

  Scenario: The same project name under a different client is allowed
    # §07 R03 — per-client scope: "Platform" may exist under two different clients.
    Given I add a client "Acme Corp"
    And I add a project "Platform" for client "Acme Corp"
    And I add a client "Globex"
    When I add a project "Platform" for client "Globex"
    Then project "Platform" is in the active project list

  Scenario: Adding a tag whose name already exists is rejected (case-insensitively)
    # §07 R03 — the explicit manage-first `tt tag add` rejects a case-variant duplicate; the
    # on-the-fly tagging path instead reuses the existing tag (pinned in core GOLD).
    Given I add a tag "billing"
    When I try to add a tag "Billing"
    Then the reference-data change is rejected

  Scenario: Renaming a client onto another client's name is rejected (case-insensitively)
    Given I add a client "Acme Corp"
    And I add a client "Beta Labs"
    When I try to rename client "Beta Labs" to "acme corp"
    Then the reference-data change is rejected
    And client "Beta Labs" is in the active client list

  Scenario: Renaming a project onto a sibling project's name is rejected
    Given I add a client "Acme Corp"
    And I add a project "Platform" for client "Acme Corp"
    And I add a project "Billing" for client "Acme Corp"
    When I try to rename project "Billing" to "platform"
    Then the reference-data change is rejected

  Scenario: Renaming a tag onto another tag's name is rejected (case-insensitively)
    Given I add a tag "billing"
    And I add a tag "invoicing"
    When I try to rename tag "invoicing" to "Billing"
    Then the reference-data change is rejected
    And tag "invoicing" is in the active tag list

  Scenario: A case-only self-rename is allowed
    # §07 R03 — renaming a record onto its OWN name in a new case is not a clash.
    Given I add a tag "deep"
    When I rename tag "deep" to "Deep"
    Then tag "Deep" is in the active tag list
