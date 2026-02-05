---
name: add-todo
triggers:
  - add todo
  - add-todo
  - create todo
  - new story
  - new bug
  - new task
allowedPrompts:
  - tool: Bash
    prompt: run todo helper scripts (todo-next-id.sh, todo-new.sh, todo-list.sh, todo-status.sh)
---

# `add-todo` — Create and Track Work Items

Items stored in `./todos/`. Scripts in `~/.claude/skills/add-todo/`, output `key=value` on stdout.

## Helper Scripts

| Script                                                             | Usage                                                           |
|--------------------------------------------------------------------|-----------------------------------------------------------------|
| `todo-next-id.sh [PARENT]`                                         | `todo-next-id.sh` → `0005`, `todo-next-id.sh 0001` → `0001.4` |
| `todo-new.sh --type TYPE --slug SLUG [--priority P] [--parent ID]` | Scaffold from template                                          |
| `todo-list.sh [--status S] [--type T]`                             | List/filter todos                                               |
| `todo-status.sh ID STATUS`                                         | Update status (`open`, `in_progress`, `closed`, `blocked`)      |

## Item Types

| Type                                                | E2E Spec |
|-----------------------------------------------------|----------|
| `feature` — new user-facing functionality          | Required |
| `bug` — something broken                           | Required |
| `refactor` — restructuring without behavior change | Optional |
| `chore` — tooling, infra, cleanup                  | Optional |

## Task Sizing

Prefer small, focused tasks: completable in 1-2 hours, 2-5 files, clear testable criteria.

**Split when:** multiple days of work, vague/numerous acceptance criteria, touches unrelated parts, user says "and also..." repeatedly.

When splitting: create a parent story (high-level + full E2E spec) and sub-tasks (each independently testable). Use `blocked-by` to sequence.

**Filename format:** `NNNN-slug.md` (top-level) or `NNNN.N-slug.md` (sub-task).

## Picking Next Work

1. Check last journal entry via `/org-journal` helper: `bb ~/.claude/skills/org-journal/new-entry.bb` — read `:last-entry` for prior session's Next Steps
2. `todo-list.sh --status open` — list available items
3. Pick highest priority unblocked item (`blocked-by` empty or all resolved)
4. `todo-status.sh ID in_progress` → start `/sandbox ID` if project uses worktrees

## Process

1. **Assess complexity** — suggest splitting if too large; explain the split before creating anything
2. **Gather:** Title, Type, Priority (`high/medium/low`), Parent ID (if sub-task)
3. **Create:** `todo-new.sh --type feature --slug my-feature --priority high [--parent 0001]`
4. **Edit** generated file — fill in Context, Acceptance Criteria, Affected Files, E2E Spec
5. **Show to user** for review before finalizing

## Template

```markdown
---
title: [Title]
status: open
priority: [high | medium | low]
type: [feature | bug | refactor | chore]
created: YYYY-MM-DD
parent: null
blocked-by: []
blocks: []
---

## Context
[Why this matters. What's broken or missing.]

## Acceptance Criteria
- [ ] [Concrete, testable outcome]

## Affected Files
- `src/...` — what changes here
- `test/...` — what to test

## E2E Spec
GIVEN ...
WHEN ...
THEN ...

## Notes
[Constraints, gotchas, design decisions.]
```
