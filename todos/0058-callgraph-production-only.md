---
title: callgraph production only
status: done
priority: medium
type: feature
labels: [skills]
created: 2026-08-05
parent: null
blocked-by: []
blocks: []
---

## Context

Callgraph output currently includes production and test callers together. Add an opt-in CLI filter
for users who want to inspect only production code without changing the default report.

## Acceptance Criteria

- [x] Add `--production-only` while preserving existing default output.
- [x] Exclude conventional Python test files and `test`/`tests` directories when enabled.
- [x] Cover filename, directory, and default-behavior cases with tests.
- [x] Document the flag and verify it against the Dry4py repository.

## Affected Files

- `shared/skills/callgraph/scripts/py_callers.py` — filter repository scan paths.
- `shared/skills/callgraph/test/test_py_callers.py` — cover filtering behavior.
- `shared/skills/callgraph/languages/python.md` — document usage.

## E2E Spec

GIVEN a repository with both production and test callers
WHEN `py_callers.py --production-only` scans a symbol
THEN only non-test definitions, callers, and import-only evidence are reported.

## Notes

Conventional tests are files named `test_*.py` or `*_test.py`, or Python files beneath a path
component named `test` or `tests`.
