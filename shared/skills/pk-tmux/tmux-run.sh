#!/usr/bin/env bash
# tmux-run.sh - Run a command in tmux and return clean output
# Usage: tmux-run.sh <window> <command> [--timeout SECONDS] [--cd DIR] [--sock PATH] [--session NAME]
#
# Single-call orchestrator: creates session/window, sends command, waits,
# returns only the command's stdout. Exits with the command's exit code.
#
# Options:
#   --sock PATH       Use this socket (skip session creation)
#   --session NAME    Use this session (skip session creation)
#   --cd DIR          cd into DIR before running the command
#   --timeout SECONDS Timeout in seconds (default: 300)
#
# When --sock and --session are both provided, session creation is skipped.
# Session/socket info is printed to stderr so agents can capture it.
#
# Examples:
#   tmux-run.sh build 'make all'
#   tmux-run.sh test 'npm test' --timeout 600
#   tmux-run.sh lint 'ruff check .' --cd ~/myproject
#   tmux-run.sh deploy 'kubectl apply -f .' --sock /tmp/agents-app.sock --session app

set -euo pipefail

TIMEOUT=300
WINDOW=""
CMD=""
CD_DIR=""
SOCK=""
SESSION=""

detect_socket_prefix() {
    if [[ -n "${TMUX_SOCKET_PREFIX:-}" ]]; then
        echo "$TMUX_SOCKET_PREFIX"
    elif [[ "${BASH_SOURCE[0]}" == *"/.claude/"* || "${BASH_SOURCE[0]}" == *"/claude/"* ]]; then
        echo "claude"
    else
        echo "agents"
    fi
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --timeout|--cd|--sock|--session)
            if [[ $# -lt 2 ]]; then
                echo "Error: $1 requires a value" >&2; exit 1
            fi
            ;;&
        --timeout) TIMEOUT="$2"; shift 2 ;;
        --cd)      CD_DIR="$2"; shift 2 ;;
        --sock)    SOCK="$2"; shift 2 ;;
        --session) SESSION="$2"; shift 2 ;;
        *)
            if [[ -z "$WINDOW" ]]; then
                WINDOW="$1"
            elif [[ -z "$CMD" ]]; then
                CMD="$1"
            fi
            shift ;;
    esac
done

if [[ -z "$WINDOW" ]] || [[ -z "$CMD" ]]; then
    echo "Usage: tmux-run.sh <window> <command> [--timeout SECONDS] [--cd DIR] [--sock PATH] [--session NAME]" >&2
    exit 1
fi

# --- Session setup (skip if --sock and --session provided) ---
if [[ -n "$SOCK" ]] && [[ -n "$SESSION" ]]; then
    if ! tmux -S "$SOCK" has-session -t "$SESSION" 2>/dev/null; then
        echo "ERROR: Session '$SESSION' not found on socket '$SOCK'" >&2
        exit 1
    fi
else
    PROJECT="$(basename "$PWD")"
    BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'default')"
    if command -v md5sum &>/dev/null; then
      HASH="$(echo "$BRANCH" | md5sum | head -c 6)"
    else
      HASH="$(md5 -qs "$BRANCH" | head -c 6)"
    fi
    SOCK="/tmp/$(detect_socket_prefix)-${PROJECT}-${HASH}.sock"
    SESSION="${PROJECT}-${HASH}"

    if ! [[ -S "$SOCK" ]] || ! tmux -S "$SOCK" has-session -t "$SESSION" 2>/dev/null; then
        tmux -S "$SOCK" new-session -d -s "$SESSION" -c "$PWD"
        echo "Session created: $SESSION" >&2
    fi
fi

echo "Socket: $SOCK" >&2
echo "Session: $SESSION" >&2
echo "Attach: tmux -S $SOCK attach -t $SESSION" >&2

# --- Window setup ---
if ! tmux -S "$SOCK" list-windows -t "$SESSION" -F '#W' | grep -qx "$WINDOW"; then
    tmux -S "$SOCK" new-window -t "$SESSION" -n "$WINDOW" -c "$PWD"
fi

TARGET="$SESSION:$WINDOW"

# --- cd if requested ---
if [[ -n "$CD_DIR" ]]; then
    tmux -S "$SOCK" send-keys -t "$TARGET" "cd $CD_DIR" Enter
    sleep 0.3
fi

# --- Send command with markers ---
MARKER="TMUXRUN_$(date +%s)_${RANDOM}_$$"
START="${MARKER}_START"
END="${MARKER}_END"

tmux -S "$SOCK" send-keys -t "$TARGET" "echo ${START}; ${CMD}; echo ${END}:\$?" Enter

# --- Poll for end marker ---
ELAPSED=0
INTERVAL=2
while true; do
    if tmux -S "$SOCK" capture-pane -t "$TARGET" -p -S -1000 | grep -q "^${END}:"; then
        break
    fi
    if [[ "$ELAPSED" -ge "$TIMEOUT" ]]; then
        echo "TIMEOUT: command did not complete within ${TIMEOUT}s" >&2
        exit 124
    fi
    sleep "$INTERVAL"
    ELAPSED=$((ELAPSED + INTERVAL))
done

sleep 0.2

# --- Extract clean output ---
RAW=$(tmux -S "$SOCK" capture-pane -t "$TARGET" -p -S -1000)

START_LINE=$(echo "$RAW" | grep -n "^${START}$" | tail -1 | cut -d: -f1)
END_LINE=$(echo "$RAW" | grep -n "^${END}:" | tail -1 | cut -d: -f1)

if [[ -z "$START_LINE" ]] || [[ -z "$END_LINE" ]]; then
    echo "ERROR: Could not find output markers in pane" >&2
    echo "$RAW" >&2
    exit 1
fi

FIRST=$((START_LINE + 1))
LAST=$((END_LINE - 1))

if [[ "$FIRST" -le "$LAST" ]]; then
    echo "$RAW" | sed -n "${FIRST},${LAST}p"
fi

# Extract exit code from end marker
EXIT_LINE=$(echo "$RAW" | grep "^${END}:" | tail -1)
EXIT_CODE="${EXIT_LINE##*:}"

exit "${EXIT_CODE:-0}"
