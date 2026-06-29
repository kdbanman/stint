Feature: Settings round-trip (§12 R11, §14)
  # PRD §12 R11 — the GUI Settings view exposes editable controls for every §14 setting,
  # each persisting over the SAME setSetting capability `tt config set` uses. This locks the
  # CONFIG round-trip the view's controls drive: a chosen value is saved and reads back. It
  # runs TWICE — once over @stint/core (store.setSetting / store.settings()) and once over
  # tt (`tt config set <snake> <value>` / `tt config ls --json`) — so the surfaces are proven
  # identical (§17 R8). The date-format setting is new in §14 (the view's new control);
  # proving it here proves the view edits real, parity-preserving state.

  Background:
    Given an empty database

  Scenario: Week start is editable and reads back
    When I set week start to "sunday"
    Then the configured week start is "sunday"

  Scenario: Rounding is editable and reads back
    When I set rounding to "on"
    Then the configured rounding is "true"

  Scenario: The rounding increment is editable and reads back
    When I set rounding increment to "30"
    Then the configured rounding increment is "30"

  Scenario: Date format is editable and reads back
    When I set date format to "iso"
    Then the configured date format is "iso"

  Scenario: A fresh database reports the documented setting defaults
    Then the configured week start is "monday"
    And the configured date format is "system"
