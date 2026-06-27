Feature: Backups & recovery (data-loss protection)
  # PRD §20 R04/R05, §17 R12 — the CORE data-loss-protection layer. On every launch the store
  # writes a timestamped backup beside the database IF the data changed since the last one, keeping
  # the last N (default 5). On open the database is integrity-checked BEFORE any write; if it is
  # corrupt the corrupt file is quarantined (`.corrupted-*`) and the latest good backup restored —
  # never silently losing data. This locks that CONTRACT and runs TWICE — once over @stint/core
  # (a file-backed Store: store.listBackups / restoreFromBackup, and Store.open's launch backup +
  # integrity gate) and once over tt (`tt backup ls`, and every `tt` open re-running the gate) —
  # so backup-on-launch and corruption recovery are proven at full parity (§17 R8/R12). The launch
  # backup captures the state AT launch (before that command's own writes), so a relaunch is what
  # snapshots the data just written, exactly as the GUI's launch backup does. The clock is fixed.

  Background:
    Given an empty database
    And a client "Acme" with project "API"

  Scenario: A fresh launch makes a recoverable backup
    # The closed entry is written; a relaunch then snapshots it into a backup. The latest backup,
    # opened independently of the live DB, carries that same entry — a real, recoverable copy.
    Given a closed entry "auth refactor" for "Acme" / "API" from 09:00 to 10:30
    When I relaunch the store
    Then there is at least one backup
    And the latest backup contains 1 entry

  Scenario: A corrupted database is recovered from the latest backup without data loss
    # With a good backup in place (entry count 1), corrupting the main file and relaunching must
    # detect the corruption on open, quarantine the corrupt file, restore from the latest good
    # backup, and reopen successfully — the recovered DB still has exactly the one entry (zero
    # data loss), and the good backup is still listed.
    Given a closed entry "auth refactor" for "Acme" / "API" from 09:00 to 10:30
    And I relaunch the store
    When I corrupt the database and relaunch the store
    Then the database has exactly 1 entry
    And the entry "auth refactor" is for "Acme / API"
    And the corrupt database file is quarantined beside the database
    And there is at least one backup
