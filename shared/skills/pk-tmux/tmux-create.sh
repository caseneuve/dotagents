#!/usr/bin/env bash
# tmux-create.sh - Create a tmux session if none exists, return session info
# Usage: tmux-create.sh [project-name] [project-cwd]
# If no args, derives from current directory
# Exit codes: 0 = created or already exists, 1 = error

set -euo pipefail

PROJECT="${1:-$(basename "$PWD")}"
PROJECT_CWD="${2:-$PWD}"

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

# Check if session already exists
if [[ -S "$SOCKET" ]] && tmux -S "$SOCKET" has-session -t "$PROJECT" 2>/dev/null; then
    echo "Session already exists"
    echo "Socket:  $SOCKET"
    echo "Session: $PROJECT"
    echo "Attach:  tmux -S $SOCKET attach -t $PROJECT"
    exit 0
fi

# Create new session
tmux -S "$SOCKET" new-session -d -s "$PROJECT" -c "$PROJECT_CWD"

echo "Session created"
echo "Socket:  $SOCKET"
echo "Session: $PROJECT"
echo "CWD:     $PROJECT_CWD"
echo "Attach:  tmux -S $SOCKET attach -t $PROJECT"
