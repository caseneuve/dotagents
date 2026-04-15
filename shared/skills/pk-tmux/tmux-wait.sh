#!/usr/bin/env bash
# tmux-wait.sh - Wait for a tmux window command to complete, optionally capture output
# Usage: tmux-wait.sh [project-name] [window] [capture-lines]
# Args:
#   project-name  - Project name (default: basename of $PWD)
#   window        - Window name or index to monitor (default: 0)
#   capture-lines - Number of lines to capture on completion (default: 0 = no capture)
#
# Designed to run in background: tmux-wait.sh myproject build 50 &
# Exit codes: 0 = command finished, 1 = error/session not found

set -euo pipefail

PROJECT="${1:-$(basename "$PWD")}"
WINDOW="${2:-0}"
CAPTURE_LINES="${3:-0}"

detect_socket_prefix() {
    if [[ -n "${TMUX_SOCKET_PREFIX:-}" ]]; then
        echo "$TMUX_SOCKET_PREFIX"
    elif [[ "${BASH_SOURCE[0]}" == *"/.claude/"* || "${BASH_SOURCE[0]}" == *"/claude/"* ]]; then
        echo "claude"
    else
        echo "agents"
    fi
}

SOCKET="/tmp/$(detect_socket_prefix)-${PROJECT}.sock"

# Verify session exists
if ! tmux -S "$SOCKET" has-session -t "$PROJECT" 2>/dev/null; then
    echo "Error: Session '$PROJECT' not found at $SOCKET" >&2
    exit 1
fi

# Verify window exists
if ! tmux -S "$SOCKET" list-windows -t "$PROJECT" -F "#{window_name}" | grep -qx "$WINDOW" && \
   ! tmux -S "$SOCKET" list-windows -t "$PROJECT" -F "#{window_index}" | grep -qx "$WINDOW"; then
    echo "Error: Window '$WINDOW' not found in session '$PROJECT'" >&2
    exit 1
fi

echo "Waiting for command to complete in $PROJECT:$WINDOW..."

# Poll until shell prompt returns
while true; do
    cmd=$(tmux -S "$SOCKET" display-message -t "$PROJECT:$WINDOW" -p "#{pane_current_command}")
    if [[ "$cmd" == "bash" || "$cmd" == "zsh" || "$cmd" == "fish" || "$cmd" == "sh" ]]; then
        break
    fi
    sleep 1
done

echo "Command finished in $PROJECT:$WINDOW"

# Capture output if requested
if [[ "$CAPTURE_LINES" -gt 0 ]]; then
    echo ""
    echo "=== OUTPUT (last $CAPTURE_LINES lines) ==="
    tmux -S "$SOCKET" capture-pane -t "$PROJECT:$WINDOW" -p -S -"$CAPTURE_LINES"
fi
