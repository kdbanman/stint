Feature: Favorites (pinned timer templates)
  # PRD §05 R09 — a favorite is a named, pinned timer template: a preset of the attributes a
  # timer starts with (description, client, project, billable, tags). It is NOT a timer (it has
  # no start/end); resuming from it (§05 R10) starts a fresh entry from the template. This locks
  # the favorite CONTRACT the GUI Timer view's favorites rail drives; it runs TWICE — once over
  # @stint/core (store.pinFavorite/listFavorites/renameFavorite/unpinFavorite) and once over tt
  # (`tt fav add|ls|rename|rm`) — so template capture, list, rename, and unpin are proven at full
  # parity (§17 R8/R14). The fixed clock is a Wednesday.

  Background:
    Given an empty database
    And a client "Acme" with project "API"
    And a client "Globex" with project "Ops"

  Scenario: Pin a favorite from the running entry captures its template
    # The favorite copies the running entry's client/project/billable/description — the rail's
    # Pin-from-running-timer. The captured template is what a later resume (§05 R10) starts from.
    When I start an entry "standup" for "Acme" / "API" at 09:00
    And I mark the open entry billable
    And I pin a favorite "Standup" from the running entry
    And I view the favorites
    Then the favorites list includes "Standup"
    And the favorite "Standup" is for "Acme / API"
    And the favorite "Standup" has description "standup"
    And the favorite "Standup" is billable

  Scenario: Pin a favorite from a closed entry captures its template
    Given a closed entry "ops sync" for "Globex" / "Ops" from 10:00 to 11:00
    When I pin a favorite "Ops sync" from the entry "ops sync"
    And I view the favorites
    Then the favorites list includes "Ops sync"
    And the favorite "Ops sync" is for "Globex / Ops"
    And the favorite "Ops sync" has description "ops sync"

  Scenario: Pin a favorite from explicit attributes
    When I pin a favorite "API deep work" for "Acme" / "API" tagged "deep,focus"
    And I view the favorites
    Then the favorites list includes "API deep work"
    And the favorite "API deep work" is for "Acme / API"
    And the favorite "API deep work" has tag "deep"
    And the favorite "API deep work" has tag "focus"
    And the favorite "API deep work" is billable

  Scenario: Renaming a favorite changes its name and the old name no longer resolves
    When I pin a favorite "Draft" for "Acme" / "API" tagged "deep"
    Then the favorites list includes "Draft"
    When I rename the favorite "Draft" to "Final"
    And I view the favorites
    Then the favorites list includes "Final"
    And the favorites list does not include "Draft"

  Scenario: Unpinning a favorite removes it from the list
    When I pin a favorite "Temp" for "Acme" / "API" tagged "deep"
    Then the favorites list includes "Temp"
    When I unpin the favorite "Temp"
    And I view the favorites
    Then the favorites list does not include "Temp"

  # PRD §05 R10 — resume from a favorite: one action starts a FRESH timer from the favorite's
  # template (the rail's one-click Resume / `tt fav start <name>` / `tt start --fav <name>`). The
  # favorite is a template, never mutated; a new entry/new id is created, inheriting the atomic
  # close-open-then-open behavior and the ≤1-open invariant from start. Run TWICE (core + tt).

  Scenario: Resume from a favorite starts a fresh running timer carrying the template
    When I pin a favorite "Acme standup" for "Acme" / "API" tagged "meeting"
    And I resume from favorite "Acme standup"
    Then the running timer is for "Acme / API"
    And the running timer is billable
    And the running timer has tag "meeting"
    And the favorites list includes "Acme standup"

  Scenario: Resume from a favorite while another timer is open atomically stops the open one
    When I start an entry "earlier work" at 09:00
    And I pin a favorite "API deep work" for "Acme" / "API" tagged "deep"
    And I resume from favorite "API deep work"
    Then exactly one entry is open
    And the entry "earlier work" is closed with end 23:59

  Scenario: The tt start --fav route is at parity with fav start
    When I pin a favorite "Ops sync" for "Globex" / "Ops" tagged "ops"
    And I start with --fav "Ops sync"
    Then the running timer is for "Globex / Ops"
    And the running timer is billable
    And the running timer has tag "ops"

  Scenario: Resuming from an unknown favorite fails cleanly
    When I attempt to resume from favorite "nope"
    Then the resume from favorite is rejected
    And exactly zero entries are open
