---
title: Design a Pi knowledge-gathering tool for docs and repo research
status: open
priority: medium
type: feature
created: 2026-04-04
parent: null
blocked-by: []
blocks:
  - 0007.1
  - 0007.2
  - 0007.3
  - 0007.4
---

## Context

Playwright works well for interactive frontend debugging, but it is a poor fit for documentation and repository research. We want a Pi-native research workflow that can efficiently ingest docs sites or GitHub repositories, extract clean readable content, preserve source references, and continue exploring through meaningful links instead of re-driving a browser manually.

## Acceptance Criteria

- [ ] Produce a concrete design for a Pi extension or toolset aimed at efficient knowledge gathering from docs sites and repositories.
- [ ] Define how the tool discovers, ranks, and follows relevant links so it can continue research across a site or repo without browser-style interaction.
- [ ] Specify the core tool surface area (for example fetch/discover/search/read or equivalent), expected input/output schemas, and cache or corpus model.
- [ ] Document how the tool preserves traceability back to original sources via URLs, paths, headings, chunk IDs, and freshness metadata.
- [ ] Identify an MVP implementation path suitable for this repo, including likely files/modules, dependencies, and test strategy.
- [ ] Define explicit MVP non-goals and constraints, including what is intentionally out of scope for the first version.

## Affected Files

- `pi/extensions/...` — likely home for a new research-oriented Pi extension
- `pi/README.md` — document the new extension if implemented
- `test/...` — add regression coverage once the design becomes implementation work

## E2E Spec

GIVEN a docs site or repository URL and a focused research task
WHEN the agent uses the knowledge-gathering tool
THEN it can fetch clean content, see and rank relevant links, follow the next best sources, and return source-cited findings efficiently

## Notes

- Prefer a research-oriented tool over browser automation.
- The design should explicitly support link-aware traversal and incremental corpus building.
- Good fit may be a small set of composable tools rather than one giant tool.
- Candidate MVP non-goals to evaluate explicitly: no JS-rendered page support, no authenticated crawling, no broad full-codebase indexing, and no general web search backend in the first cut.
