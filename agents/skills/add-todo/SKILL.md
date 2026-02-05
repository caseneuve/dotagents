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

## Workflow

1. Assess size first. Split work that spans multiple days, many unrelated files, or vague acceptance criteria.
2. Gather the title, type, priority, and optional parent item.
3. Create the item with `todo-new.sh`.
4. Edit the generated file to fill in context, acceptance criteria, affected files, and the E2E spec when required.
5. Show the draft to the user before treating it as finalized.
