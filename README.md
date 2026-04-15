# dotagents

![vibe: slopped](.github/badges/vibe-slopped.svg)

Personal agent configuration. The repo keeps the original Claude-oriented setup under `claude/`, a Codex-friendly port under `agents/`, shared helper implementations under `shared/`, and Pi extensions/themes under `pi/`.

## Contents

```text
claude/   # Original ~/.claude tree
agents/   # Ported ~/.agents tree
pi/       # Pi extensions and themes
shared/   # Shared hooks and helper scripts used by both
scripts/  # Repo-local Babashka scripts (e.g. bootstrap)
test/     # Unit and E2E tests
```

The `pi/` tree includes focused TUI extensions such as repo todo browsing, agent-journal browsing, and an assistant-response outline viewer for navigating long markdown answers.

The `agents/` tree includes:

- `AGENTS.md`
- `hooks/smart-lint.sh`
- `skills/` with ports of all repo skills

The `shared/` tree holds the common helper scripts and hooks so both platforms use one implementation.

## Installation

Run via the Babashka task:

```bash
bb bootstrap
```

Shortcut alias:

```bash
bb boot
```

Modes:

- `bb bootstrap claude` links the Claude setup into `~/.claude/` and merges Claude settings fragments into `~/.claude/settings.json`
- `bb bootstrap agents` installs the agent setup into `~/.agents/` and links `~/.codex/AGENTS.md`
- `bb bootstrap pi` writes Pi resource paths into `~/.pi/agent/settings.json` and sets the theme to `modus-operandi`
- `bb bootstrap` defaults to `all`
- all modes accept `--force` to overwrite existing non-symlink files
- all modes accept `--dry-run` to print planned changes without writing

Behavior:

- preserve directory structure where runtime install trees are still used
- skip already-correct links
- replace stale symlinks
- avoid overwriting regular files unless forced
- configure Pi via `~/.pi/agent/settings.json` instead of symlinking Pi extensions/themes

## Testing

Tests run in podman so they do not touch the host environment.

```bash
bb test
bb test:unit
bb test:e2e
```

E2E tests live in `test/e2e/cases.edn` and use the declarative `end2edn` authoring format:

- suites use `:cases`, not legacy `:tests`
- scenarios use `:when` / `:then`
- prefer `:given` / `:cleanup` fixtures over shell-heavy setup/teardown
- use `:given :vars` placeholders like `{home}` and `{work}` to keep paths readable
- prefer built-in `:fs-layout` assertions for filesystem and JSON layout checks

When adding or refactoring E2E coverage, follow the existing style in `test/e2e/cases.edn`: keep repeated roots in vars, push setup into fixtures, and avoid custom assertions unless the built-in API is genuinely insufficient.

## Port Assessment

The Claude skills were mostly portable because their real behavior lives in shell and Babashka helper scripts. The main incompatibilities were:

- Claude-specific frontmatter fields such as `triggers` and `allowedPrompts`
- slash-command phrasing like `/sandbox` and `/code-review`
- references to Claude-specific APIs such as `AskUserQuestion`, `SendMessage`, and team control commands
- hard-coded paths under `~/.claude`, `.claude`, `/tmp/claude-*`, and the old per-agent journal roots such as `~/org/claude`
- the `project-init` skill targeting `CLAUDE.md` instead of `AGENTS.md`

The `agents/` port removes or rewrites those assumptions while preserving the existing helper scripts and workflows. The shared org-journal helpers now write to `~/org/agent-journal/` for every agent and record the writing agent in each entry.

To reduce maintenance overhead, the helper scripts and hooks now live once under `shared/` and the bootstrap assembles the final `~/.claude` and `~/.agents` layouts from platform-specific docs plus shared executables.

## Skills

| Skill        | Claude tree | Agents tree |
| ------------ | ----------- | ----------- |
| add-todo     | Yes         | Yes         |
| code-review  | Yes         | Yes         |
| journal      | Yes         | Yes         |
| org-journal  | Yes         | Yes         |
| pk-tmux      | Yes         | Yes         |
| project-init | `CLAUDE.md` | `AGENTS.md` |
| sandbox      | Yes         | Yes         |

See [claude/skills/README.md](claude/skills/README.md) and [agents/skills/README.md](agents/skills/README.md).
