---
title: Add test coverage for repo helper scripts
status: open
priority: medium
type: chore
created: 2026-03-17
parent: null
blocked-by: []
blocks: []
---

## Context

This repo has a growing set of helper scripts spread across skill directories and runtime-specific entrypoints, but coverage is uneven. I reviewed the current helpers:

- `shared/skills/add-todo/todo-next-id.sh`
- `shared/skills/add-todo/todo-new.sh`
- `shared/skills/add-todo/todo-list.sh`
- `shared/skills/add-todo/todo-status.sh`
- `shared/skills/code-review/detect-and-lint.sh`
- `shared/skills/code-review/review-file.sh`
- `shared/skills/org-journal/new-entry.bb`
- `shared/skills/pk-tmux/tmux-create.sh`
- `shared/skills/pk-tmux/tmux-run.sh`
- `shared/skills/pk-tmux/tmux-status.sh`
- `shared/skills/pk-tmux/tmux-wait.sh`
- `shared/skills/sandbox/sandbox-create.sh`
- `shared/skills/sandbox/sandbox-finish.sh`
- `claude/hooks/smart-lint.sh`
- `claude/statusline-command.sh`

Because the scope spans many scripts and multiple test styles, the work should be split. The key design choice is whether each script should keep its current shell implementation and get end2edn coverage, or whether selected helpers should be rewritten/extracted into Babashka so they can be tested through `bb test` and unit tests.

## Acceptance Criteria

- [ ] There is an agreed test plan mapping each helper script to either Babashka/unit coverage, end2edn coverage, or an explicitly documented reason to defer.
- [ ] Follow-up tasks cover the helper-script groups in reviewable chunks rather than one large change.
- [ ] The resulting plan preserves the repo rule that `bb test` is the canonical entrypoint and containerized E2E remains the default for I/O-heavy scripts.

## Affected Files

- `shared/skills/**/*.sh` - primary helper scripts to cover
- `shared/skills/org-journal/new-entry.bb` - Babashka helper that may be tested directly or after extraction
- `claude/hooks/smart-lint.sh` - Claude hook script with stdin/stdout contract
- `claude/statusline-command.sh` - statusline script with JSON input contract
- `bb.edn` - keep canonical test entrypoints aligned if new tasks are added
- `test/unit/...` - unit coverage for extracted pure logic or Babashka helpers
- `test/e2e/...` - end2edn coverage for shell and process I/O contracts

## Notes

Prefer FCIS-style changes: keep parsing/planning/formatting logic pure where practical, and leave filesystem/process I/O at the edges. Good candidates for direct `bb test` coverage are Babashka helpers and shell scripts whose logic can be extracted into Babashka namespaces. Good candidates for end2edn are scripts whose value is mainly command-line I/O, temp dirs, git worktrees, tmux behavior, or JSON/stdin/stdout contracts.
