---
title: Build an inspectable SDK-based Pi subagent framework
status: open
priority: medium
type: feature
created: 2026-03-18
parent: null
blocked-by: []
blocks: [0004.1, 0004.2, 0004.3, 0004.4]
---

## Context

We want Pi subagents to become a reusable framework rather than a one-off
subprocess trick. The framework should define subagents in Markdown with clear
scope and tool constraints, run them through the SDK, and make their work
inspectable to the human without dumping huge nested transcripts into the main
agent context.

A good first version needs three things together:

- a Markdown-defined subagent spec plus a session factory that can enforce
  scope and tool policy
- a parent-facing UX that shows live progress and expandable summaries while a
  workflow is running
- a trace model and inspection surface so humans can audit worker/reviewer
  loops after the fact

The first motivating workflow is a review loop where a worker implements code,
a reviewer reports findings, and the worker iterates until the reviewer passes
or the loop hits a configured limit.

## Acceptance Criteria

- [ ] There is one documented canonical architecture for subagents in this repo:
      Markdown agent specs + SDK-backed sessions + extension-hosted UX.
- [ ] The framework supports at least one end-to-end inspectable workflow such
      as `review_loop`, where the human can see compact live progress and later
      inspect round-by-round results.
- [ ] Subagent definitions can express model/tool constraints and execution
      scope without requiring hard-coded per-agent logic in the extension.
- [ ] The main-agent context receives compact structured summaries rather than
      the full nested transcript by default, while the human can still inspect
      detailed traces on demand.
- [ ] The implementation leaves one obvious extensible path for future
      workflows such as single delegation, chains, and parallel subagents.
- [ ] Relevant Pi docs in this repo describe the canonical UX and extension
      shape once the first working version lands.

## Affected Files

- `pi/extensions/` — subagent framework extension entrypoint and orchestration
  modules
- `pi/extensions/shared/` — shared helpers if trace/rendering logic is reused
- `.pi/agents/` — canonical project-local Markdown subagent definitions and
  examples, with user-level discovery only as a compatibility layer
- `pi/README.md` — canonical documentation home for the framework and
  user-facing workflow
- `test/unit/` — pure parsing/planning/trace helpers
- `test/e2e/` — extension workflow behavior and inspectability checks

## E2E Spec

GIVEN Markdown-defined worker and reviewer agents
WHEN the parent agent runs a `review_loop` workflow
THEN Pi executes isolated SDK-backed subagent sessions and returns a compact
summary to the main agent

GIVEN a running or completed subagent workflow
WHEN the human expands or inspects it
THEN they can see live status and round-by-round subagent results without the
main conversation being flooded with the full nested transcript

## Notes

Prefer a framework that composes reusable primitives: spec loading, scoped
resource loading, tool policy, trace capture, renderer state, and workflow
orchestration. Keep raw transcript storage separate from the compact summary
that is returned to the parent LLM.