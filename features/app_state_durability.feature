Feature: app_state durability (schedule never drifts from its entry)
  # PRD §20 R07 — the reconciliation/schedule state in `app_state` (the check-in schedule under
  # `checkin_state`, anchored at the running entry's start) is written in the SAME transaction as
  # the entry write that changes it, so a crash can never leave the open entry and its schedule
  # state divergent. This locks that CONTRACT and runs TWICE — once over @stint/core (a file-backed
  # Store: store.start/stop seed/clear the schedule atomically, store.checkinState reads it) and
  # once over tt (`tt start`/`tt stop`, each a process that must DURABLY commit the schedule before
  # exiting) — so the same-transaction durability is proven at full parity (§17 R8). Both surfaces
  # read the schedule anchor back across a fresh launch, proving it survives the process boundary.
  # The clock is fixed (a Wednesday), so 09:00 is an unambiguous instant on both surfaces.

  Background:
    Given an empty database

  Scenario: Starting a timer durably persists its check-in schedule
    # start() seeds the schedule atomically with the open entry. The schedule is anchored at the
    # entry's start, and it survives reopening the store (committed durably, not just in-process).
    When I start an entry "auth refactor" at 09:00
    Then the persisted check-in schedule is anchored at 09:00
    And the persisted check-in schedule is anchored at 09:00 after reopening the store

  Scenario: Stopping clears the schedule atomically with the close
    # With a running entry and its persisted schedule, stopping clears the schedule in the SAME
    # transaction as the close: after a reopen the entry is closed AND no schedule is persisted —
    # both true together, so a crash can never leave a stale schedule pointing at a closed entry.
    Given I start an entry "auth refactor" at 09:00
    And the persisted check-in schedule is anchored at 09:00
    When I stop at 10:30
    Then no check-in schedule is persisted
    And no check-in schedule is persisted after reopening the store
    And nothing is running after reopening the store
