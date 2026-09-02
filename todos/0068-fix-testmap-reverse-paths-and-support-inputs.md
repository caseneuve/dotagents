---
title: fix testmap reverse paths and support inputs
status: done
priority: medium
type: bug
labels: []
created: 2026-09-02
parent: null
blocked-by: []
blocks: []
---

## Context

`py_testtarget.py` documents paths relative to `--root`, but resolves
`--test-src` from the process working directory. It also calls tests off-target
when they construct imported production-domain inputs alongside a direct call to
the expected source module.

## Acceptance Criteria

- [x] Relative `--test-src` and `--expected-source` paths resolve from `--root`.
- [x] A reverse check retains its expected-module target and labels external
      production input construction as supporting references rather than drift.
- [x] A test with only external production calls remains off-target.
- [x] Unit and CLI tests cover both behaviors.

## Affected Files

- `shared/skills/testmap/scripts/py_testtarget.py` — reverse mapping resolution and classification.
- `shared/skills/testmap/test/test_common.py` — focused unit proofs.
- `shared/skills/testmap/languages/python.md` — CLI and status semantics.

## Notes

Keep genuine unrelated production behavior visible; do not globally suppress
external references.
