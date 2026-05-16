---
title: runtime footer explicit separator block
status: in_progress
priority: medium
type: feature
labels: []
created: 2026-05-16
parent: 0035
blocked-by: []
blocks: [0038]
---

## Context

Runtime-footer currently inserts the configured separator uniformly between all rendered blocks on a side. Users want explicit control over where separator tokens appear.

## Acceptance Criteria

- [ ] Add an explicit separator pseudo-block in block lists (proposed canonical id: `sep`; optional alias `S` if desired).
- [ ] Existing global `separator` string remains the token rendered by the separator pseudo-block.
- [ ] **Backward compatibility contract is explicit and documented**: if no `sep`/`S` tokens are present in a side config, preserve current implicit separator-between-rendered-blocks behavior.
- [ ] Non-separator blocks still keep at least baseline spacing for readability.
- [ ] Separator edge cases are handled safely:
  - [ ] leading/trailing separator tokens do not render dangling separators.
  - [ ] adjacent separator tokens collapse to one effective separator.
  - [ ] separators adjacent to blocks that render empty (for example `git-diff` when absent) do not leave orphan separators.
- [ ] Unknown block ids continue to be ignored safely.
- [ ] README docs show examples of explicit separator placement and compatibility behavior.

## Affected Files

- `pi/extensions/runtime-footer.ts` — block parsing/rendering with explicit separator pseudo-block.
- `pi/README.md` — config docs and examples.

## E2E Spec

GIVEN footer config left side `['cwd', 'sep', 'project', 'session-notes']`
WHEN footer renders
THEN configured separator appears between `cwd` and `project`, with no forced separator between `project` and `session-notes` unless explicitly requested.

GIVEN footer config side has no separator pseudo-block tokens
WHEN footer renders
THEN existing implicit separator-between-rendered-blocks behavior is preserved.

GIVEN separator tokens appear as `['sep', 'cwd', 'project', 'sep']` or `['cwd', 'sep', 'sep', 'project']`
WHEN footer renders
THEN no dangling/duplicate separators are shown.

GIVEN config includes separators next to potentially-empty blocks (for example `['cwd', 'sep', 'git-diff', 'sep', 'project']`)
WHEN `git-diff` renders empty
THEN no orphan separators remain.

## Notes

Prefer readable block id (`sep`) over single-letter magic; alias support can be added if it does not complicate parsing.

Expected sequencing: implement this item before `#0038` because both touch shared token parsing/rendering paths in `runtime-footer`.
