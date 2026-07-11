---
title: Promote an efficient Linear todo workflow to shared skills
status: done
priority: medium
type: feature
labels: []
created: 2026-07-11
parent: null
blocked-by: []
blocks: []
---

## Context

Repository todo files remain canonical, while Linear should expose which agent
and host is working on a todo and retain a concise completion trace. The
workflow should be available to every supported agent runtime without a new CLI
or broad, context-heavy MCP discovery.

## Acceptance Criteria

- [x] A shared `linear-todo` skill defines claim, release, block, finish, and cancel transitions.
- [x] The skill identifies the exact minimal Linear MCP tools and arguments needed for each flow.
- [x] Claims record agent/runtime, host, branch, and todo path and prevent competing work.
- [x] Bootstrap installs the shared skill for agent runtimes through the existing shared-skill mechanism.
- [x] Documentation describes the shared skill and its source-of-truth boundary.

## Affected Files

- `shared/skills/linear-todo/SKILL.md` — canonical cross-runtime workflow.
- `README.md` — shared-skill documentation.
- `test/unit/bootstrap_pure_test.clj` — shared skill installation coverage.

## E2E Spec

GIVEN the shared skills tree contains `linear-todo`
WHEN the agents bootstrap plan is generated
THEN the skill is included in the installed agents skill tree

## Notes

Start with an MCP-orchestrating skill. Add a CLI only if manual use, batch
reconciliation, CI, or offline retry becomes necessary.
