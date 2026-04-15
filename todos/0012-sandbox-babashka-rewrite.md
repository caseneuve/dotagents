---
title: sandbox babashka rewrite with cmux awareness
status: done
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

- [x] `normalize-ticket` strips `#` prefix and leading zeros (port from bash)
- [x] `resolve-ticket-file` matches ticket number against todos dir filenames
      (numeric prefix match with optional zero-padding)
- [x] `worktree-path` derives path from home, project name, and ticket prefix
      (`~/.cache/agentbox/worktrees/<project>-<ticket>`)
- [x] `branch-name` derives branch from project and ticket prefix
      (`agentbox/<project>-<ticket>`)
- [x] `detect-config-dir` returns `.claude` or `.agents` based on context
- [x] `untracked-config-items` — implemented in cli.clj as I/O helper
      (`untracked-in-config-dir`) since it requires git ls-files
- [x] `validate-finish` checks for uncommitted changes in
      worktree, correct cwd (not inside worktree), branch existence,
      main repo cleanliness (bug fix from reviewer 3e3v)

### sandbox/cli.clj (I/O boundary)

- [x] `sandbox create <ticket-num>` subcommand:
      - resolves ticket, creates worktree via git, symlinks config,
        initializes submodules
      - detects cmux via `mux.protocol/detect-mux` from env
      - when cmux: opens new workspace via `mux.cmux`, restores focus to
        original workspace, sends notification
      - prints structured output (MainRepo, Worktree, Branch, BaseBranch,
        Status, Submodules, Ticket)
- [x] `sandbox finish <ticket-num> [--diff-only]` subcommand:
      - validates preconditions (not in worktree, no uncommitted changes,
        branch exists, main repo clean)
      - `--diff-only`: shows diff and commits, exits
      - default: squash-merges branch, removes worktree, deletes branch

### Dependencies

- [x] Wire `mux-bb` as git dep in dotagents `bb.edn`:
      `{:deps {io.github.caseneuve/mux-bb {:git/url ... :git/sha ...}}}`
- [x] Use `babashka.fs` for all path operations (path, glob, exists?,
      directory?, create-dirs, create-sym-link, home, which)
- [x] Use `babashka.cli/dispatch` for subcommand routing
- [x] Use `babashka.process` `:dir` option for git commands in worktree

### Tests

- [x] Unit tests for all pure functions in core.clj
      (ticket normalization, path derivation, plan building, validation)
- [x] Edge cases: ticket with `#` prefix, leading zeros, non-numeric prefix,
      missing ticket file, empty filenames, all-zeros
- [ ] E2E tests in podman — deferred (cmux can't run in container,
      manual lifecycle test covered the full flow)

### Cutover

- [x] Update agents/skills/sandbox/SKILL.md to reference `sandbox create`
      and `sandbox finish` instead of `.sh` scripts
- [x] Update claude/skills/sandbox/SKILL.md in parallel
- [x] Delete `sandbox-create.sh` and `sandbox-finish.sh`
- [x] Update bootstrap to install `sandbox` symlink to `~/.local/bin/`

## Affected Files

- `shared/skills/sandbox/src/sandbox/core.clj` (new) ✅
- `shared/skills/sandbox/src/sandbox/cli.clj` (new) ✅
- `shared/skills/sandbox/test/sandbox/core_test.clj` (new) ✅
- `bb.edn` (mux-bb git dep, sandbox paths) ✅
- `agents/skills/sandbox/SKILL.md` ✅
- `claude/skills/sandbox/SKILL.md` ✅
- `shared/skills/sandbox/sandbox-create.sh` (deleted) ✅
- `shared/skills/sandbox/sandbox-finish.sh` (deleted) ✅
- `scripts/bootstrap.clj` (bin-ops for ~/.local/bin/sandbox) ✅
- `test/unit/bootstrap_pure_test.clj` (bin-ops tests) ✅
- `test/unit/runner.clj` (sandbox.core-test added) ✅

## Notes

- mux-bb is a public git dep: https://github.com/caseneuve/mux-bb
- Requires JVM for tools.deps git dep resolution (openjdk via brew)
- `build-finish-plan` from the original spec was simplified —
  the finish logic is straightforward enough to inline in cli.clj
- `sandbox/bb.edn` not created (not needed — dotagents bb.edn handles paths)
- Reviewed by xkb2 (mux-bb) and 3e3v (sandbox core + docs + bootstrap)
