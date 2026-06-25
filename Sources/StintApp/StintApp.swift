import SwiftUI

/// The menu-bar app: home base for the running timer, one click from start or
/// stop, sharing the exact same `StintKit.Store` the `tt` CLI writes to. There
/// is no second copy of the timer logic — "both first-class citizens" is
/// structural (concept.html §05).
@main
struct StintApp: App {
    @StateObject private var model = TimerModel()

    var body: some Scene {
        MenuBarExtra {
            MenuContentView(model: model)
        } label: {
            Text(model.menuBarTitle)
                .monospacedDigit()
        }
        .menuBarExtraStyle(.window)
    }
}
