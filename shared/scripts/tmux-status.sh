#!/bin/sh
# tmux-status.sh — render agent status from tmux pane user options
# Usage in tmux.conf:
#   set -g status-right '#(~/.agent-channels/tmux-status.sh #{pane_id})'
#
# Reads @agent-agent and @agent-progress pane options set by TmuxBackend.

pane_id="${1:-$(tmux display-message -p '#{pane_id}')}"

status=$(tmux show-options -pqv -t "$pane_id" @agent-agent 2>/dev/null)
progress=$(tmux show-options -pqv -t "$pane_id" @agent-progress 2>/dev/null)

out=""
[ -n "$status" ] && out="$status"
[ -n "$progress" ] && {
  [ -n "$out" ] && out="$out "
  out="${out}[$progress]"
}

printf '%s' "$out"
