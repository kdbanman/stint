import AppKit
import SwiftUI
import StintKit

/// The menu-bar popover. Monochrome by default; the running state and the
/// single primary action borrow the system accent and nothing else
/// (prd.html §07, §15). The running time is the one thing that gets to be big.
struct MenuContentView: View {
    @ObservedObject var model: TimerModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let entry = model.openEntry {
                running(entry)
            } else {
                idle()
            }
            Divider()
            Button("Quit Stint") { NSApplication.shared.terminate(nil) }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(width: 260, alignment: .leading)
    }

    @ViewBuilder
    private func running(_ entry: Entry) -> some View {
        Text(clock(entry.elapsed(asOf: model.now)))
            .font(.system(size: 34, weight: .medium, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(.tint) // accent on the running state only

        Text(entry.description ?? "your timer")
            .font(.headline)
            .foregroundStyle(.primary)

        Button("Stop") { model.stop() }
            .keyboardShortcut(.return)
            .buttonStyle(.borderedProminent) // the single primary action
    }

    @ViewBuilder
    private func idle() -> some View {
        // Empty state instructs rather than decorates (prd.html §12 R5).
        Text("Nothing running")
            .font(.headline)
        Text("Press Start, or run `tt start` in a terminal.")
            .font(.subheadline)
            .foregroundStyle(.secondary)

        Button("Start") { model.start() }
            .buttonStyle(.borderedProminent)
    }

    private func clock(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded(.down))
        return String(format: "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }
}
