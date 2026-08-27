---
title: fix testmap nested layout and static patch targets
status: in_progress
priority: medium
type: bug
labels: []
created: 2026-08-27
parent: null
blocked-by: []
blocks: []
---

## Context

Python testmap treated mirrored test directories such as
`foo/module/blah.py` -> `foo/tests/module/test_blah.py` as misplaced, and
could not reverse-map them. It also ignored statically resolvable `@patch`
targets, including f-strings built from a module-name constant.

## Acceptance Criteria

- [ ] Forward and reverse mapping recognize mirrored directories below an app's
  `tests/` directory, while retaining flattened Django-style discovery.
- [ ] Relative `--test-pattern` paths are normalized before classification.
- [ ] Literal and lexically visible f-string `@patch` targets appear as static
  references without being counted as direct calls.
- [ ] Unit tests and skill documentation cover the new behavior and limits.

## Affected Files

- `shared/skills/testmap/scripts/_common.py` — statically resolve patch targets.
- `shared/skills/testmap/scripts/py_testmap.py` — forward layout and patch status.
- `shared/skills/testmap/scripts/py_testtarget.py` — reverse layout and patch status.
- `shared/skills/testmap/test/test_common.py` — regression coverage.
- `shared/skills/testmap/{SKILL.md,languages/python.md}` — document behavior.

## E2E Spec

GIVEN `foo/module/blah.py` and `foo/tests/module/test_blah.py`
WHEN either testmap direction runs
THEN the expected counterpart is found and references are on-target/placed.

## Notes

A static patch target is an ownership/reference signal only. Dynamic values,
patch context managers, and `patch.object(...)` remain out of scope.
