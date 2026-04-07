---
title: extend project init rule packs
status: open
priority: medium
type: feature
created: 2026-04-07
parent: null
blocked-by: []
blocks: []
---

## Context

`project-init` now has an on-demand UI rule-pack template. We want to expand this pattern with additional reusable project-local rule packs so agents can apply consistent policies per repo (instead of pushing everything into global runtime rules).

Target packs to add next:

- desired git behavior / commit policy
- desired code review policy
- desired development flow (TDD)
- preferred architecture style (FCIS)

## Acceptance Criteria

- [ ] `project-init` documents and ships additional optional rule-pack templates for git workflow, code review, dev-flow TDD, and FCIS architecture.
- [ ] Agent + Claude variants stay aligned, with clear guidance for on-demand install into project-local rule dirs.
- [ ] Tests/docs confirm `bb boot` publishes these templates via skills and that usage instructions are discoverable.
- [ ] A follow-up note is captured for reducing duplication between agent/claude rule-pack templates (single source of truth / generation strategy).

## Affected Files

- `agents/skills/project-init/SKILL.md` — describe available rule packs and usage
- `agents/skills/project-init/rules/*.md` — new rule-pack templates
- `claude/skills/project-init/SKILL.md` — parity updates
- `claude/skills/project-init/rules/*.md` — parity templates (or generated artifacts)
- `scripts/bootstrap.clj` and tests if distribution behavior needs adjustment
- `README.md` (or runtime docs) — optional usage docs for project rule packs

## E2E Spec

GIVEN dotagents with expanded `project-init` rule packs
WHEN `bb boot agents` and `bb boot claude` are run in isolated homes
THEN the new rule-pack templates are available under installed skill paths and docs explain how to copy them into project-local rules.

## Notes

- Keep global AGENTS/CLAUDE rules slim; rule packs should be project-local and opt-in.
- Add TODO for de-duplication path: avoid maintaining near-identical agent/claude rule template files manually (consider shared source + generated outputs).
