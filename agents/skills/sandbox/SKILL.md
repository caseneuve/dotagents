---
name: sandbox
description: Create disposable git worktrees for ticket work, keep changes isolated, and merge them back only with explicit approval.
---

# Sandbox

Use this skill when ticket work should happen in a dedicated git worktree instead of the main checkout.

Core rule: never develop directly in the main repo when the project uses sandboxed ticket work.

## Start a ticket sandbox

Run:

```bash
~/.agents/skills/sandbox/sandbox-create.sh <ticket-num>
```

Ticket numbers are flexible: `16`, `#16`, and `00016` should resolve to the same ticket when the helper supports it.

The helper returns the main repo path, worktree path, branch, base branch, whether submodules are present, and the ticket file path.

After creation:

1. Tell the user which base branch the worktree was created from.
2. If the base branch looks unexpected, stop and confirm before proceeding.
3. If submodules are present, warn that a three-stage commit flow is required.
4. Switch all further work to the worktree and keep the main repo untouched.
5. If the project tracks todo state, mark the ticket `in_progress`.

## Work inside the sandbox

- Do all editing, testing, and commits inside the worktree.
- Do not switch back to the main repo for implementation work.
- Follow project safety rules for test execution. If tests must be isolated, use the project's containerized path rather than the host.
- Keep commits scoped to the ticket and follow the repo's commit conventions.
- At ticket start, inspect recent commit subjects in the worktree root (`git log --oneline -n 20`) and mirror the established format.
- Keep commit cadence aligned with TDD slices (red -> green -> refactor), unless the user requests batching/squashing.
- In non-interactive harness sessions, avoid editor-blocking VCS flows. For example, use `GIT_EDITOR=true git rebase --continue` (and equivalent for cherry-pick/revert) unless the user explicitly asks to edit commit messages interactively.

## Submodule flow

If the worktree includes git submodules, use a three-stage flow:

1. Check out the intended branch inside the submodule before editing.
2. Commit the submodule's own changes inside the submodule repository.
3. Commit the updated submodule pointer in the parent repository.

Do not edit a submodule from a detached state unless the user explicitly wants that outcome.

## Finish a ticket

Never merge, remove the worktree, or run the finish step without explicit user approval.

Typical flow:

1. Show the pending diff:
   ```bash
   ~/.agents/skills/sandbox/sandbox-finish.sh <ticket-num> --diff-only
   ```
2. Check for an existing review:
   ```bash
   ~/.agents/skills/code-review/review-file.sh latest
   ```
3. If no review exists, run the `code-review` skill or tell the user a separate review is still needed.
4. If a review exists, verify all Critical and Important findings are resolved before proposing merge.
5. Before finish, ensure ticket tracking artifacts are committed when applicable (for example `todos/<ticket>.md` in todo-driven projects).
6. After explicit approval, finish from the main repo:
   ```bash
   cd <main-repo-path>
   ~/.agents/skills/sandbox/sandbox-finish.sh <ticket-num>
   ```

## Safety rules

- Never work in the main repo during sandboxed ticket development.
- Never merge or delete a sandbox without explicit approval.
- Never ignore submodule state when a ticket touches submodules.
- Validate paths before any cleanup step that removes a worktree.
