import XCTest
@testable import StintKit

/// Property-based coverage of the cardinal invariant (prd.html §03, §17 R2):
/// **at most one entry is ever open**, under *any* sequence of start/stop ops.
/// Where a single flow pins one path, this asserts the law over thousands.
final class InvariantPropertyTests: XCTestCase {
    private enum Op: CaseIterable { case start, stop }

    /// Deterministic, seedable PRNG so a failure is reproducible.
    private struct SplitMix64: RandomNumberGenerator {
        var state: UInt64
        mutating func next() -> UInt64 {
            state &+= 0x9E37_79B9_7F4A_7C15
            var z = state
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            return z ^ (z >> 31)
        }
    }

    // For ANY interleaving of start/stop, the open-entry count never exceeds 1.
    func testAtMostOneOpenEntryUnderAnyOpSequence() throws {
        for seed in UInt64(1)...200 {
            var rng = SplitMix64(state: seed)
            let store = try Store.inMemory()
            let base = Date(timeIntervalSince1970: 1_750_000_000)

            for step in 0..<40 {
                // Monotonic instants so each op is well-ordered in time.
                let instant = base.addingTimeInterval(TimeInterval(step))
                switch Op.allCases.randomElement(using: &rng)! {
                case .start: try store.start(description: nil, at: instant)
                case .stop: _ = try store.stop(at: instant)
                }
                XCTAssertLessThanOrEqual(
                    try store.openEntryCount(), 1,
                    "invariant violated at seed \(seed), step \(step)"
                )
            }
        }
    }

    // The invariant is also enforced structurally: a raw insert that bypasses
    // `start`'s close-then-open transition is rejected by the unique index, so
    // even a buggy or third-party writer cannot create a second open entry.
    func testDatabaseRejectsASecondOpenEntry() throws {
        let store = try Store.inMemory()
        let t0 = Date(timeIntervalSince1970: 1_750_000_000)
        try store.start(description: "first", at: t0)

        XCTAssertThrowsError(try store.attemptRawOpenInsert(at: t0.addingTimeInterval(1))) { error in
            // GRDB surfaces the UNIQUE-constraint failure as a DatabaseError.
            XCTAssertTrue("\(error)".contains("UNIQUE") || "\(error)".contains("unique"),
                          "expected a uniqueness violation, got: \(error)")
        }
        XCTAssertEqual(try store.openEntryCount(), 1)
    }
}
