# AGENTS.md — Agent Development Guide

## Rules

### MUST
- Follow TDD: RED -> GREEN -> REFACTOR
- See a failing test before writing implementation
- Read framework docs first when the task depends on a specific library or tool
- Lint before commit unless the change is docs-only
- Work in small, reviewable chunks
- Prefer DRY, YAGNI, and clear pure/impure boundaries

### MUST NOT
- Commit or push without explicit user approval
- Add generated commit trailers
- Write implementation before tests
- Run destructive code without sandboxing
- Run project tests on the host unless the user explicitly approves it

### PREFER
- Editing existing files over creating new ones
- Short functions, guard clauses, and flat control flow
- Existing codebase conventions unless they are clearly harmful

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
