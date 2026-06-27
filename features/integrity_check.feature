Feature: Integrity check on open (data-loss protection)
  # PRD §20 R03 — on every file-backed open the database is integrity-checked (`PRAGMA quick_check`)
  # BEFORE any write. On failure the open must NOT fall through to normal operation on the corrupt
  # file: it is refused (and recovery is triggered — §20 R05). This locks the bare DETECT-AND-REFUSE
  # half of R03, isolated from R05's recover-from-backup path: the corrupt database here has NO
  # backup beside it, so the only correct outcome is "corruption detected, the open refused, and not
  # one byte written to the bad file". It runs TWICE — once over @stint/core (a file-backed openDb,
  # which throws before any write) and once over tt (every `tt` open re-runs the gate; a corrupt open
  # exits non-zero and names the integrity failure) — so write-refusal is proven at full parity
  # (§17 R8). No Background: the corruption capability owns its own isolated, backup-less database.

  Scenario: Corrupt database is detected on open and refused before any write
    Given the database file is corrupted
    When I open the database
    Then the open is refused before any write
