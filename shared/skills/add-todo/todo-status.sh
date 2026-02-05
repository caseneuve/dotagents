#!/usr/bin/env bash
# todo-status.sh — Update the status of a todo
#
# Usage:
#   todo-status.sh ID STATUS [--dir DIR]
#
# Arguments:
#   ID      Todo ID (e.g. 0001 or 0001.2)
#   STATUS  New status: open | in_progress | closed | blocked
#
# Options:
#   --dir DIR   Todos directory (default: ./todos)
#
# Output (stdout):
#   filepath=./todos/0001-slug.md
#   old_status=open
#   new_status=in_progress

set -euo pipefail

dir="./todos"
id=""
new_status=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) dir="$2"; shift 2 ;;
    *)
      if [[ -z "$id" ]]; then
        id="$1"
      elif [[ -z "$new_status" ]]; then
        new_status="$1"
      else
        echo "error: unexpected argument: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$id" || -z "$new_status" ]]; then
  echo "error: usage: todo-status.sh ID STATUS [--dir DIR]" >&2
  exit 1
fi

case "$new_status" in
  open|in_progress|closed|blocked) ;;
  *) echo "error: status must be open|in_progress|closed|blocked" >&2; exit 1 ;;
esac

# Find the file matching this ID
file=$(find "$dir" -maxdepth 1 -name "${id}-*.md" 2>/dev/null | head -1)
if [[ -z "$file" ]]; then
  echo "error: no todo found with ID ${id}" >&2
  exit 1
fi

# Extract old status
old_status=$(sed -n '/^---$/,/^---$/{ s/^status: *//p; }' "$file" | head -1)

# Update status in frontmatter
sed -i "s/^status: .*/status: ${new_status}/" "$file"

echo "filepath=${file}"
echo "old_status=${old_status}"
echo "new_status=${new_status}"
echo "Updated: ${file} (${old_status} → ${new_status})" >&2
