import XCTest
@testable import StintKit

/// Behavioural (BDD-flavoured) coverage of the running-timer keystone,
/// stepped directly onto `Core`. Each test names the prd.html requirement it
/// pins. The same flows run through the `tt` binary in `ttTests` — that double
/// is how the §17 R8 "full parity" claim is exercised without a second spec.
final class StoreFlowTests: XCTestCase {
    /// A fixed instant so durations are exact, not wall-clock dependent.
    private let t0 = Date(timeIntervalSince1970: 1_750_000_000) // whole second

    private func makeStore() throws -> Store { try Store.inMemory() }

    // prd.html §05 R3 + §03: status reports the open entry, or nothing running.
    func testStatusIsEmptyOnAFreshDatabase() throws {
        let store = try makeStore()
        XCTAssertNil(try store.openEntry())
        XCTAssertEqual(try store.openEntryCount(), 0)
    }

    // prd.html §05 R1: start opens a new entry that status then reports.
    func testStartOpensAnEntry() throws {
        let store = try makeStore()
        let started = try store.start(description: "auth refactor", at: t0)

        let open = try XCTUnwrap(try store.openEntry())
        XCTAssertEqual(open, started)
        XCTAssertEqual(open.description, "auth refactor")
        XCTAssertTrue(open.isOpen)
        XCTAssertEqual(try store.openEntryCount(), 1)
    }

    // prd.html §05 R1 + §16 "start while running": starting while an entry is
    // open atomically closes the first — the keystone, observed as behaviour.
    func testStartingWhileOpenClosesTheFirst() throws {
        let store = try makeStore()
        let first = try store.start(description: "auth refactor", at: t0)
        let t1 = t0.addingTimeInterval(5400) // 90 min later
        let second = try store.start(description: "code review", at: t1)

        XCTAssertEqual(try store.openEntryCount(), 1, "exactly one entry stays open")
        let open = try XCTUnwrap(try store.openEntry())
        XCTAssertEqual(open.description, "code review")
        XCTAssertNotEqual(open.id, first.id)
        XCTAssertEqual(open.id, second.id)

        let closed = try XCTUnwrap(try store.allEntries().first { $0.id == first.id })
        XCTAssertEqual(closed.end, t1, "the first entry is closed at the second's start")
    }

    // prd.html §05 R2: stop sets end on the open entry; status then reports idle.
    func testStopClosesTheOpenEntry() throws {
        let store = try makeStore()
        try store.start(description: "deep work", at: t0)
        let t1 = t0.addingTimeInterval(3600)

        let stopped = try XCTUnwrap(try store.stop(at: t1))
        XCTAssertEqual(stopped.end, t1)
        XCTAssertEqual(stopped.elapsed(asOf: t1), 3600)
        XCTAssertNil(try store.openEntry())
        XCTAssertEqual(try store.openEntryCount(), 0)
    }

    // Stopping when nothing runs is a no-op that reports nothing stopped.
    func testStopWithNothingRunningReturnsNil() throws {
        let store = try makeStore()
        XCTAssertNil(try store.stop(at: t0))
    }

    // concept.html §02 + prd.html §03: elapsed is DERIVED (now − start), never
    // stored — so the same open entry reports a different elapsed at different
    // observation times, and re-reading never mutates the stored start.
    func testElapsedIsDerivedAndStartIsImmutable() throws {
        let store = try makeStore()
        let started = try store.start(description: "deep work", at: t0)

        XCTAssertEqual(started.elapsed(asOf: t0.addingTimeInterval(60)), 60)
        XCTAssertEqual(started.elapsed(asOf: t0.addingTimeInterval(3600)), 3600)

        // Repeated reads leave the stored start untouched (prd.html §17 R4).
        for _ in 0..<5 { _ = try store.openEntry() }
        XCTAssertEqual(try XCTUnwrap(try store.openEntry()).start, t0)
    }

    // prd.html §08: billable defaults true and --no-bill (billable: false) sticks.
    func testBillableFlagIsHonoured() throws {
        let store = try makeStore()
        try store.start(description: "billable", billable: true, at: t0)
        XCTAssertTrue(try XCTUnwrap(try store.openEntry()).billable)

        try store.start(description: "internal", billable: false, at: t0.addingTimeInterval(10))
        XCTAssertFalse(try XCTUnwrap(try store.openEntry()).billable)
    }
}
