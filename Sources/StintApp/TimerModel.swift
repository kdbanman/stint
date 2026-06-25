import Combine
import Foundation
import StintKit

/// Observable view-model bridging SwiftUI to the shared `Store`. It holds no
/// timer state of its own: every tick it simply re-reads the open entry and
/// re-derives elapsed (`now − start`), which is also why a `tt start` from the
/// terminal surfaces here within a second — both surfaces read one file.
///
/// Updates are published on the main run loop (the timer fires there), so the
/// `@Published` properties mutate where SwiftUI expects them to.
final class TimerModel: ObservableObject {
    @Published private(set) var openEntry: Entry?
    @Published private(set) var now: Date = Date()

    private let store: Store?
    private var ticker: AnyCancellable?

    init() {
        self.store = try? Environment.openStore()
        refresh()
        // A 1-second display tick on the main run loop. This is pure
        // presentation — closing the lid for an hour and reopening still shows
        // the correct elapsed, because the number was never being kept anywhere
        // to drift; it is re-derived from `now − start` each tick.
        ticker = Timer.publish(every: 1, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in self?.refresh() }
    }

    /// `true` while an entry is open.
    var isRunning: Bool { openEntry != nil }

    /// The menu-bar label: the running clock, or an idle glyph.
    var menuBarTitle: String {
        guard let entry = openEntry else { return "▸" }
        return "▸ " + clock(entry.elapsed(asOf: now))
    }

    func refresh() {
        now = Environment.now()
        openEntry = (try? store?.openEntry()) ?? nil
    }

    func start() {
        _ = try? store?.start(at: Date())
        refresh()
    }

    func stop() {
        _ = try? store?.stop(at: Date())
        refresh()
    }

    private func clock(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded(.down))
        return String(format: "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }
}

/// GUI-side database resolution, mirroring the CLI's `Environment`.
enum Environment {
    static func openStore() throws -> Store {
        let path: String
        if let override = ProcessInfo.processInfo.environment["TT_DB"], !override.isEmpty {
            path = override
        } else {
            path = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support/Stint/timetracker.sqlite")
                .path
        }
        return try Store(path: path)
    }

    static func now() -> Date {
        if let raw = ProcessInfo.processInfo.environment["TT_NOW"],
           let parsed = ISO8601.date(from: raw) {
            return parsed
        }
        return Date()
    }
}
