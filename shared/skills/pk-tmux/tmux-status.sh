#!/usr/bin/env bash
# tmux-status.sh - Print current tmux session state for agent workflows
# Usage: tmux-status.sh [project-name] [project-cwd]
# If no args, derives from current directory

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

echo "=== TMUX SESSION STATUS ==="
echo "Project: $PROJECT"
echo "Socket:  $SOCKET"
echo "CWD:     $PROJECT_CWD"
echo ""

# Check if socket exists
if [[ ! -S "$SOCKET" ]]; then
    echo "Status: NO SESSION"
    echo ""
    echo "To create:"
    echo "  tmux -S $SOCKET new-session -d -s $PROJECT -c $PROJECT_CWD"
    exit 0
fi

# Check if session exists
if ! tmux -S "$SOCKET" has-session -t "$PROJECT" 2>/dev/null; then
    echo "Status: SOCKET EXISTS, NO SESSION"
    echo ""
    echo "To create:"
    echo "  tmux -S $SOCKET new-session -d -s $PROJECT -c $PROJECT_CWD"
    exit 0
fi

echo "Status: ACTIVE"
echo ""
echo "To attach:"
echo "  tmux -S $SOCKET attach -t $PROJECT"
echo ""
echo "=== WINDOWS ==="
# Format: index: name | cwd | running_command
tmux -S "$SOCKET" list-windows -t "$PROJECT" -F "#{window_index}" | while read -r win_idx; do
    win_name=$(tmux -S "$SOCKET" display-message -t "$PROJECT:$win_idx" -p "#{window_name}")
    pane_cwd=$(tmux -S "$SOCKET" display-message -t "$PROJECT:$win_idx" -p "#{pane_current_path}")
    pane_cmd=$(tmux -S "$SOCKET" display-message -t "$PROJECT:$win_idx" -p "#{pane_current_command}")

    # Determine if busy (not at shell prompt)
    busy=""
    if [[ "$pane_cmd" != "bash" && "$pane_cmd" != "zsh" && "$pane_cmd" != "fish" && "$pane_cmd" != "sh" ]]; then
        busy=" [RUNNING]"
    fi

    echo "  $win_idx: $win_name$busy"
    echo "     cmd: $pane_cmd"
    echo "     cwd: $pane_cwd"
done
echo ""
echo "=== QUICK COMMANDS ==="
echo "New window:    tmux -S $SOCKET new-window -t $PROJECT -n <name> -c $PROJECT_CWD"
echo "Send command:  tmux -S $SOCKET send-keys -t $PROJECT:<window> '<cmd>' Enter"
echo "Capture out:   tmux -S $SOCKET capture-pane -t $PROJECT:<window> -p -S -20"
echo "Kill window:   tmux -S $SOCKET kill-window -t $PROJECT:<window>"
echo "Kill session:  tmux -S $SOCKET kill-session -t $PROJECT"
