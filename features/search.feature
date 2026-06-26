Feature: Free-text search (§09 R7)
  # PRD §09 R7 — a free-text query narrows the entry list to those whose description,
  # client name, project name, or any tag contains the query (case-insensitive substring).
  # This locks the search CONTRACT the GUI search box drives (gui/renderer/index.html
  # #search → window.stint.search({ query }) → core listEntries({ search })). It runs TWICE
  # — once over @stint/core (store.listEntries({ search })) and once over tt
  # (`tt list --all --json --search <query>`) — so the surfaces are proven identical (§17 R8).
  # The fixed clock is a Wednesday (2026-06-24); the entries below all fall in that week.

  Background:
    Given an empty database
    And a client "Acme" with project "Billing"
    And a client "Globex" with project "Ops"

  Scenario: Searching by description returns only matching entries
    Given a closed entry "auth refactor" for "Acme" / "Billing" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "deploy pipeline" for "Globex" / "Ops" tagged "ci" this week on day 2 lasting 1 hour
    When I search for "refactor"
    Then the search results are exactly "auth refactor"

  Scenario: Search matching is case-insensitive
    Given a closed entry "auth refactor" for "Acme" / "Billing" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "deploy pipeline" for "Globex" / "Ops" tagged "ci" this week on day 2 lasting 1 hour
    When I search for "REFACTOR"
    Then the search results are exactly "auth refactor"

  Scenario: Search matches the client name, not just the description
    Given a closed entry "auth refactor" for "Acme" / "Billing" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "deploy pipeline" for "Globex" / "Ops" tagged "ci" this week on day 2 lasting 1 hour
    When I search for "globex"
    Then the search results are exactly "deploy pipeline"

  Scenario: Search matches the project name
    Given a closed entry "auth refactor" for "Acme" / "Billing" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "deploy pipeline" for "Globex" / "Ops" tagged "ci" this week on day 2 lasting 1 hour
    When I search for "billing"
    Then the search results are exactly "auth refactor"

  Scenario: Search matches a tag
    Given a closed entry "auth refactor" for "Acme" / "Billing" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "deploy pipeline" for "Globex" / "Ops" tagged "ci" this week on day 2 lasting 1 hour
    When I search for "ci"
    Then the search results are exactly "deploy pipeline"

  Scenario: A query that matches nothing returns no entries
    Given a closed entry "auth refactor" for "Acme" / "Billing" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "deploy pipeline" for "Globex" / "Ops" tagged "ci" this week on day 2 lasting 1 hour
    When I search for "nonexistent"
    Then the search results contain 0 entries

  Scenario: A blank query returns every entry
    Given a closed entry "auth refactor" for "Acme" / "Billing" tagged "deep" this week on day 1 lasting 2 hours
    And a closed entry "deploy pipeline" for "Globex" / "Ops" tagged "ci" this week on day 2 lasting 1 hour
    When I search for ""
    Then the search results contain 2 entries
