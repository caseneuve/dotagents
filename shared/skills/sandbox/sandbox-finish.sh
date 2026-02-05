#!/usr/bin/env bash
# sandbox-finish.sh - Merge worktree branch and clean up
# Usage: sandbox-finish.sh <ticket-num> [--diff-only]
#
# Without flags: squash-merges the branch into the current branch, removes worktree and branch.
# With --diff-only: only shows the diff (for review before merging).
#
# Must be run from the main repo (not from inside the worktree).

set -euo pipefail

TICKET_NUM="${1:-}"
DIFF_ONLY=false
if [[ "${2:-}" == "--diff-only" ]]; then
    DIFF_ONLY=true
fi

if [[ -z "$TICKET_NUM" ]]; then
    echo "Usage: sandbox-finish.sh <ticket-num> [--diff-only]" >&2
    exit 1
fi

# Normalize: strip leading # and leading zeros (e.g., "#00016" -> "16")
TICKET_NUM="${TICKET_NUM#\#}"
BARE_NUM=$(echo "$TICKET_NUM" | sed 's/^0*//')
BARE_NUM="${BARE_NUM:-0}"

MAIN_REPO=$(git rev-parse --show-toplevel)
PROJECT_NAME=$(basename "$MAIN_REPO")

# Resolve canonical ticket prefix from the actual todo file
TICKET_FILE=$(find "${MAIN_REPO}/todos" -maxdepth 1 -name "0*${BARE_NUM}-*.md" 2>/dev/null | head -1)
if [[ -z "$TICKET_FILE" ]]; then
    TICKET_FILE=$(find "${MAIN_REPO}/todos" -maxdepth 1 -name "${TICKET_NUM}-*.md" 2>/dev/null | head -1)
fi
if [[ -n "$TICKET_FILE" ]]; then
    TICKET_PREFIX=$(basename "$TICKET_FILE" | sed 's/-.*//')
else
    # No ticket file found — fall back to input as-is (branch may still exist)
    TICKET_PREFIX="$TICKET_NUM"
fi

WORKTREE_NAME="${PROJECT_NAME}-${TICKET_PREFIX}"
WORKTREE_PATH="$HOME/.cache/agentbox/worktrees/${WORKTREE_NAME}"
BRANCH="agentbox/${PROJECT_NAME}-${TICKET_PREFIX}"

# Verify branch exists
if ! git rev-parse --verify "$BRANCH" &>/dev/null; then
    echo "ERROR: Branch '$BRANCH' not found" >&2
    exit 1
fi

# Detect the base branch (the branch we're currently on in the main repo)
BASE_BRANCH=$(git symbolic-ref --short HEAD)

if [[ "$DIFF_ONLY" == true ]]; then
    echo "=== Changes in $BRANCH (relative to $BASE_BRANCH) ==="
    git diff "${BASE_BRANCH}...$BRANCH"
    echo ""
    echo "=== Commits ==="
    git log --oneline "${BASE_BRANCH}..$BRANCH"
    exit 0
fi

# Verify we're in the main repo, not the worktree
CURRENT_TOP=$(git rev-parse --show-toplevel)
if [[ "$CURRENT_TOP" == "$WORKTREE_PATH" ]]; then
    echo "ERROR: Run this from the main repo, not from inside the worktree" >&2
    echo "Main repo: $MAIN_REPO" >&2
    exit 1
fi

# Squash merge
if git diff --quiet "${BASE_BRANCH}...$BRANCH"; then
    echo "No changes to merge — branch is identical to ${BASE_BRANCH}" >&2
    echo "Cleaning up worktree and branch only."
else
    git merge --squash "$BRANCH"
    git commit -m "[sandbox] merge ticket ${TICKET_NUM}"
    echo "Merged: $BRANCH -> ${BASE_BRANCH} (squash)"
fi

# Clean up worktree and branch
if [[ -d "$WORKTREE_PATH" ]]; then
    git worktree remove --force "$WORKTREE_PATH" 2>/dev/null || rm -rf "$WORKTREE_PATH"
    git worktree prune
fi
git branch -D "$BRANCH"

echo "Removed: worktree $WORKTREE_PATH"
echo "Removed: branch $BRANCH"
