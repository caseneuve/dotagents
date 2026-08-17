---
title: Improve generic Linear skill
status: open
priority: medium
type: refactor
labels: []
created: 2026-08-17
parent: null
blocked-by: []
blocks: []
---

## Context

The existing `linear` skill contains broad, monolithic guidance, while
`linear-todo` adds a repository-todo claim protocol that is no longer needed:
Linear API tokens identify each posting agent as a distinct app. Refactor the
generic skill around small, on-demand playbooks and retire `linear-todo`.

## Acceptance Criteria

- [ ] `shared/skills/linear` routes state gathering, project context, work-item, and resource tasks to concise referenced playbooks.
- [ ] The skill distinguishes stable project descriptions from mutable documents, issue comments, and ADR-like project updates; active project descriptions are not edited by default.
- [ ] Project updates require human confirmation unless explicitly requested and are not routine issue-completion logs.
- [ ] Work-item guidance uses Linear app identity and simple issue state; it has no local todo, host, branch, or competing-claim protocol.
- [ ] `linear-todo` is removed from shared skills, bootstrap coverage, and current documentation.
- [ ] The updated skill and bootstrap behavior are covered by the relevant existing checks.

## Affected Files

- `shared/skills/linear/` — generic skill and progressive-disclosure playbooks.
- `shared/skills/linear-todo/` — retire obsolete specialized skill.
- `scripts/bootstrap.clj`, bootstrap tests, and runtime skill indexes — remove retired-skill installation and references.
- `README.md` and runtime skill documentation — describe the new canonical Linear workflow.

## Notes

Do not remove `add-todo`; it remains the local mechanism for creating and
maintaining repository work items. Do not implement this todo as part of its
creation.
