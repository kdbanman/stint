Feature: One open entry across surfaces
  # PRD §05 R1, §16 "start while running", §17 R2 — the keystone invariant,
  # observed as behaviour. Every scenario is run twice: once stepped onto
  # @stint/core directly, once through the tt executable — which is how the
  # "full parity" claim (§17 R8) is tested without a second copy of the spec.

  Background:
    Given an empty database
    And a client "Client A" with project "API"

  Scenario: Starting while an entry is open closes the first one
    Given I start an entry "auth refactor" for "Client A" / "API" at 09:00
    When I start an entry "code review" at 10:30
    Then exactly one entry is open
    And the entry "auth refactor" is closed with end 10:30
    And the open entry is "code review"

  Scenario: A timer started in one surface is visible to status with no disagreement
    When I start an entry "auth refactor" for "Client A" / "API" at 09:00
    Then status reports an open entry "auth refactor" for "Client A / API"

  Scenario: Stopping closes the open entry and leaves nothing running
    Given I start an entry "deep work" at 09:00
    When I stop at 10:00
    Then exactly zero entries are open
    And status reports nothing running
