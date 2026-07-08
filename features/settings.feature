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
    And the configured working hours start is "07:00"
    And the configured working hours end is "18:00"
    And the configured picker window mode is "working_hours"
    And the configured picker around hours is "8"

  # §14 — the timeline-window settings (G15): the working-hours pair, the picker's
  # default-window mode, and the around-now span. Each round-trips over the SAME
  # setSetting capability the GUI Timeline group edits and `tt config set` drives,
  # and each rejection is exactly as strict on both surfaces (§17 R8).
  Scenario: Working hours start is editable and reads back
    When I set working hours start to "08:30"
    Then the configured working hours start is "08:30"

  Scenario: Working hours end is editable and reads back
    When I set working hours end to "17:00"
    Then the configured working hours end is "17:00"

  Scenario: Picker window mode is editable and reads back
    When I set picker window mode to "around_now"
    Then the configured picker window mode is "around_now"

  Scenario: Picker around hours is editable and reads back
    When I set picker around hours to "12"
    Then the configured picker around hours is "12"

  Scenario: An inverted working-hours pair is rejected and stores nothing
    Then setting the working hours end to "06:00" is rejected
    And the configured working hours end is "18:00"

  Scenario: An out-of-range picker around span is rejected and stores nothing
    Then setting the picker around hours to "25" is rejected
    And the configured picker around hours is "8"
