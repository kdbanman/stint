#!/usr/bin/env bash
#
# A scripted `tt` session that tells the running-timer story end to end. The
# clock is pinned via TT_NOW at each step so the transcript is deterministic
# (and CI can capture it as evidence). Run after `swift build`:
#
#     ./scripts/demo.sh
#
set -euo pipefail

TT="${TT_BIN:-.build/debug/tt}"
export TZ=UTC
export TT_DB="$(mktemp -d)/stint-demo.sqlite"

# Print a faux prompt showing the simulated wall-clock time, then run tt.
step() {
    local now="$1"; shift
    export TT_NOW="$now"
    printf '\n%s $ %s\n' "${now:11:5}" "tt $*"
    "$TT" "$@"
}

echo "=== stint — tt vertical slice (start / stop / status) ==="

step 2026-06-24T09:00:00Z status
step 2026-06-24T09:14:00Z start "auth refactor"
step 2026-06-24T10:38:07Z status
step 2026-06-24T10:38:07Z status --json
step 2026-06-24T10:45:00Z start "code review"     # closes the open entry
step 2026-06-24T10:46:00Z status
step 2026-06-24T11:30:00Z stop
step 2026-06-24T11:30:00Z status
step 2026-06-24T11:30:00Z stop                    # nothing left to stop

echo
echo "=== end of session ==="
