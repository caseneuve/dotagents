#!/bin/bash
set -euo pipefail

FORCE=false
MODE="all"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --force) FORCE=true; shift ;;
        --claude) MODE="claude"; shift ;;
        --agents) MODE="agents"; shift ;;
        --all) MODE="all"; shift ;;
        *)
            echo "Usage: $0 [--claude|--agents|--all] [--force]" >&2
            exit 1
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_SOURCE_DIR="$SCRIPT_DIR/claude"
AGENTS_SOURCE_DIR="$SCRIPT_DIR/agents"
SHARED_DIR="$SCRIPT_DIR/shared"

if [[ ! -d "$SHARED_DIR" ]]; then
    echo "Error: Shared source directory '$SHARED_DIR' does not exist" >&2
    exit 1
fi

ensure_dir() {
    local path="$1"

    if [[ -d "$path" ]]; then
        return 0
    fi

    if [[ -L "$path" ]]; then
        local link_target
        link_target="$(readlink "$path")"

        if [[ "$link_target" != /* ]]; then
            link_target="$(cd "$(dirname "$path")" && pwd)/$link_target"
        fi

        echo "Creating symlink target directory: $link_target"
        mkdir -p "$link_target"
        return 0
    fi

    echo "Creating directory: $path"
    mkdir -p "$path"
}

link_tree() {
    local source_dir="$1"
    local target_dir="$2"

    [[ -d "$source_dir" ]] || return 0

    find "$source_dir" -type f | while read -r file; do
        rel_path="${file#$source_dir/}"
        target_file="$target_dir/$rel_path"
        target_parent="$(dirname "$target_file")"

        ensure_dir "$target_parent"

        if [[ -L "$target_file" ]]; then
            existing_link="$(readlink "$target_file")"
            if [[ "$existing_link" == "$file" ]]; then
                echo "Already linked: $rel_path"
                continue
            else
                echo "Removing stale symlink: $target_file -> $existing_link"
                rm "$target_file"
            fi
        elif [[ -e "$target_file" ]]; then
            if [[ "$FORCE" == true ]]; then
                echo "Removing existing file (--force): $target_file"
                rm -rf "$target_file"
            else
                echo "Warning: $target_file exists and is not a symlink, skipping (use --force to overwrite)"
                continue
            fi
        fi

        echo "Linking: $rel_path"
        ln -s "$file" "$target_file"
    done
}

link_skill_tree() {
    local source_dir="$1"
    local target_root="$2"
    local materialize_markdown="${3:-false}"

    [[ -d "$source_dir" ]] || return 0

    find "$source_dir" -mindepth 2 -type f | while read -r file; do
        rel_path="${file#$source_dir/}"
        skill_name="${rel_path%%/*}"
        target_dir="$target_root/$skill_name"
        target_file="$target_root/$rel_path"
        target_parent="$(dirname "$target_file")"

        if [[ -L "$target_dir" ]]; then
            existing_link="$(readlink "$target_dir")"
            echo "Removing stale skill directory symlink: $target_dir -> $existing_link"
            rm "$target_dir"
        fi

        ensure_dir "$target_parent"

        if [[ -L "$target_file" ]]; then
            existing_link="$(readlink "$target_file")"
            if [[ "$materialize_markdown" != "true" && "$existing_link" == "$file" ]]; then
                echo "Already linked: $rel_path"
                continue
            else
                echo "Removing stale symlink: $target_file -> $existing_link"
                rm "$target_file"
            fi
        elif [[ -e "$target_file" ]]; then
            if [[ "$FORCE" == true ]]; then
                echo "Removing existing file (--force): $target_file"
                rm -rf "$target_file"
            else
                echo "Warning: $target_file exists and is not a symlink, skipping (use --force to overwrite)"
                continue
            fi
        fi

        if [[ "$materialize_markdown" == "true" && "$file" == *.md ]]; then
            echo "Copying: $rel_path"
            cp "$file" "$target_file"
        else
            echo "Linking: $rel_path"
            ln -s "$file" "$target_file"
        fi
    done
}

link_single_file() {
    local source_file="$1"
    local target_file="$2"

    [[ -f "$source_file" ]] || return 0

    ensure_dir "$(dirname "$target_file")"

    if [[ -L "$target_file" ]]; then
        existing_link="$(readlink "$target_file")"
        if [[ "$existing_link" != "$source_file" ]]; then
            echo "Removing stale symlink: $target_file -> $existing_link"
            rm "$target_file"
        fi
    elif [[ -e "$target_file" ]]; then
        if [[ "$FORCE" == true ]]; then
            echo "Removing existing file (--force): $target_file"
            rm -rf "$target_file"
        else
            echo "Warning: $target_file exists and is not a symlink, skipping (use --force to overwrite)"
            return 0
        fi
    fi

    if [[ ! -e "$target_file" ]]; then
        echo "Linking: $(basename "$target_file")"
        ln -s "$source_file" "$target_file"
    else
        echo "Already linked: $(basename "$target_file")"
    fi
}

merge_claude_settings() {
    local target_dir="$1"
    local hooks_config="$SCRIPT_DIR/settings-hooks.json"
    local perms_config="$SCRIPT_DIR/settings-permissions.json"
    local settings_file="$target_dir/settings.json"

    if [[ -f "$hooks_config" ]]; then
        if ! command -v jq &>/dev/null; then
            echo "Warning: jq not found, skipping hooks config merge"
        elif [[ -f "$settings_file" ]]; then
            echo "Merging hooks config into settings.json"
            resolved=$(jq --arg home "$HOME" '.hooks.PostToolUse[].hooks[].command |= gsub("\\$HOME"; $home)' "$hooks_config")
            jq -s '.[0] * .[1]' "$settings_file" <(echo "$resolved") > "$settings_file.tmp" \
                && mv "$settings_file.tmp" "$settings_file"
        else
            echo "Creating settings.json from hooks config"
            jq --arg home "$HOME" '.hooks.PostToolUse[].hooks[].command |= gsub("\\$HOME"; $home)' "$hooks_config" > "$settings_file"
        fi
    fi

    if [[ -f "$perms_config" ]]; then
        if ! command -v jq &>/dev/null; then
            echo "Warning: jq not found, skipping permissions config merge"
        else
            echo "Merging permissions config into settings.json"
            resolved=$(jq --arg home "$HOME" '(.permissions.allow // []) |= [.[] | gsub("\\$HOME"; $home)]' "$perms_config")
            if [[ -f "$settings_file" ]]; then
                jq -s '
                  (.[0].permissions.allow // []) as $existing |
                  (.[1].permissions.allow // []) as $new |
                  .[0] * .[1] | .permissions.allow = ($existing + $new | unique)
                ' "$settings_file" <(echo "$resolved") > "$settings_file.tmp" \
                    && mv "$settings_file.tmp" "$settings_file"
            else
                echo "$resolved" > "$settings_file"
            fi
        fi
    fi
}

bootstrap_claude() {
    local target_dir="$HOME/.claude"

    [[ -d "$CLAUDE_SOURCE_DIR" ]] || {
        echo "Error: Claude source directory '$CLAUDE_SOURCE_DIR' does not exist" >&2
        exit 1
    }

    echo "Bootstrapping Claude dotfiles..."
    echo "Sources:"
    echo "  - $CLAUDE_SOURCE_DIR"
    echo "  - $SHARED_DIR"
    echo "Target: $target_dir"
    [[ "$FORCE" == true ]] && echo "Force mode: enabled"
    echo

    link_tree "$CLAUDE_SOURCE_DIR" "$target_dir"
    link_tree "$SHARED_DIR" "$target_dir"
    merge_claude_settings "$target_dir"

    echo
    echo "Claude bootstrap done."
}

bootstrap_agents() {
    local agents_target_dir="$HOME/.agents"
    local codex_target_dir="$HOME/.codex"
    local agents_skills_target_dir="$agents_target_dir/skills"

    [[ -d "$AGENTS_SOURCE_DIR" ]] || {
        echo "Error: Agents source directory '$AGENTS_SOURCE_DIR' does not exist" >&2
        exit 1
    }

    echo "Bootstrapping agent dotfiles..."
    echo "Sources:"
    echo "  - $AGENTS_SOURCE_DIR"
    echo "  - $SHARED_DIR"
    echo "Targets:"
    echo "  - $agents_target_dir"
    echo "  - $codex_target_dir/AGENTS.md"
    [[ "$FORCE" == true ]] && echo "Force mode: enabled"
    echo

    link_single_file "$AGENTS_SOURCE_DIR/AGENTS.md" "$agents_target_dir/AGENTS.md"
    link_tree "$AGENTS_SOURCE_DIR/hooks" "$agents_target_dir/hooks"
    mkdir -p "$agents_skills_target_dir"
    link_skill_tree "$AGENTS_SOURCE_DIR/skills" "$agents_skills_target_dir" true
    link_skill_tree "$SHARED_DIR/skills" "$agents_skills_target_dir"
    link_tree "$SHARED_DIR/hooks" "$agents_target_dir/hooks"

    link_single_file "$AGENTS_SOURCE_DIR/AGENTS.md" "$codex_target_dir/AGENTS.md"

    echo
    echo "Agent bootstrap done."
}

case "$MODE" in
    claude)
        bootstrap_claude
        ;;
    agents)
        bootstrap_agents
        ;;
    all)
        bootstrap_claude
        echo
        bootstrap_agents
        ;;
esac

echo
echo "Done!"
