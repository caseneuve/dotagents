#!/usr/bin/env bash

# Statusline for Claude Code

input=$(cat)
cwd=$(echo "$input" | jq -r '.workspace.current_dir')
model=$(echo "$input" | jq -r '.model.display_name // .model.id // empty')
model="${model##*claude-}"
cost=$(printf '%.2f' "$(echo "$input" | jq -r '.cost.total_cost_usd // 0')")

# Colors
RST='\033[0m'
DIM='\033[2m'
BLUE='\033[34m'
GREEN='\033[32m'
MAGENTA='\033[35m'
CYAN='\033[36m'
YELLOW='\033[33m'
ORANGE='\033[38;5;208m'
RED='\033[31m'

cd "$cwd" 2>/dev/null || true

parts=()
parts+=("${BLUE}pwd${DIM}:${RST} ${cwd/#$HOME/\~}")

# Venv
if [[ -n "$VIRTUAL_ENV" ]]; then
    venv_name="${VIRTUAL_ENV##*/}"
    py_ver=$(python -c "import sys; print(sys.version.split()[0])" 2>/dev/null)
    parts+=("${YELLOW}venv${DIM}:${RST} ${venv_name} (${py_ver})")
fi

# Cost
parts+=("${RED}cost${DIM}:${RST} \$${cost}")

# Context window usage
ctx_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
if [[ -n "$ctx_pct" ]]; then
    if (( ctx_pct >= 80 )); then
        ctx_color="$RED"
    elif (( ctx_pct >= 50 )); then
        ctx_color="$YELLOW"
    else
        ctx_color="$CYAN"
    fi
    ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
    if [[ -n "$ctx_size" ]] && (( ctx_size >= 1000000 )); then
        ctx_label="$(( ctx_size / 1000000 ))M"
    elif [[ -n "$ctx_size" ]]; then
        ctx_label="$(( ctx_size / 1000 ))k"
    else
        ctx_label=""
    fi
    ctx_text="${ctx_pct}%"
    [[ -n "$ctx_label" ]] && ctx_text+=" ${DIM}/${RST} ${ctx_label}"
    parts+=("${ctx_color}ctx${DIM}:${RST} ${ctx_text}")
fi

# VCS: jj first (colocated repos have both .git and .jj)
if jj root &>/dev/null; then
    bookmarks=$(jj log --no-graph -r @ -T 'bookmarks' 2>/dev/null)
    change=$(jj log --no-graph -r @ -T 'change_id.shortest(8)' 2>/dev/null)
    desc=$(jj log --no-graph -r @ -T 'description.first_line()' 2>/dev/null)
    jj_part="${MAGENTA}jj${DIM}:${RST} ${change}"
    [[ -n "$bookmarks" ]] && jj_part+=" (${bookmarks})"
    [[ -n "$desc" ]] && jj_part+=" \"${desc}\""
    parts+=("$jj_part")

elif git rev-parse --show-toplevel &>/dev/null; then
    branch=$(git branch --show-current 2>/dev/null)
    [[ -z "$branch" ]] && branch="detached"
    git_part="${GREEN}git${DIM}:${RST} ${branch}"

    git_dir=$(git rev-parse --git-dir 2>/dev/null)
    if [[ "$git_dir" == *".git/worktrees/"* ]]; then
        git_part+=" [worktree]"
    fi

    parts+=("$git_part")
fi

# Model
[[ -n "$model" ]] && parts+=("${ORANGE}model${DIM}:${RST} ${model}")

# Join with dim " | "
sep=" ${DIM}|${RST} "
result=""
for i in "${!parts[@]}"; do
    (( i > 0 )) && result+="$sep"
    result+="${parts[$i]}"
done
printf '%b' "$result"
