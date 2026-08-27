---
title: Add shared to-skill workflow
status: done
priority: medium
type: feature
labels: []
created: 2026-08-27
parent: null
blocked-by: []
blocks: []
---

## Context

Agents repeatedly spend time recovering the same environmental context when a
short or ambiguous request hides a broader workflow. Add a shared skill that
turns the verified, hard-won resolution from the current task into concise,
portable local guidance for future agents.

## Acceptance Criteria

- [x] A shared `to-skill` skill tells an agent to distill a resolved ambiguity or repetitive context-discovery problem into a reusable skill.
- [x] The default destination is `.pi/skills/<skill-name>/SKILL.md`, with an explicit user-provided path taking precedence.
- [x] The workflow captures only verified missing context, including necessary commands, tests, tools, or subagent steps, without replaying the incident.
- [x] Generated guidance is concise and portable, with no machine-, user-, repository-, ticket-, or session-specific references.
- [x] The generated skill uses valid Agent Skills frontmatter and is checked for scope, portability, and actionable verification.
- [x] Shared-skill indexes and bootstrap E2E expectations include `to-skill` for both supported runtimes.

## Affected Files

- `shared/skills/to-skill/SKILL.md` — canonical shared skill instructions.
- `README.md` — top-level shared skill inventory.
- `agents/skills/README.md` — Agents shared skill inventory.
- `claude/skills/README.md` — Claude shared skill inventory.
- `test/e2e/cases.edn` — bootstrap link coverage for both runtimes.

## E2E Spec

GIVEN an agent has resolved a recurring task whose short request omitted
necessary environmental context
WHEN the user invokes `to-skill` without an output path
THEN the agent creates a concise, portable skill under
`.pi/skills/<skill-name>/SKILL.md` containing the verified workflow and checks.

## Notes

Do not encode the current repository, host, user, ticket, or one-off failure in
the generated skill. Preserve only context that a future agent needs to act.
