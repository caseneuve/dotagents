#!/usr/bin/env bash

# review-file.sh - Manage code review files for inter-agent communication
# Usage: review-file.sh <command> [--branch <branch>]
#
# Commands:
#   create   Print a new review file path (creates directory, generates timestamped name)
#   latest   Print the path to the most recent review for the branch
#   list     List all review files for the branch
#
# Options:
#   --branch <branch>   Override branch detection (default: current git branch)
#
# Review files live in .reviews/{branch}-{timestamp}.md in the project root.

set -euo pipefail

BRANCH=""

usage() {
    sed -n '3,13p' "$0" | sed 's/^# \?//'
    exit 1
}

sanitize() {
    echo "$1" | tr '/' '-'
}

get_prefix() {
    if [[ -n "$BRANCH" ]]; then
        echo "$BRANCH"
        return
    fi
    # In agentbox worktrees, use the worktree directory name (e.g. "project-ticket")
    # instead of the branch name (e.g. "agentbox/ticket")
    local root
    root=$(git rev-parse --show-toplevel 2>/dev/null) || root="."
    if [[ "$root" == *agentbox/worktrees/* ]]; then
        basename "$root"
        return
    fi
    git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown"
}

get_reviews_dir() {
    local root
    root=$(git rev-parse --show-toplevel 2>/dev/null) || root="."
    echo "$root/.reviews"
}

# Parse arguments
COMMAND=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        create|latest|list) COMMAND="$1"; shift ;;
        --branch) BRANCH="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) echo "Unknown argument: $1" >&2; usage ;;
    esac
done

[[ -z "$COMMAND" ]] && usage

REVIEWS_DIR=$(get_reviews_dir)
SAFE_BRANCH=$(sanitize "$(get_prefix)")

case "$COMMAND" in
    create)
        mkdir -p "$REVIEWS_DIR"
        TIMESTAMP=$(date +%Y-%m-%d-%H%M%S)
        echo "$REVIEWS_DIR/${SAFE_BRANCH}-${TIMESTAMP}.md"
        ;;

    latest)
        if [[ ! -d "$REVIEWS_DIR" ]]; then
            echo "No .reviews directory found" >&2
            exit 1
        fi
        LATEST=$(ls -t "$REVIEWS_DIR/${SAFE_BRANCH}"-*.md 2>/dev/null | head -1 || true)
        if [[ -z "$LATEST" ]]; then
            echo "No reviews found for branch: $SAFE_BRANCH" >&2
            exit 1
        fi
        echo "$LATEST"
        ;;

    list)
        if [[ ! -d "$REVIEWS_DIR" ]]; then
            echo "No .reviews directory found" >&2
            exit 1
        fi
        ls -t "$REVIEWS_DIR/${SAFE_BRANCH}"-*.md 2>/dev/null || {
            echo "No reviews found for branch: $SAFE_BRANCH" >&2
            exit 1
        }
        ;;
esac
