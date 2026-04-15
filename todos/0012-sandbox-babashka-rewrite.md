---
title: sandbox babashka rewrite with cmux awareness
status: open
priority: high
type: feature
labels: [macos, mux-bb]
created: 2026-04-15
parent: null
blocked-by: []
blocks: []
---

## Context

The sandbox skill (`shared/skills/sandbox/`) currently has two bash scripts
(`sandbox-create.sh`, `sandbox-finish.sh`) with zero macOS/cmux awareness.
After creating a git worktree, the agent just `cd`s into it — no new cmux
workspace is opened, no notification is sent.

The `mux-bb` library (`~/git/mux-bb/`) now provides the cmux integration
layer: `mux.protocol/detect-mux` detects cmux vs tmux from env,
`mux.cmux/build-cmux-args :new-workspace` builds the CLI args to open a
workspace, and `mux.cmux/make-backend` handles the full lifecycle.

## Acceptance Criteria

### sandbox/core.clj (pure)

- [ ] `normalize-ticket` strips `#` prefix and leading zeros (port from bash)
- [ ] `resolve-ticket-file` matches ticket number against todos dir filenames
      (numeric prefix match with optional zero-padding)
- [ ] `worktree-path` derives path from home, project name, and ticket prefix
      (`~/.cache/agentbox/worktrees/<project>-<ticket>`)
- [ ] `branch-name` derives branch from project and ticket prefix
      (`agentbox/<project>-<ticket>`)
- [ ] `detect-config-dir` returns `.claude` or `.agents` based on context
- [ ] `untracked-config-items` identifies files to symlink into worktree
      (untracked items from config dir)
- [ ] `build-finish-plan` produces a plan map: diff-only, squash-merge, or
      clean-up-only (when no changes)
- [ ] `validate-finish-preconditions` checks for uncommitted changes in
      worktree, correct cwd (not inside worktree), branch existence

### sandbox/cli.clj (I/O boundary)

- [ ] `sandbox create <ticket-num>` subcommand:
      - resolves ticket, creates worktree via git, symlinks config,
        initializes submodules
      - detects cmux via `mux.protocol/detect-mux` from env
      - when cmux: opens new workspace via `mux.cmux`, restores focus to
        original workspace, sends notification
      - prints structured output (MainRepo, Worktree, Branch, BaseBranch,
        Status, Submodules, Ticket)
- [ ] `sandbox finish <ticket-num> [--diff-only]` subcommand:
      - validates preconditions (not in worktree, no uncommitted changes,
        branch exists)
      - `--diff-only`: shows diff and commits, exits
      - default: squash-merges branch, removes worktree, deletes branch

### Dependencies

- [ ] Wire `mux-bb` as a local dep in dotagents `bb.edn`:
      `{:deps {mux-bb/mux-bb {:local/root "../mux-bb"}}}`
- [ ] Use `babashka.fs` for all path operations (path, glob, exists?,
      directory?, create-dirs, create-sym-link, home, which)
- [ ] Use `babashka.cli/dispatch` for subcommand routing
- [ ] Use `babashka.process` `:dir` option for git commands in worktree

### Tests

- [ ] Unit tests for all pure functions in core.clj
      (ticket normalization, path derivation, plan building, validation)
- [ ] Edge cases: ticket with `#` prefix, leading zeros, slash in project
      name, missing ticket file, worktree already exists
- [ ] E2E tests in podman: create worktree, verify structure, finish
      (tmux-only — cmux can't run in container)

### Cutover

- [ ] Update agents/skills/sandbox/SKILL.md to reference `sandbox create`
      and `sandbox finish` instead of `.sh` scripts
- [ ] Update claude/skills/sandbox/SKILL.md in parallel
- [ ] Delete `sandbox-create.sh` and `sandbox-finish.sh`
- [ ] Update bootstrap to install `sandbox` symlink to `~/.local/bin/`

## Affected Files

- `shared/skills/sandbox/src/sandbox/core.clj` (new)
- `shared/skills/sandbox/src/sandbox/cli.clj` (new)
- `shared/skills/sandbox/test/sandbox/core_test.clj` (new)
- `shared/skills/sandbox/bb.edn` (new)
- `bb.edn` (add mux-bb dep, add sandbox to test paths)
- `agents/skills/sandbox/SKILL.md`
- `claude/skills/sandbox/SKILL.md`
- `shared/skills/sandbox/sandbox-create.sh` (delete)
- `shared/skills/sandbox/sandbox-finish.sh` (delete)

## Notes

- FCIS: core.clj is pure, cli.clj wires I/O. All git commands, fs writes,
  and mux calls happen in cli.clj.
- Use `babashka.fs/glob` for ticket resolution instead of bash `find`.
- Use `babashka.fs/which` for cmux binary resolution instead of shelling
  out to `which`.
- The `mux.protocol/detect-mux` call needs `(into {} (System/getenv))` —
  document this pattern.
- `p/sh {:dir worktree-path} "git" ...` avoids needing to cd.
- Port the worktree-already-exists early-return from the bash script.
- Port the config-dir symlink logic (only untracked items, skip existing).
