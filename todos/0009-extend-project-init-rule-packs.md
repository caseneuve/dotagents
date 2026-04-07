---
title: evolve project-init into project-review with rule packs
status: open
priority: medium
type: feature
created: 2026-04-07
parent: null
blocked-by: []
blocks: []
---

## Context

`project-init` now has an on-demand UI rule-pack template, but the name suggests greenfield setup only. We want to evolve it into a "project-review" style skill that also works on existing projects: audit current agent-facing docs, identify drift/duplication/gaps, and propose cleanup before generating/updating guidance.

In parallel, expand reusable project-local rule packs so agents can apply consistent policies per repo (instead of pushing everything into global runtime rules).

Target packs to add next:

- desired git behavior / commit policy
- desired code review policy
- desired development flow (TDD)
- preferred architecture style (FCIS)

## Acceptance Criteria

- [ ] Skill naming and docs are updated so users understand it supports both fresh initialization and review/sanitization of existing project agent docs.
- [ ] The skill includes an explicit scrutiny flow for existing docs (inventory, drift detection, stale/contradictory rules, missing operational sections, cleanup proposals).
- [ ] Rule-pack templates cover git workflow, code review, dev-flow TDD, and FCIS architecture.
- [ ] Agent + Claude variants stay aligned, with clear guidance for on-demand install into project-local rule dirs.
- [ ] Tests/docs confirm `bb boot` publishes these templates via skills and that usage instructions are discoverable.
- [ ] A de-duplication path is defined for agent/claude rule templates (single source of truth or generated outputs).

## Affected Files

- `agents/skills/project-init/SKILL.md` (or renamed skill path) — add review/sanitization flow + rule-pack usage
- `agents/skills/project-init/rules/*.md` (or renamed skill path) — new rule-pack templates
- `claude/skills/project-init/SKILL.md` (or renamed skill path) — parity updates
- `claude/skills/project-init/rules/*.md` (or renamed skill path) — parity templates (or generated artifacts)
- `scripts/bootstrap.clj` and tests if distribution behavior needs adjustment
- `README.md` (or runtime docs) — optional usage docs for project rule packs

## E2E Spec

GIVEN dotagents with expanded/reworked project review skill and rule packs
WHEN `bb boot agents` and `bb boot claude` are run in isolated homes
THEN the new rule-pack templates are available under installed skill paths, and docs explain both initialization and review/sanitization workflows for existing project agent docs.

## Notes

- Keep global AGENTS/CLAUDE rules slim; rule packs should be project-local and opt-in.
- Include migration notes if skill renaming occurs (`project-init` -> `project-review` or alias strategy).
- Avoid maintaining near-identical agent/claude rule template files manually (prefer shared source + generation).
