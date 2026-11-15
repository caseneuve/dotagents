# CLAUDE.md — Agent Development Guide

## Rules

### MUST
- Follow TDD: RED (failing test) → GREEN (implement) → REFACTOR
- **See RED before GREEN**: Never write implementation before seeing a failing test
- **Read framework docs first**: When told to use a specific library/framework, read its documentation before implementing
- **Lint before commit**: Run linter and fix all errors before every commit (except doc-only changes)
- Work iteratively in small, contained chunks (see Development Flow)
- For development work, prefer sandbox/worktree or feature-branch flow with frequent checkpoint commits so history is traceable
- DRY, YAGNI, Functional Core / Imperative Shell
- Keep functions short (5–15 lines), flat, with type hints/specs
- Ask before making changes (unless instructed otherwise)
- Use fixtures, factories, parametrization in tests
- **Check git state before amend**: Always run `git log --oneline -3` before `git commit --amend` to confirm you're amending the right commit

### MUST NOT
- Push to remote or merge into the main branch without explicit permission
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

## Coding Principles (anti-slop)

Use these as operational guardrails for implementation quality.

### 1) Contract-first model
Before implementation, define:
- inputs
- outputs
- invariants
- failure modes

Operational check: "Can I describe this function in one sentence: given X, returns Y, guarantees Z?"

### 2) Data-shape-first model
Most complexity comes from bad data modeling, not syntax.
Design data structures first; control flow should follow data flow.

Operational check: "Is this branch complexity caused by poor data shape?"

### 3) Local reasoning model
A maintainer should understand behavior with minimal cross-file jumps.
- small functions
- explicit dependencies
- no hidden side effects

Operational check: "Can a maintainer predict behavior from this file alone?"

### 4) Semantic compression model
Code should communicate through naming and structure, not scaffolding comments.
- remove redundant blocks
- prefer meaningful names over explanatory comments
- comments should explain **why**, not **what**
- if many scaffolding comments are needed, extract a named function so the name carries intent and the comment becomes unnecessary

Operational check: "If I need scaffolding comments to explain a block, should this become a separate function with a better name?"
Operational check: "If I delete this comment/block, does clarity drop? If not, delete."

### 5) Decision visibility model
Explain important choices where they are made:
- why this algorithm
- why this trade-off
- why this failure handling

Operational check: "Did I explain non-obvious decisions and hide obvious mechanics?"

### 6) Feedback-loop model (anti-slop engine)
Tight cycle:
1. failing test/spec
2. minimal code to pass
3. refactor for clarity
4. rerun checks

Operational check: "How long since last failing -> passing cycle?"

### 7) Delete-first model
Slop is often excess, not missing code.
Prefer removing complexity before adding abstraction.

Operational check: "What can I remove while preserving behavior?"

### Quick anti-slop checklist
- [ ] Function has one purpose
- [ ] Nesting depth <= 2 (or justified)
- [ ] No duplicate logic or literals
- [ ] Names carry meaning; comments are mostly "why"
- [ ] Edge cases are explicit
- [ ] Error messages are actionable
- [ ] Tests cover contract + key failure modes
- [ ] No meta scaffolding left behind

### Highest-impact guards for this agent
1. Contract-first
2. Semantic compression pass
3. Delete-first refactor after green tests

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

Default behavior during implementation: create checkpoint commits at TDD slice boundaries (RED/GREEN/REFACTOR) unless the user explicitly asks to batch or defer commits.

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
