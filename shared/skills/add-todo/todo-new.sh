#!/usr/bin/env bash
# todo-new.sh — Create a new todo from template
#
# Usage:
#   todo-new.sh --type TYPE --slug SLUG [OPTIONS]
#
# Required:
#   --type TYPE     feature | bug | refactor | chore
#   --slug SLUG     Kebab-case slug for filename
#
# Options:
#   --title TITLE       Human-readable title (default: slug with dashes→spaces)
#   --priority PRIORITY high | medium | low (default: medium)
#   --parent PARENT     Parent ID for sub-tasks (e.g. 0001)
#   --labels LABELS     Comma-separated labels (e.g. MVP,NEXT_VER)
#   --dir DIR           Todos directory (default: ./todos)
#
# Output (stdout):
#   filepath=./todos/0005-my-slug.md
#   id=0005
#
# The created file uses the standard frontmatter template.
# E2E Spec section is included for feature/bug, omitted for refactor/chore.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

dir="./todos"
type=""
slug=""
title=""
priority="medium"
parent=""
labels_input=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --type)     type="$2"; shift 2 ;;
    --slug)     slug="$2"; shift 2 ;;
    --title)    title="$2"; shift 2 ;;
    --priority) priority="$2"; shift 2 ;;
    --parent)   parent="$2"; shift 2 ;;
    --labels)   labels_input="$2"; shift 2 ;;
    --dir)      dir="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Validate required args
if [[ -z "$type" ]]; then
  echo "error: --type is required (feature|bug|refactor|chore)" >&2
  exit 1
fi
if [[ -z "$slug" ]]; then
  echo "error: --slug is required" >&2
  exit 1
fi

case "$type" in
  feature|bug|refactor|chore) ;;
  *) echo "error: --type must be feature|bug|refactor|chore" >&2; exit 1 ;;
esac

case "$priority" in
  high|medium|low) ;;
  *) echo "error: --priority must be high|medium|low" >&2; exit 1 ;;
esac

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf "%s" "$value"
}

normalize_labels_field() {
  local input="$1"
  local cleaned
  cleaned=$(trim "$input")

  if [[ -z "$cleaned" ]]; then
    echo "[]"
    return
  fi

  local -a raw_parts normalized=()
  IFS=',' read -r -a raw_parts <<< "$cleaned"

  declare -A seen=()
  local raw label
  for raw in "${raw_parts[@]}"; do
    label=$(trim "$raw")
    [[ -z "$label" ]] && continue

    if [[ ! "$label" =~ ^[A-Za-z0-9._-]+$ ]]; then
      echo "error: invalid label '$label' (allowed: letters, digits, ., _, -)" >&2
      exit 1
    fi

    if [[ -n "${seen[$label]:-}" ]]; then
      continue
    fi

    seen[$label]=1
    normalized+=("$label")
  done

  if [[ ${#normalized[@]} -eq 0 ]]; then
    echo "[]"
    return
  fi

  local rendered="["
  local i
  for ((i = 0; i < ${#normalized[@]}; i++)); do
    if [[ $i -gt 0 ]]; then
      rendered+=", "
    fi
    rendered+="${normalized[$i]}"
  done
  rendered+="]"
  echo "$rendered"
}

# Default title from slug
if [[ -z "$title" ]]; then
  title="${slug//-/ }"
fi

# Get next ID
mkdir -p "$dir"
if [[ -n "$parent" ]]; then
  id=$("$SCRIPT_DIR/todo-next-id.sh" --dir "$dir" "$parent")
else
  id=$("$SCRIPT_DIR/todo-next-id.sh" --dir "$dir")
fi

filename="${id}-${slug}.md"
filepath="${dir}/${filename}"
today=$(date +%Y-%m-%d)

# Parent field
parent_field="null"
if [[ -n "$parent" ]]; then
  parent_field="$parent"
fi

labels_field=$(normalize_labels_field "$labels_input")

# Build E2E section
e2e_section=""
if [[ "$type" == "feature" || "$type" == "bug" ]]; then
  e2e_section="
## E2E Spec

GIVEN ...
WHEN ...
THEN ...
"
fi

cat > "$filepath" <<EOF
---
title: ${title}
status: open
priority: ${priority}
type: ${type}
labels: ${labels_field}
created: ${today}
parent: ${parent_field}
blocked-by: []
blocks: []
---

## Context

[Why this matters. What's broken or missing.]

## Acceptance Criteria

- [ ] [Concrete, testable outcome 1]
- [ ] [Concrete, testable outcome 2]

## Affected Files

- \`src/...\` — what changes here
- \`test/...\` — what to test
${e2e_section}
## Notes

[Constraints, gotchas, related issues.]
EOF

echo "filepath=${filepath}"
echo "id=${id}"
echo "Created: ${filepath}" >&2
