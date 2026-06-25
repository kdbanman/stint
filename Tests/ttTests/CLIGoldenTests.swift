import XCTest

/// Golden coverage of the `tt` contract (acceptance.html §08): exact stdout,
/// exit codes, and the `--json` shape are the requirement, so they are pinned
/// byte-for-byte. The binary is driven as a black box with a pinned clock
/// (`TT_NOW`) and a throwaway database (`TT_DB`).
final class CLIGoldenTests: XCTestCase {
    /// A fixed start instant and a point 90 minutes later (01:30:00 elapsed).
    private let t0 = "2026-06-24T09:00:00Z"
    private let t90 = "2026-06-24T10:30:00Z"

    // MARK: - Harness

    private var productsDirectory: URL {
        #if os(macOS)
        for bundle in Bundle.allBundles where bundle.bundlePath.hasSuffix(".xctest") {
            return bundle.bundleURL.deletingLastPathComponent()
        }
        fatalError("couldn't locate the products directory")
        #else
        return Bundle.main.bundleURL
        #endif
    }

    private func freshDatabasePath() -> String {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("tt-golden-\(UUID().uuidString).sqlite")
            .path
    }

    @discardableResult
    private func tt(
        _ args: [String],
        db: String,
        now: String? = nil,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> (out: String, err: String, code: Int32) {
        let binary = productsDirectory.appendingPathComponent("tt")
        try XCTSkipUnless(
            FileManager.default.fileExists(atPath: binary.path),
            "tt binary not built; run `swift build` before `swift test`"
        )

        let process = Process()
        process.executableURL = binary
        process.arguments = args
        // Inherit the environment (so the dynamic linker / locale stay intact)
        // and override only the testing seams.
        var env = ProcessInfo.processInfo.environment
        env["TT_DB"] = db
        env["TZ"] = "UTC"
        env["TT_NOW"] = nil
        if let now { env["TT_NOW"] = now }
        process.environment = env

        let outPipe = Pipe(), errPipe = Pipe()
        process.standardOutput = outPipe
        process.standardError = errPipe
        try process.run()
        process.waitUntilExit()

        let out = String(decoding: outPipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        let err = String(decoding: errPipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        return (out, err, process.terminationStatus)
    }

    // MARK: - Golden cases

    func testStatusOnEmptyDatabase() throws {
        let db = freshDatabasePath()
        let r = try tt(["status"], db: db)
        XCTAssertEqual(r.out, "nothing running\n")
        XCTAssertEqual(r.code, 0)
    }

    func testStartThenStatusShowsDerivedClock() throws {
        let db = freshDatabasePath()

        let start = try tt(["start", "auth refactor"], db: db, now: t0)
        XCTAssertEqual(start.out, "▸ started · \"auth refactor\"\n")
        XCTAssertEqual(start.code, 0)

        let status = try tt(["status"], db: db, now: t90)
        XCTAssertEqual(status.out, "▸ running 01:30:00 · \"auth refactor\"\n")
        XCTAssertEqual(status.code, 0)
    }

    func testStatusJSONMatchesContract() throws {
        let db = freshDatabasePath()
        try tt(["start", "auth refactor"], db: db, now: t0)

        let r = try tt(["status", "--json"], db: db, now: t90)
        XCTAssertEqual(r.code, 0)

        let json = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(r.out.utf8)) as? [String: Any]
        )
        XCTAssertEqual(json["running"] as? Bool, true)
        let entry = try XCTUnwrap(json["entry"] as? [String: Any])
        XCTAssertNotNil(entry["id"] as? Int)
        XCTAssertEqual(entry["description"] as? String, "auth refactor")
        XCTAssertEqual(entry["start_utc"] as? String, t0)
        XCTAssertEqual(entry["elapsed_seconds"] as? Int, 5400)
        XCTAssertEqual(entry["billable"] as? Bool, true)
    }

    func testStartWhileRunningStopsTheFirst() throws {
        let db = freshDatabasePath()
        try tt(["start", "auth refactor"], db: db, now: t0)

        let second = try tt(["start", "code review"], db: db, now: t90)
        XCTAssertEqual(second.out, "▸ started · \"code review\"\n")
        XCTAssertTrue(second.err.contains("stopped the previously open entry"),
                      "a note about closing the prior entry goes to stderr")

        let status = try tt(["status"], db: db, now: t90)
        XCTAssertEqual(status.out, "▸ running 00:00:00 · \"code review\"\n")
    }

    func testStopReportsDurationThenNothingToStop() throws {
        let db = freshDatabasePath()
        try tt(["start", "deep work"], db: db, now: t0)

        let stop = try tt(["stop"], db: db, now: t90)
        XCTAssertEqual(stop.out, "■ stopped · 1h 30m\n")
        XCTAssertEqual(stop.code, 0)

        let again = try tt(["stop"], db: db, now: t90)
        XCTAssertEqual(again.out, "nothing to stop\n")
        XCTAssertEqual(again.code, 0)

        let status = try tt(["status"], db: db, now: t90)
        XCTAssertEqual(status.out, "nothing running\n")
    }

    func testNoBillFlagIsReflectedInJSON() throws {
        let db = freshDatabasePath()
        try tt(["start", "internal admin", "--no-bill"], db: db, now: t0)

        let r = try tt(["status", "--json"], db: db, now: t0)
        let json = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(r.out.utf8)) as? [String: Any]
        )
        let entry = try XCTUnwrap(json["entry"] as? [String: Any])
        XCTAssertEqual(entry["billable"] as? Bool, false)
    }
}
