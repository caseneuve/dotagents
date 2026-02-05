#!/usr/bin/env bash
# todo-next-id.sh — Return the next available todo ID
#
# Usage:
#   todo-next-id.sh [--dir DIR] [PARENT]
#
# Arguments:
#   PARENT    Parent ID (e.g. 0001) to get next sub-task ID
#
# Options:
#   --dir DIR   Todos directory (default: ./todos)
#
# Output (stdout):
#   Next available ID (e.g. "0005" or "0001.3")
#
# Examples:
#   todo-next-id.sh              # → 0005 (next top-level)
#   todo-next-id.sh 0001         # → 0001.4 (next sub-task)
#   todo-next-id.sh --dir /path  # custom directory

set -euo pipefail

dir="./todos"
parent=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) dir="$2"; shift 2 ;;
    *)     parent="$1"; shift ;;
  esac
done

if [[ ! -d "$dir" ]]; then
  # No directory yet — start at 0001 (or PARENT.1)
  if [[ -n "$parent" ]]; then
    echo "${parent}.1"
  else
    echo "0001"
  fi
  exit 0
fi

if [[ -n "$parent" ]]; then
  # Sub-task: find highest PARENT.N and increment
  last=$(find "$dir" -maxdepth 1 -name "${parent}.[0-9]*-*.md" \
    | sed -E "s|.*/[0-9]+\.([0-9]+)-.*|\1|" \
    | sort -n | tail -1 || true)
  next=$(( ${last:-0} + 1 ))
  echo "${parent}.${next}"
else
  # Top-level: find highest NNNN and increment
  last=$(find "$dir" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]-*.md' \
    | sed -E 's|.*/([0-9]{4})-.*|\1|' \
    | sort -n | tail -1 || true)
  next=$(( 10#${last:-0} + 1 ))
  printf "%04d\n" "$next"
fi
