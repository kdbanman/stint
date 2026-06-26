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

  Scenario: Create then rename then archive a tag runs the full lifecycle
    # PRD §12 R10 — the whole tag lifecycle the Tags strip exposes, end to end.
    Given I add a tag "draft"
    When I rename tag "draft" to "drafts"
    Then tag "drafts" is in the active tag list
    When I archive tag "drafts"
    Then tag "drafts" is not in the active tag list
