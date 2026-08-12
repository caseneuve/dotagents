---
title: invariant discovery skill
status: done
priority: high
type: feature
labels: []
created: 2026-08-10
parent: null
blocked-by: []
blocks: []
---

## Context

Task-focused agents often optimize for an incomplete local goal and silently remove behavior that encodes an older business rule, compatibility contract, safety boundary, or deliberately narrow scope. Add a shared `/invariants` skill that gathers evidence for these constraints before code is changed and distinguishes mechanically discoverable facts from inferred intent.

## Acceptance Criteria

- [x] A shared `invariants` skill defines a repeatable, evidence-ranked workflow for discovering invariants around a requested change.
- [x] Deterministic analysis covers the current code path, tests, contracts/types/schemas, repository guidance, and relevant version history without claiming that static analysis can recover all business intent.
- [x] The workflow produces a concise invariant ledger with evidence, affected scope, confidence, and a concrete preservation check.
- [x] The skill explicitly prevents unrelated refactors and requires uncertain or conflicting invariants to be escalated rather than optimized away.
- [x] Repository documentation lists the new shared skill and automated checks validate any bundled helper.

## Affected Files

- `shared/skills/invariants/` — shared skill instructions and deterministic analysis helper(s).
- `README.md` — shared skill inventory.
- `test/` or skill-local tests — helper and bootstrap coverage where applicable.

## E2E Spec

GIVEN an agent is asked to change a narrow behavior in an unfamiliar repository
WHEN it invokes `/invariants` for the target symbol or path
THEN it receives an evidence-backed invariant ledger, explicit uncertainty, and preservation checks before proposing edits.

## Notes

An invariant may be detectable as a stable fact, but its business reason is not always recoverable from code. The skill must keep that boundary explicit and prefer repository evidence over plausible narrative.
