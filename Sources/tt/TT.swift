import ArgumentParser
import Foundation
import StintKit

/// `tt` — the terminal surface over Stint's shared core. A first-class way in,
/// not an afterthought (concept.html §05). This slice ships the running-timer
/// keystone; the remaining commands in prd.html §11 layer onto the same `Store`.
@main
struct TT: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "tt",
        abstract: "A quiet, native time tracker for billable hours.",
        version: "0.1.0 (vertical slice: start/stop/status)",
        subcommands: [Start.self, Stop.self, Status.self],
        defaultSubcommand: Status.self
    )
}

// MARK: - start

struct Start: ParsableCommand {
    static let configuration = CommandConfiguration(
        abstract: "Stop any open entry and start a new one."
    )

    @Argument(help: "Optional description of what you're working on.")
    var description: String?

    @Flag(name: .long, help: "Mark the new entry non-billable.")
    var noBill = false

    func run() throws {
        let store = try Environment.openStore()
        let previous = try store.openEntry()
        let entry = try store.start(
            description: description,
            billable: !noBill,
            at: Environment.now()
        )
        if previous != nil {
            printError("note: stopped the previously open entry")
        }
        if let desc = entry.description {
            print("▸ started · \"\(desc)\"")
        } else {
            print("▸ started")
        }
    }
}

// MARK: - stop

struct Stop: ParsableCommand {
    static let configuration = CommandConfiguration(
        abstract: "Stop the open entry."
    )

    func run() throws {
        let store = try Environment.openStore()
        let now = Environment.now()
        guard let stopped = try store.stop(at: now) else {
            print("nothing to stop")
            return
        }
        print("■ stopped · \(Format.duration(stopped.elapsed(asOf: now)))")
    }
}

// MARK: - status

struct Status: ParsableCommand {
    static let configuration = CommandConfiguration(
        abstract: "Show the open entry and its derived elapsed time."
    )

    @Flag(name: .long, help: "Emit machine-readable JSON.")
    var json = false

    func run() throws {
        let store = try Environment.openStore()
        let now = Environment.now()
        let open = try store.openEntry()

        if json {
            let payload = StatusPayload(
                running: open != nil,
                entry: open.map { e in
                    EntryPayload(
                        id: e.id,
                        description: e.description,
                        start_utc: ISO8601.string(from: e.start),
                        elapsed_seconds: Int(e.elapsed(asOf: now)),
                        billable: e.billable
                    )
                }
            )
            print(JSON.string(payload))
            return
        }

        guard let entry = open else {
            print("nothing running")
            return
        }
        let clock = Format.clock(entry.elapsed(asOf: now))
        if let desc = entry.description {
            print("▸ running \(clock) · \"\(desc)\"")
        } else {
            print("▸ running \(clock)")
        }
    }
}
