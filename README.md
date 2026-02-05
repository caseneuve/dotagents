# dotagents

Personal agent configuration. The repo keeps the original Claude-oriented setup under `claude/`, a Codex-friendly port under `agents/`, and shared helper implementations under `shared/`.

## Contents

```text
claude/   # Original ~/.claude tree
agents/   # Ported ~/.agents tree
shared/   # Shared hooks and helper scripts used by both
```

The `agents/` tree includes:

- `AGENTS.md`
- `hooks/smart-lint.sh`
- `skills/` with ports of all repo skills

The `shared/` tree holds the common helper scripts and hooks so both platforms use one implementation.

## Installation

```bash
./bootstrap.sh
```

- `bootstrap.sh --claude` symlinks the Claude setup into `~/.claude/`
- `bootstrap.sh --agents` installs the agent setup into `~/.agents/` and links `~/.codex/AGENTS.md`
- `bootstrap.sh` defaults to `--all`
- both accept `--force` to overwrite existing non-symlink files

Both scripts preserve directory structure, skip already-correct links, replace stale symlinks, and avoid overwriting regular files unless forced.

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

| Skill | Claude tree | Agents tree |
|-------|-------------|-------------|
| add-todo | Yes | Yes |
| code-review | Yes | Yes |
| journal | Yes | Yes |
| org-journal | Yes | Yes |
| pk-tmux | Yes | Yes |
| project-init | `CLAUDE.md` | `AGENTS.md` |
| sandbox | Yes | Yes |

See [claude/skills/README.md](claude/skills/README.md) and [agents/skills/README.md](agents/skills/README.md).
