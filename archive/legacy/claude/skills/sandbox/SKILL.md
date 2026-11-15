---
name: sandbox
triggers:
  - sandbox
  - start sandbox
  - worktree
  - start ticket
allowedPrompts:
  - tool: Bash
    prompt: ag-sandbox create
  - tool: Bash
    prompt: ag-sandbox finish
---
# `sandbox` — Isolated Worktree for Ticket Development

**Core principle:** Never develop directly in the main repo. All ticket work happens in disposable git worktrees.

## Starting a Ticket `/sandbox <ticket-num>`

Ticket number is flexible: `16`, `#16`, `00016` all resolve to the same ticket. The tool strips `#` prefixes and matches with optional zero-padding automatically.

1. Run `ag-sandbox create <ticket-num>` — output: MainRepo, Worktree path, Branch, BaseBranch, Status (created|exists), Submodules, Ticket file path. When running inside cmux, also opens a new workspace for the worktree.
2. Tell user which branch the worktree was created from (`BaseBranch`). If unexpected, confirm before proceeding.
3. If `Submodules: yes` — confirm: *"This project has submodules. Three-stage commit flow required. Proceed?"*
4. `cd` into worktree, run `/add-dir <worktree-path>`, set ticket status to `in_progress`

## Working in Worktree

- All development in worktree — never switch back to main repo
- Do not execute project code on host (including test frameworks). Use the project's containerized path.
- Before first commit, inspect recent subjects in the worktree root (`git log --oneline -n 20`) and mirror local commit style.
- Commit with project format (see CLAUDE.md), keeping cadence aligned with TDD slices (red -> green -> refactor) unless user requests batching/squashing.
- In non-interactive harness sessions, avoid editor-blocking VCS flows. For example, use `GIT_EDITOR=true git rebase --continue` (and equivalent for cherry-pick/revert) unless the user explicitly asks to edit commit messages interactively.

### Submodules: Three-Stage Commit Flow

```bash
# 1. Checkout branch in submodule
cd path/to/submodule && git checkout master && cd ../..
# 2. Commit inside submodule
cd path/to/submodule && git add . && git commit -m "[#N.M stage] ..." && cd ../..
# 3. Commit submodule pointer in parent
git add path/to/submodule && git commit -m "[#N.M stage] update submodule pointer"
```

## Finishing a Ticket

**ALWAYS get explicit user approval before merging.**

1. Show diff: `ag-sandbox finish <ticket-num> --diff-only`
2. Check for code review: `~/.claude/skills/code-review/review-file.sh latest`
   - No review found → run `/code-review` or ask user to request one from a separate agent
   - Review found → verify all Critical and Important findings are resolved
3. Before finish, ensure ticket tracking artifacts are committed when applicable (for example `todos/<ticket>.md` in todo-driven projects).
4. On user approval: `cd <main-repo-path> && ag-sandbox finish <ticket-num>`

## Safety Rules

- **NEVER** execute project code on host (including test frameworks)
- **NEVER** remove worktree or merge without explicit user approval
- **NEVER** work in main repo during ticket development
- **ALWAYS** checkout branch in submodule before making changes
- **ALWAYS** validate paths before any cleanup step that removes a worktree
