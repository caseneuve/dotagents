# CLAUDE.md — Agent Development Guide

## Rules

### MUST
- Follow TDD: RED (failing test) → GREEN (implement) → REFACTOR
- **See RED before GREEN**: Never write implementation before seeing a failing test
- **Read framework docs first**: When told to use a specific library/framework, read its documentation before implementing
- **Lint before commit**: Run linter and fix all errors before every commit (except doc-only changes)
- Work iteratively in small, contained chunks (see Development Flow)
- DRY, YAGNI, Functional Core / Imperative Shell
- Keep functions short (5–15 lines), flat, with type hints/specs
- Ask before making changes (unless instructed otherwise)
- Use fixtures, factories, parametrization in tests
- **Check git state before amend**: Always run `git log --oneline -3` before `git commit --amend` to confirm you're amending the right commit

### MUST NOT
- Commit or push without explicit permission
- Add Co-Authored-By or auto-generated trailers to commits
- Write multi-line commit messages (one-line subject only)
- Write implementation before tests / tests after implementation / all tests upfront
- Add verbose docstrings or unnecessary comments (comments lie)
- Run destructive code without sandboxing
- Mix pure computation with I/O in same function

### PREFER
- Editing existing files over creating new ones
- Short pure functions over nested conditionals
- Meaningful names over documentation
- Early returns and guard clauses over deep nesting
- Existing codebase patterns (unless clearly wrong)

## Development Flow

```
E2E Spec → Failing E2E Test → [Pick chunk → Unit Test (RED) → Implement (GREEN) → Refactor] → Green E2E Test
```

Number each E2E spec in TODOs to track progress:
```markdown
#1 - User can authenticate with username/password
#2 - System shows error for invalid credentials
```

Reference these numbers in commits. Agent drives, human navigates.

## Git Commit Checkpoints

Format: `[#N stage]` or `[#N.M stage]` + brief description

| Prefix              | Meaning                    |
|---------------------|----------------------------|
| `[#N e2e red]`      | E2E test written, failing  |
| `[#N e2e green]`    | E2E test passing           |
| `[#N.M unit red]`   | Unit test written, failing |
| `[#N.M unit green]` | Unit test passing          |
| `[#N.M refactor]`   | Refactor for chunk N.M     |
| `[#N feat]`         | E2E spec N complete        |
| `[chore]`           | Tooling/config/non-code    |

## Safety Rules

### Destructive Operations
Require sandbox containment, temp dirs in tests (never real paths), path validation (resolve absolute, verify inside allowed dir). When in doubt, ask first.

### Code & Test Execution
**NEVER run user code or test frameworks directly on the host.** `pytest`, `npm test`, `cargo test` etc. all execute on the host — they are not sandboxes.

**Only run tests inside Docker/containers:**
```bash
docker-compose run test
docker run -v $(pwd):/app test-image pytest
```

If no Docker setup exists, ask: *"How should tests be run safely?"* Default is **do not run**.

Exception: user explicitly asks and confirms it's safe.

### Linter & Tool Installation
**Never install tools or modify config files (package.json, pyproject.toml, etc.) without explicit user approval.** Detect what's missing, suggest with install command, wait for confirmation.

## Hooks

`PostToolUse` hook (`~/.claude/hooks/smart-lint.sh`) runs after every Edit/Write:

| Extension                   | Tool                                 |
|-----------------------------|--------------------------------------|
| `.py`                       | `ruff check --output-format concise` |
| `.clj .cljc .cljs .bb .edn` | `clj-kondo --lint`                   |
| `.js .jsx .ts .tsx`         | `npx eslint --format compact`        |

Errors (`ruff F`, clj-kondo `:error`, eslint `Error`) → `decision: block`. Style → `additionalContext`.

## Skills

| Trigger               | Skill                                        |
|-----------------------|----------------------------------------------|
| `/code-review`, `/CR` | [code-review](skills/code-review/SKILL.md)   |
| `/tmux`               | [pk-tmux](skills/pk-tmux/SKILL.md)           |
| `/init`               | [project-init](skills/project-init/SKILL.md) |
| `/post-mortem`        | [journal](skills/journal/SKILL.md)           |
| `/add-todo`           | [todo](skills/add-todo/SKILL.md)             |
| `/sandbox`            | [sandbox](skills/sandbox/SKILL.md)           |
| `/org-journal`        | [org-journal](skills/org-journal/SKILL.md)   |
| `/self-reflect`       | [self-reflect](skills/self-reflect/SKILL.md) |
