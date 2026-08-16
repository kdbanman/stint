Feature: Storage paths (config home, ladders, loud refusals)
  # PRD §13, §20 R10/R11/R14, §17 R15 — one config file, three ladders, and a path nobody
  # can trust refuses the launch instead of opening a guess. Both surfaces resolve the
  # database, the backup directory, and the config file's own path through the SAME core
  # ladders (env → config file → default, first rung wins), so `tt paths` and the Settings
  # Storage group can never disagree. An untrusted config file (§20 R10) or a configured
  # database path with a dead parent (§20 R11) refuses the launch loudly — naming the file
  # and the error, creating nothing, never silently falling back to the default (the
  # phantom-empty-tracker failure). A missing backup directory never blocks the launch but
  # is surfaced plainly wherever backups speak (§20 R14). Runs TWICE — once over
  # @stint/core (resolveStoragePaths / Store.open under an injected environment) and once
  # over tt (`tt paths --json` / `tt status` / `tt backup ls|now` under TT_CONFIG /
  # TT_DB / TT_BACKUP_DIR) — so the ladders and every refusal are proven identical on both
  # surfaces (§17 R8/R15). Each scenario runs in an isolated storage sandbox holding the
  # scenario's config file and data directories.

  Background:
    Given a storage sandbox

  Scenario: The database path resolves the environment over the config file
    Given the config file sets a custom database path
    When the storage paths resolve with the database set in the environment
    Then the database path comes from the environment

  Scenario: The database path falls to the config file when the environment is silent
    Given the config file sets a custom database path
    When the storage paths resolve
    Then the database path is the configured one with source "config"

  Scenario: The backup directory defaults to beside the resolved database
    When the storage paths resolve with the database set in the environment
    Then the backup directory is beside the database with source "default"

  Scenario: The backup directory falls to the config file when the environment is silent
    Given the config file sets a custom backup directory
    When the storage paths resolve with the database set in the environment
    Then the backup directory is the configured one with source "config"

  Scenario: The backup directory resolves the environment over the config file
    Given the config file sets a custom backup directory
    When the storage paths resolve with the database and backup directory set in the environment
    Then the backup directory comes from the environment

  Scenario: The config file's own path is reported with its source
    When the storage paths resolve with the database set in the environment
    Then the config file row names the sandbox config file with source "env"

  Scenario: An unparseable config file refuses the launch naming the file and the error
    Given the config file contains invalid JSON
    When I attempt to launch
    Then the launch is refused naming the config file
    And no database was created in the sandbox

  Scenario: An unknown config key refuses the launch
    Given the config file carries an unknown key
    When I attempt to launch
    Then the launch is refused naming the config file
    And the refusal names the unknown key

  Scenario: A relative configured path refuses the launch
    Given the config file sets a relative database path
    When I attempt to launch
    Then the launch is refused naming the config file
    And no database was created in the sandbox

  Scenario: A configured database path with a live parent starts fresh there
    Given the config file sets a custom database path
    When I launch
    Then a database file exists at the configured path

  Scenario: A configured database path with a missing parent refuses the launch
    Given the config file sets a database path in a missing directory
    When I attempt to launch
    Then the launch is refused naming the database path and the config file
    And the missing directory was not created

  Scenario: The launch backup lands in the active backup directory
    Given an empty backup directory set in the environment
    And a launched database with one closed entry
    When I relaunch
    Then the active backup directory holds a timestamped backup named after the database
    And listing backups shows that backup

  Scenario: A missing backup directory never blocks the launch but is reported plainly
    Given a missing backup directory set in the environment
    And a launched database with one closed entry
    When I relaunch
    Then the database is still usable
    And listing backups reports the dead backup directory
    And forcing a backup reports the dead backup directory and no backup is claimed
