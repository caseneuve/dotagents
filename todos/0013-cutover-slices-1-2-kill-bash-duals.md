---
title: cutover slices 1+2 to babashka and kill bash duals
status: done
priority: medium
type: chore
labels: [cleanup]
created: 2026-04-15
parent: null
blocked-by: []
blocks: []
---

## Context

Slices 1 (add-todo) and 2 (pk-tmux) already have complete Babashka
implementations (`todo/core.clj` + `todo/cli.clj`, `tmux_agent/core.clj` +
`tmux_agent/cli.clj`) with unit tests. But the skill docs still point agents
at the `.sh` wrappers, and the bash scripts still exist as parallel
implementations. This creates confusion — two code paths for the same behavior.

## Acceptance Criteria

### Slice 1: add-todo

- [x] Update `agents/skills/add-todo/SKILL.md` to reference `todo list`,
      `todo new`, `todo next-id`, `todo status` (bb subcommands) instead of
      `todo-list.sh`, `todo-new.sh`, etc.
- [x] Update `claude/skills/add-todo/SKILL.md` in parallel
- [x] Add `todo` entry to bootstrap symlink installation
      (`~/.local/bin/todo` → `shared/skills/add-todo/src/todo/cli.clj`)
- [x] Verify the cli.clj `#!/usr/bin/env bb` shebang and `dispatch` table
      match all subcommands the `.sh` scripts expose
- [x] Delete `todo-list.sh`, `todo-new.sh`, `todo-next-id.sh`, `todo-status.sh`
- [x] Run `bb test` — all existing tests pass

### Slice 2: pk-tmux

- [x] Update `agents/skills/pk-tmux/SKILL.md` to reference `tmux-agent run`,
      `tmux-agent create`, `tmux-agent status`, `tmux-agent wait` instead of
      `tmux-run.sh`, `tmux-create.sh`, etc.
- [x] Update `claude/skills/pk-tmux/SKILL.md` in parallel
- [x] Add `tmux-agent` entry to bootstrap symlink installation
      (`~/.local/bin/tmux-agent` → `shared/skills/pk-tmux/src/tmux_agent/cli.clj`)
- [x] Consider wiring `mux-bb` as dep for session derivation (currently
      `tmux_agent/core.clj` has its own md5/session logic that duplicates
      `mux.tmux/derive-session-info`) — may defer to avoid scope creep
- [x] Delete `tmux-create.sh`, `tmux-run.sh`, `tmux-status.sh`, `tmux-wait.sh`
- [x] Run `bb test` — all existing tests pass

### Bootstrap integration

- [x] Update `scripts/bootstrap.clj` to install symlinks for `todo` and
      `tmux-agent` to `~/.local/bin/`
- [ ] On `--force`, remove stale `.sh` symlinks if they exist
- [x] Update any `settings-permissions.json` entries that reference `.sh` paths

### Verification

- [x] After cutover, run each subcommand manually to verify parity:
      `todo list`, `todo new --type chore --slug test`, `todo status 0001 open`
      `tmux-agent status`, `tmux-agent create`
- [x] `bb test` passes (unit + E2E)

## Affected Files

- `agents/skills/add-todo/SKILL.md`
- `claude/skills/add-todo/SKILL.md`
- `agents/skills/pk-tmux/SKILL.md`
- `claude/skills/pk-tmux/SKILL.md`
- `scripts/bootstrap.clj`
- `shared/skills/add-todo/todo-*.sh` (4 files, delete)
- `shared/skills/pk-tmux/tmux-*.sh` (4 files, delete)

## Notes

- Keep this separate from the sandbox rewrite (0012) — these are already
  implemented and just need wiring + cleanup.
- Check `cli/dispatch` table completeness against what the bash scripts
  accept — the bb versions may have stricter validation which is fine,
  but shouldn't silently drop supported flags.
- The `tmux_agent/core.clj` md5/session derivation overlap with mux-bb
  is noted but not blocking — can be unified later when sandbox (0012)
  brings mux-bb into the dotagents dependency tree anyway.
