@core-only
Feature: Database location change (migrate, start fresh, adopt)
  # PRD §20 R12, §12 R26, §16, §17 R15 — relocating the database is a core pipeline that
  # can only ADD copies: pre-change backup at the old home → copy → verify → atomic config
  # commit. Migrate refuses an existing destination file (never overwrites); start fresh
  # begins first-run at an empty destination or ADOPTS an existing file iff it passes the
  # integrity check and the §20 R08/R09 schema-version gate; the old file is always kept
  # in place, untouched, and named in the success message; any failure stops with the
  # config file untouched and the old path still active. Runs over @stint/core ONLY
  # (@core-only): the pipeline's sole driver is the GUI (§12 R26) — there is deliberately
  # no tt verb (the CLI's write interface is the config file plus the documented §13
  # procedure), the posture recorded in architecture.html §08. The cross-surface effect —
  # the committed config resolved identically by both surfaces — is proven by
  # storage_paths.feature's ladders; each scenario's relaunch here resolves that same
  # committed config through the same core ladder.

  Background:
    Given a storage sandbox
    And the config file sets a custom database path
    And a launched database with one closed entry at the configured path

  Scenario: Migrate copies the data to the new location and commits the config
    When the database location changes by migrate to the new home
    Then the change succeeds naming the old database file
    And the config file points the database at the new home
    And a relaunch opens the tracked entry at the new home

  Scenario: A migrate leaves the old database in place, byte-identical to the pre-change backup
    When the database location changes by migrate to the new home
    Then the old database file is still in place
    And the old database file is byte-identical to the pre-change backup

  Scenario: Migrate refuses a destination that already holds a file
    Given a foreign file already at the new home
    When the database location changes by migrate to the new home
    Then the change is refused because migrate never overwrites
    And the config file is untouched
    And a relaunch still opens the tracked entry at the configured path

  Scenario: Start fresh at an empty destination begins a new database there
    When the database location changes by start fresh to the new home
    Then the change succeeds naming the old database file
    And a relaunch opens an empty database at the new home
    And the old database file is still in place

  Scenario: Start fresh adopts a healthy database already at the destination
    Given a healthy database with two entries already at the new home
    When the database location changes by start fresh to the new home
    Then the change reports the existing file was adopted
    And a relaunch opens the two adopted entries at the new home

  Scenario: Adoption refuses a corrupt destination file
    Given a corrupt database file already at the new home
    When the database location changes by start fresh to the new home
    Then the change is refused naming the integrity failure
    And the config file is untouched

  Scenario: Adoption refuses a database from a newer schema
    Given a database from a newer schema already at the new home
    When the database location changes by start fresh to the new home
    Then the change is refused naming both schema versions
    And the config file is untouched

  Scenario: A destination in a missing directory refuses with nothing changed
    When the database location changes by migrate to a missing directory
    Then the change is refused naming the missing parent
    And the missing directory was not created
    And the config file is untouched
