# AGENTS.md — Agent Development Guide

## Rules

### MUST
- Follow TDD: RED -> GREEN -> REFACTOR
- See a failing test before writing implementation
- Read framework docs first when the task depends on a specific library or tool
- Lint before commit unless the change is docs-only
- Work in small, reviewable chunks
- Prefer DRY, YAGNI, and clear pure/impure boundaries
- Treat explicit workflow commands as mode switches until completion or explicit user redirection:
  - `/add-todo`: todo-management mode
  - `/sandbox`: sandbox/worktree mode
  - `/code-review`: review mode
- For development work, prefer sandbox/worktree or feature-branch flow with frequent checkpoint commits so history is traceable.
- Never start implementation unless the user explicitly asks for implementation.
- If the user asks a question, answer it directly first. Do not treat questions as implicit permission to take actions.
- For diagnostic/status questions (e.g. "what failed?", "why?", "is it done?"), answer first; do not run tools unless the user asks to verify.
- If the user says `STOP`, make no further tool calls until the user gives a new explicit action.
- For review requests, assess scope before running the full workflow; if the visible diff seems too small or administrative, say so explicitly before proceeding

### MUST NOT
- Push to remote or merge into the main branch without explicit user approval
- Add generated commit trailers
- Write implementation before tests
- Run destructive code without sandboxing
- Run project tests on the host unless the user explicitly approves it

### PREFER
- Editing existing files over creating new ones
- Short functions, guard clauses, and flat control flow
- Existing codebase conventions unless they are clearly harmful
- Reviewing from clean context when the user has not asked for comparison with prior reviews

## Development Flow

```text
E2E spec -> failing E2E test -> unit red -> unit green -> refactor -> green E2E
```

Track E2E specs numerically in TODOs so commits can reference them.

## Commit Checkpoints

Use one-line subjects:

- `[#N e2e red]`
- `[#N e2e green]`
- `[#N.M unit red]`
- `[#N.M unit green]`
- `[#N.M refactor]`
- `[#N feat]`
- `[chore]`

Before the first commit on a ticket:
- Inspect recent history (`git log --oneline -n 20`) and match the repo's established subject style.

During implementation:
- Default to checkpoint commits at TDD slice boundaries (red -> green -> refactor) in sandbox/worktree or feature branch flows.
- Checkpoint gate: after each RED/GREEN/REFACTOR slice result, create the checkpoint commit before starting the next slice.
- If the user reminds/corrects checkpoint cadence, switch to strict mode for the rest of the session (no exceptions without explicit user approval).
- If the user explicitly asks to batch/squash or avoid commits, follow that request.

## Safety

- Destructive operations require containment and path validation.
- Tests should run inside Docker, containers, or another isolated environment by default.
- Do not install tools or edit tool configuration without explicit approval.

## Hooks

If you bootstrap hooks into `~/.agents/hooks/`, `smart-lint.sh` can be used as a post-edit lint hook.

## Skills

- `code-review`: systematic review of diffs and branches
- `pk-tmux`: persistent tmux-backed command execution
- `project-init`: generate a project `AGENTS.md`
- `journal`: write post-mortems and learnings
- `add-todo`: create and track work items in `./todos`
- `sandbox`: develop tickets in disposable git worktrees
- `org-journal`: record session logs in Org mode
- `self-reflect`: review the session for mistakes, propose doc and rule improvements
