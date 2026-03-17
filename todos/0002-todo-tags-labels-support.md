---
title: Add tags or labels support to todo items
status: open
priority: medium
type: feature
created: 2026-03-17
parent: null
blocked-by: []
blocks: []
---

## Context

The add-todo workflow currently supports title, type, priority, status, and parent/child relationships, but it does not support lightweight labels such as `mvp`, `beta`, or other project-specific tags. Adding a simple tag field would make it easier to group and filter work without changing task hierarchy.

A good first version is likely:

- add a `tags: []` frontmatter field to the todo template
- support creating tags from `todo-new.sh`, for example via `--tags mvp,beta`
- support filtering by tag in `todo-list.sh`, for example via `--tag mvp`
- treat missing `tags` fields in older todos as empty

This repo follows TDD, so test coverage is not optional and must be part of the implementation rather than follow-up work. The change can be implemented in shell if that remains simple and maintainable, but the task may also include porting some or all of the add-todo helper scripts to Babashka if that yields clearer parsing, purer logic, and better `bb test` coverage while preserving the canonical CLI behavior.

## Acceptance Criteria

- [ ] Tests are written first or alongside the implementation and the final change ships with coverage for the new tag behavior as part of the same work.
- [ ] New todo items include a `tags` frontmatter field with a sensible default such as `[]`.
- [ ] `shared/skills/add-todo/todo-new.sh` accepts an optional tag input and writes normalized tags into frontmatter, or an equivalent Babashka-backed implementation preserves the same CLI contract.
- [ ] `shared/skills/add-todo/todo-list.sh` can filter items by tag while remaining backward compatible with existing todos that have no `tags` field, or an equivalent Babashka-backed implementation preserves the same CLI contract.
- [ ] The implementation explicitly evaluates whether the current bash helpers should stay in bash or be ported/extracted to Babashka for testability and maintainability.
- [ ] The add-todo skill/template documentation explains the new field and CLI usage.
- [ ] Tests cover default tag behavior, single-tag creation, multi-tag creation, and tag filtering.

## Affected Files

- `shared/skills/add-todo/todo-new.sh` - add tag argument handling and template output, or become a thin wrapper over Babashka logic
- `shared/skills/add-todo/todo-list.sh` - add tag filtering logic, or become a thin wrapper over Babashka logic
- `shared/skills/add-todo/todo-next-id.sh` - check whether related add-todo helpers should be kept aligned if the implementation moves toward Babashka
- `shared/skills/add-todo/todo-status.sh` - check parity and helper consistency if the implementation is refactored
- `/home/piotr/.agents/skills/add-todo/SKILL.md` - update documented template and helper usage
- `todos/*.md` - new items should use the updated template format
- `test/e2e/...` - verify helper-script I/O behavior for tags and CLI compatibility
- `test/unit/...` - cover extracted or ported Babashka parsing/formatting/filtering logic under `bb test`

## E2E Spec

GIVEN a repo with a `todos/` directory
WHEN I create a todo with the add-todo helper using `--tags mvp,beta`
THEN the created file includes `tags: [mvp, beta]`

GIVEN existing todos with and without tags
WHEN I run the todo listing helper with `--tag mvp`
THEN only todos tagged with `mvp` are listed

GIVEN the add-todo helpers are partially or fully ported to Babashka
WHEN I run the documented CLI entrypoints
THEN they preserve the expected stdout/stderr and file-format contracts

## Notes

Prefer a simple inline array format like `tags: [mvp, beta]` because it is easier to write and parse than multiline YAML lists. If the bash implementation starts accumulating brittle string parsing, prefer extracting pure parsing/filtering/formatting logic into Babashka and keeping shell only at the I/O boundary. Do not treat test coverage as a separate follow-up; it is part of the definition of done.
