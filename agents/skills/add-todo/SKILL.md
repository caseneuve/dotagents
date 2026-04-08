---
name: add-todo
description: Create and maintain `./todos` work items, including helper-script-driven scaffolding, status changes, and parent/sub-task splitting.
---

# Add Todo

Use this skill when the user wants to create, split, or update work items stored in `./todos/`.

Helper scripts live in `~/.agents/skills/add-todo/` after bootstrap and print parseable `key=value` output.

## Helper scripts

- `todo-next-id.sh [--dir DIR] [PARENT]`
- `todo-new.sh --type TYPE --slug SLUG [--priority P] [--parent ID] [--dir DIR]`
- `todo-list.sh [--status S] [--type T] [--priority P] [--parent ID] [--dir DIR]`
- `todo-status.sh ID STATUS [--dir DIR]`

## Item types

- `feature`: new user-facing functionality, usually requires an E2E spec
- `bug`: broken behavior to fix, usually requires an E2E spec
- `refactor`: structural change without intended behavior change, E2E spec optional
- `chore`: tooling, infra, cleanup, or maintenance, E2E spec optional

## Sizing rules

Prefer tasks that are small and reviewable: roughly 1-2 hours, a small number of files, and clear acceptance criteria.

Split work when:

- it spans multiple days
- acceptance criteria are vague or numerous
- it touches unrelated areas
- the user keeps appending independent scope

When splitting, create a parent item that captures the overall goal and child items that can each be completed independently.

## Filename format

- Top-level items: `NNNN-slug.md`
- Sub-tasks: `NNNN.N-slug.md`

Use `blocked-by` and `blocks` fields to model sequencing.

## Picking the next item

When the user wants to resume work rather than create a fresh item:

1. Check the last org-journal entry if that workflow is in use:
   ```bash
   bb ~/.agents/skills/org-journal/new-entry.bb
   ```
   If the returned map includes `:last-entry`, read it for the prior session's state and next steps.
2. List open items with `todo-list.sh --status open`.
3. Pick the highest-priority unblocked item.
4. Move it to `in_progress` with `todo-status.sh`.
5. If the project uses isolated worktrees, start the `sandbox` workflow for that item.

## Workflow

0. If `/add-todo` invocation is followed by extra commentary, confirm intent before acting beyond todo management (for example: “todo-only” vs “create todo, then implement”).
1. Assess size first. Split work that spans multiple days, many unrelated files, or vague acceptance criteria.
2. Gather the title, type, priority, and optional parent item.
3. Create the item with `todo-new.sh`.
4. Edit the generated file to fill in context, acceptance criteria, affected files, and the E2E spec when required.
5. Show the draft to the user before treating it as finalized.

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
[Why this matters]

## Acceptance Criteria
- [ ] [Concrete, testable outcome]

## Affected Files
- `src/...` - what changes here
- `test/...` - what to verify

## E2E Spec
GIVEN ...
WHEN ...
THEN ...

## Notes
[Constraints, gotchas, design decisions]
```
