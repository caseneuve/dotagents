#!/usr/bin/env bash
# sandbox-create.sh - Create an isolated worktree for ticket development
# Usage: sandbox-create.sh <ticket-num>
#
# Creates a git worktree at ~/.cache/agentbox/worktrees/<project>-<ticket>,
# copies platform config from the main repo, and initializes submodules.
# If the worktree already exists, reports its path without recreating.
#
# Output (parse these):
#   MainRepo: <path>
#   Worktree: <path>
#   Branch: agentbox/<project>-<ticket>
#   BaseBranch: <branch-worktree-was-created-from>
#   Status: created|exists
#   Submodules: yes|no
#   Ticket: <path-to-todo-file>

set -euo pipefail

TICKET_NUM="${1:-}"
if [[ -z "$TICKET_NUM" ]]; then
    echo "Usage: sandbox-create.sh <ticket-num>" >&2
    exit 1
fi

# Normalize: strip leading # and leading zeros (e.g., "#00016" -> "16")
TICKET_NUM="${TICKET_NUM#\#}"
BARE_NUM=$(echo "$TICKET_NUM" | sed 's/^0*//')
BARE_NUM="${BARE_NUM:-0}"

MAIN_REPO=$(git rev-parse --show-toplevel)
PROJECT_NAME=$(basename "$MAIN_REPO")
BASE_BRANCH=$(git symbolic-ref --short HEAD)

detect_config_dir() {
    if [[ -n "${AGENT_CONFIG_DIR_NAME:-}" ]]; then
        echo "$AGENT_CONFIG_DIR_NAME"
    elif [[ "${BASH_SOURCE[0]}" == *"/.claude/"* || "${BASH_SOURCE[0]}" == *"/claude/"* ]]; then
        echo ".claude"
    else
        echo ".agents"
    fi
}

# Validate ticket exists (match with optional leading zeros)
TICKET_FILE=$(find "${MAIN_REPO}/todos" -maxdepth 1 -name "0*${BARE_NUM}-*.md" 2>/dev/null | head -1)
if [[ -z "$TICKET_FILE" ]]; then
    # Fallback: try exact match for non-numeric prefixes
    TICKET_FILE=$(find "${MAIN_REPO}/todos" -maxdepth 1 -name "${TICKET_NUM}-*.md" 2>/dev/null | head -1)
fi
if [[ -z "$TICKET_FILE" ]]; then
    echo "ERROR: No ticket matching todos/*${BARE_NUM}-*.md found" >&2
    exit 1
fi

# Use the actual filename prefix for consistent naming
TICKET_PREFIX=$(basename "$TICKET_FILE" | sed 's/-.*//')
WORKTREE_NAME="${PROJECT_NAME}-${TICKET_PREFIX}"
WORKTREE_PATH="$HOME/.cache/agentbox/worktrees/${WORKTREE_NAME}"
BRANCH="agentbox/${PROJECT_NAME}-${TICKET_PREFIX}"

# Check if worktree already exists
if [[ -d "$WORKTREE_PATH" ]]; then
    HAS_SUBMODULES="no"
    [[ -f "${WORKTREE_PATH}/.gitmodules" ]] && HAS_SUBMODULES="yes"

    echo "MainRepo: $MAIN_REPO"
    echo "Worktree: $WORKTREE_PATH"
    echo "Branch: $BRANCH"
    echo "BaseBranch: $BASE_BRANCH"
    echo "Status: exists"
    echo "Submodules: $HAS_SUBMODULES"
    echo "Ticket: $TICKET_FILE"
    exit 0
fi

# Create worktree
mkdir -p "$HOME/.cache/agentbox/worktrees"
git worktree add "$WORKTREE_PATH" -b "$BRANCH" "$BASE_BRANCH"

# Symlink untracked agent config contents from the main repo into the worktree.
# Tracked files already appear in worktrees; untracked ones (settings.local.json, etc.) do not.
CONFIG_DIR_NAME="$(detect_config_dir)"
if [[ -d "${MAIN_REPO}/${CONFIG_DIR_NAME}" ]]; then
    mkdir -p "${WORKTREE_PATH}/${CONFIG_DIR_NAME}"
    for item in "${MAIN_REPO}/${CONFIG_DIR_NAME}"/*; do
        name=$(basename "$item")
        target="${WORKTREE_PATH}/${CONFIG_DIR_NAME}/${name}"
        # Only symlink if the item is untracked and doesn't already exist in worktree
        if [[ -z "$(git -C "${MAIN_REPO}" ls-files "${CONFIG_DIR_NAME}/${name}")" ]] && [[ ! -e "$target" ]]; then
            ln -s "$item" "$target"
        fi
    done
fi

# Initialize submodules if present
HAS_SUBMODULES="no"
if [[ -f "${WORKTREE_PATH}/.gitmodules" ]]; then
    HAS_SUBMODULES="yes"
    git -C "$WORKTREE_PATH" submodule update --init --recursive
fi

echo "MainRepo: $MAIN_REPO"
echo "Worktree: $WORKTREE_PATH"
echo "Branch: $BRANCH"
echo "BaseBranch: $BASE_BRANCH"
echo "Status: created"
echo "Submodules: $HAS_SUBMODULES"
echo "Ticket: $TICKET_FILE"
