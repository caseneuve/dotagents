#!/usr/bin/env bash
# todo-list.sh — List todos with optional filtering
#
# Usage:
#   todo-list.sh [OPTIONS]
#
# Options:
#   --status STATUS   Filter by status (open|in_progress|closed|blocked)
#   --type TYPE       Filter by type (feature|bug|refactor|chore)
#   --priority PRI    Filter by priority (high|medium|low)
#   --parent PARENT   Show only sub-tasks of PARENT (e.g. 0001)
#   --dir DIR         Todos directory (default: ./todos)
#
# Output (stdout):
#   One line per todo: ID | STATUS | PRIORITY | TYPE | TITLE
#
# Examples:
#   todo-list.sh                        # all todos
#   todo-list.sh --status open          # only open
#   todo-list.sh --type bug --status open  # open bugs

set -euo pipefail

dir="./todos"
filter_status=""
filter_type=""
filter_priority=""
filter_parent=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --status)   filter_status="$2"; shift 2 ;;
    --type)     filter_type="$2"; shift 2 ;;
    --priority) filter_priority="$2"; shift 2 ;;
    --parent)   filter_parent="$2"; shift 2 ;;
    --dir)      dir="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -d "$dir" ]]; then
  echo "No todos directory found at: ${dir}" >&2
  exit 0
fi

# Extract frontmatter field value
extract_field() {
  local file="$1" field="$2"
  sed -n "/^---$/,/^---$/{ s/^${field}: *//p; }" "$file" | head -1
}

# Collect and filter
count=0
for file in "$dir"/[0-9]*-*.md; do
  [[ -f "$file" ]] || continue

  id=$(basename "$file" .md | sed 's/-.*//')
  status=$(extract_field "$file" "status")
  type=$(extract_field "$file" "type")
  priority=$(extract_field "$file" "priority")
  title=$(extract_field "$file" "title")
  parent=$(extract_field "$file" "parent")

  # Apply filters
  if [[ -n "$filter_status" && "$status" != "$filter_status" ]]; then continue; fi
  if [[ -n "$filter_type" && "$type" != "$filter_type" ]]; then continue; fi
  if [[ -n "$filter_priority" && "$priority" != "$filter_priority" ]]; then continue; fi
  if [[ -n "$filter_parent" && "$parent" != "$filter_parent" ]]; then continue; fi

  printf "%-8s | %-11s | %-6s | %-8s | %s\n" "$id" "$status" "$priority" "$type" "$title"
  (( ++count ))
done

echo "${count} todo(s) found" >&2
