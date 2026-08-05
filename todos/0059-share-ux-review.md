---
title: Share and generalize ux-review
status: done
priority: medium
type: refactor
labels: []
created: 2026-08-05
parent: null
blocked-by: []
blocks: []
---

## Context

`ux-review` is maintained as nearly identical Claude- and Agents-specific
copies even though its workflow is runtime-independent. The copies also embed
personal project names, commit hashes, reviewer identifiers, and a host-local
journal path that should not ship as reusable skill guidance.

## Acceptance Criteria

- [x] One canonical `shared/skills/ux-review/SKILL.md` is installed into both supported runtimes.
- [x] Runtime-specific `ux-review` copies are removed.
- [x] Examples and guidance contain no personal paths, projects, commit hashes, ticket IDs, or reviewer identifiers.
- [x] Skill indexes identify `ux-review` as shared and link to the canonical file.
- [x] Bootstrap tests verify the shared skill is linked into both runtime trees.
- [x] Relevant tests and repository link/privacy checks pass.

## Affected Files

- `shared/skills/ux-review/SKILL.md` — canonical generalized skill guidance.
- `agents/skills/ux-review/SKILL.md` — remove duplicate runtime copy.
- `claude/skills/ux-review/SKILL.md` — remove duplicate runtime copy.
- `README.md` and runtime skill indexes — point to the shared skill.
- `test/e2e/cases.edn` — verify bootstrap links the shared skill for both runtimes.

## Notes

Preserve the two-pass UX-review responsibility and workflow. Only consolidate
runtime copies and replace private provenance with generic, reusable examples.
