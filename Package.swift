// swift-tools-version: 5.9
import PackageDescription

// Stint is a shared-core time tracker: one `StintKit` package owns the schema,
// state transitions, and invariants; the `tt` CLI and the SwiftUI menu-bar app
// are thin, equal shells over it (see prd.html §04).
//
// This package currently implements one thin vertical slice — the running-timer
// keystone: `start`, `stop`, `status` over a single SQLite file, enforcing the
// "at most one open entry" invariant in the core.
//
// Persistence is the system SQLite (WAL mode, busy timeout, BEGIN IMMEDIATE
// transitions), reached through a tiny first-party `CSQLite` shim. The PRD
// names GRDB; GRDB 6 links `sqlite3_snapshot_*`, which the stock Linux SQLite
// isn't built with, so for a portable slice we keep a thin, well-contained
// SQLite layer behind the `Store` seam and can adopt a richer toolkit later.
let package = Package(
    name: "Stint",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "StintKit", targets: ["StintKit"]),
        .executable(name: "tt", targets: ["tt"]),
    ],
    dependencies: [
        // Apple's argument parser for the CLI surface.
        .package(url: "https://github.com/apple/swift-argument-parser.git", from: "1.3.0"),
    ],
    targets: [
        // Thin module exposing the system SQLite C API to Swift.
        .target(
            name: "CSQLite",
            linkerSettings: [.linkedLibrary("sqlite3")]
        ),
        .target(
            name: "StintKit",
            dependencies: ["CSQLite"]
        ),
        .executableTarget(
            name: "tt",
            dependencies: [
                "StintKit",
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
            ]
        ),
        .testTarget(
            name: "StintKitTests",
            dependencies: ["StintKit"]
        ),
        .testTarget(
            name: "ttTests",
            dependencies: ["StintKit"]
        ),
    ]
)

// The SwiftUI menu-bar app is macOS-only. It is added to the package only when
// the manifest is evaluated on macOS, so `swift build`/`swift test` on Linux CI
// stays clean while the macOS CI job builds the full GUI against the same Core.
#if os(macOS)
package.products.append(.executable(name: "StintApp", targets: ["StintApp"]))
package.targets.append(
    .executableTarget(name: "StintApp", dependencies: ["StintKit"])
)
#endif
