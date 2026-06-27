Feature: Parity for the new entities (§17 R14)
  # PRD §17 R14 (new) — the two NEW v1 entities, FAVORITES (pinned timer templates, §05
  # R09–R10) and SAVED REPORTS (named report definitions, §09 R08–R09), must each be FULLY
  # reachable from BOTH surfaces: the GUI and `tt`, behaving identically. This feature is the
  # cross-surface PARITY PROOF for those entities — the §17 R8 dual-run claim, applied to the
  # capability classes the new entities add. It owns no production code: favorites live in
  # @stint/core + `tt fav` (§05 R09–R10, §11), saved reports in @stint/core + `tt report …`
  # saved verbs (§09 R08–R09, §11), and the GUI Timer favorites rail / Reports view (§12
  # R08/R14). This feature only EXERCISES them, surface-neutrally.
  #
  # Like reachable_by_hand.feature / parity.feature, it does NOT test pixels (the BDD harness
  # has no window) — it proves the CAPABILITY SET behind the buttons is real and behaves
  # identically on BOTH surfaces. Every scenario runs TWICE via run.test.ts: once over
  # @stint/core (the engine the GUI's IPC handlers delegate to) and once over `tt` (the parity
  # twin). A scenario that passes on both surfaces IS the parity proof for that entity's
  # lifecycle. The companion STATIC claim — that the GUI window actually wires each new IPC
  # channel to a `tt` path — is the GOLD parity-matrix: the `pinFavorite`/`listFavorites`/
  # `renameFavorite`/`unpinFavorite`/`resumeFavorite` and `saveReport`/`listReports`/
  # `showReport`/`editReport`/`removeReport`/`runReport` rows are authored by §05 R09/R10 and
  # §09 R08/R09 (this feature consumes them, it does not edit parity-matrix.json).
  #
  # Each scenario names the GUI IPC channel + the `tt` path it rides, so the both-surfaces
  # path is explicit. The deep arithmetic of each entity (template capture, relative-spec
  # resolution, run totals) is owned by features/favorites.feature and features/saved_reports
  # .feature; this feature asserts the FULL LIFECYCLE of each entity is reachable on BOTH
  # surfaces — it would fail if either entity were reachable on only one surface or behaved
  # differently across them. The fixed clock is a Wednesday, so "this week"/"last week" are
  # unambiguous.

  Background:
    Given an empty database
    And a client "Acme" with project "API"
    And a client "Globex" with project "Ops"

  Scenario: Favorite full lifecycle by hand — pin, list, rename, unpin
    # §05 R09 — the whole pinned-template lifecycle, reachable on both surfaces. GUI: the
    # Timer view's favorites rail → addFavorite / listFavorites / renameFavorite /
    # removeFavorite IPC; tt: `tt fav add` / `tt fav ls` / `tt fav rename` / `tt fav rm`.
    # Passing on BOTH worlds proves a favorite can be created, listed, renamed, and unpinned
    # identically from the GUI and from tt — it would fail if the favorite were reachable on
    # only one surface or its captured template differed across them.
    When I start an entry "standup" for "Acme" / "API" at 09:00
    And I mark the open entry billable
    And I pin a favorite "Standup" from the running entry
    And I view the favorites
    Then the favorites list includes "Standup"
    And the favorite "Standup" is for "Acme / API"
    And the favorite "Standup" is billable
    When I rename the favorite "Standup" to "Daily standup"
    And I view the favorites
    Then the favorites list includes "Daily standup"
    And the favorites list does not include "Standup"
    When I unpin the favorite "Daily standup"
    And I view the favorites
    Then the favorites list does not include "Daily standup"

  Scenario: Resume from a favorite by hand — the open entry inherits the template
    # §05 R10 — one action starts a FRESH timer from a favorite's template; the open entry
    # must carry the favorite's description / client / project / billable identically on both
    # surfaces. GUI: the rail's one-click Resume → resumeFavorite IPC; tt: `tt fav start
    # <name>` (and the second route `tt start --fav <name>`). It would fail if resume were
    # reachable on only one surface or the inherited attributes differed across them.
    When I pin a favorite "API deep work" for "Acme" / "API" tagged "deep,focus"
    And I resume from favorite "API deep work"
    Then exactly one entry is open
    And the open entry is for "Acme / API"
    And the running timer is for "Acme / API"
    And the running timer is billable
    And the running timer has tag "deep"
    And the favorites list includes "API deep work"

  Scenario: Saved report full lifecycle by hand — save, list, show, edit, delete
    # §09 R08 — the whole saved-definition lifecycle, reachable on both surfaces. GUI: the
    # Reports view → saveReport / listReports / showReport / editReport / removeReport IPC;
    # tt: `tt report save` / `tt report ls` / `tt report show` / `tt report edit` / `tt report
    # rm`. "Show" is observed through the run: a saved definition resolves to exactly the
    # fields it was saved with, so running it and matching an ad-hoc report over those same
    # fields proves the stored {range-spec, group-by, filter} are intact and identical on both
    # surfaces. Editing the range re-resolves it on the next run. It would fail if saved
    # reports were tt-only / GUI-only or resolved differently across surfaces.
    Given a closed entry "review" for "Acme" this week lasting 1 hour
    And a closed entry "ops sync" for "Globex" last week lasting 2 hours
    When I save a report "Weekly" for this week grouped by client over billable time
    Then the saved report list includes "Weekly"
    When I run the saved report "Weekly"
    Then the saved report run totals 1 billable hour
    And the saved report run total equals an ad-hoc this week report grouped by client over billable time
    When I change the saved report "Weekly" range to last week
    And I run the saved report "Weekly"
    Then the saved report run totals 2 billable hours
    And the saved report run total equals an ad-hoc last week report grouped by client over billable time
    When I delete the saved report "Weekly"
    Then the saved report list does not include "Weekly"

  Scenario: Run a saved report by hand — its grouped totals equal the equivalent ad-hoc report
    # §09 R09 — running a saved definition must yield the SAME grouped totals as the equivalent
    # ad-hoc report over the same data, because both resolve their relative range through the
    # one core resolveRange. GUI: the Reports view's Run → runReport IPC; tt: `tt report run
    # <name>`. Asserted on BOTH surfaces, so a saved report and an ad-hoc report can never
    # diverge — and the saved report is reachable from the GUI and tt alike.
    Given a closed entry "review" for "Acme" this week lasting 3 hours
    And a closed entry "ops sync" for "Globex" last week lasting 2 hours
    When I save a report "This week" for this week grouped by client over billable time
    And I run the saved report "This week"
    Then the saved report run totals 3 billable hours
    And the saved report run total equals an ad-hoc this week report grouped by client over billable time
