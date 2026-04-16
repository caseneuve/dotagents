---
title: "agent-channel FCIS refactor: pure core, tests, module split"
status: done
priority: medium
type: refactor
labels: [code-excellence, FCIS]
created: 2026-04-14
parent: null
blocked-by: []
blocks: []
---

## Context

The `agent-channel` extension (~1025 lines, single file) shipped a working inter-agent
comms system but mixes pure logic with I/O throughout. A code design review identified:
- Duplicated filtering logic across backends
- Pure functions embedded in impure orchestration
- In-place mutation in `ackMessages`
- Identity management spread across 3 variables
- No unit tests

Goal: refactor toward FCIS (Functional Core, Imperative Shell) with full test coverage
on the pure core. Split the monolith into focused modules.

## Acceptance Criteria
- [x] Pure core extracted and tested (T1, T2)
- [x] Identity consolidated (T3)
- [x] Monolith split into modules (T4)
- [x] Robustness improvements landed (T5)
- [x] All existing functionality preserved (no behavior changes)

## Sub-tasks
- 0010.1: Extract pure core + dedup backend filtering
- 0010.2: Unit tests for pure core
- 0010.3: Consolidate identity management
- 0010.4: Split monolith into modules
- 0010.5: Robustness improvements

## Notes
- Based on code design review by agent 140w
- Original review on channel `dotagents/agent-channel-review`
