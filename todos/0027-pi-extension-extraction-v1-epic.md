---
title: pi extension extraction v1 (new repos under ~/git/pi)
status: open
priority: high
type: epic
labels: [pi, packaging, extraction]
created: 2026-05-12
parent: null
blocked-by: []
blocks: [0027.1, 0027.2, 0027.3, 0027.4]
---

## Context

We want to move selected dotagents Pi extensions into installable standalone packages,
with new repos created under `~/git/pi/`.

Scope is intentionally selective:
- extract coupled `agent-channel` ecosystem
- extract selected standalone extensions (`assistant-outline`, maybe `diff-review`)
- move runtime status family to a new repo and redesign there (not in dotagents)

Constraints:
- use `@earendil-works/*` deps (not legacy `@mariozechner/*`)
- align with latest Pi API/docs during extraction to avoid carrying tech debt
- keep idiosyncratic/local-only extensions out of v1 extraction

## Acceptance Criteria

- [ ] Target repo map under `~/git/pi/` is agreed and documented.
- [ ] `agent-channel` extraction plan includes bundled `agent-comms` skill + detached relay operations model.
- [ ] `assistant-outline` extraction plan is approved.
- [ ] `diff-review` extraction gets explicit go/no-go decision.
- [ ] Runtime status extraction/rewrite plan (pluggable blocks) is defined in new repo scope.
- [ ] All extracted packages target `@earendil-works/*` imports and current Pi package conventions.

## Sub-tasks

- 0027.1: Extract agent-channel suite to new repo
- 0027.2: Extract assistant-outline to new repo
- 0027.3: Decide and, if approved, extract diff-review to new repo
- 0027.4: Runtime status modular rewrite in new repo

## Affected Files

- `todos/0027*.md` — epic and sub-task tracking.
- New repos under `~/git/pi/` — implementation lives there, not in dotagents.

## Notes

- Keep install-strategy audit in separate todo `0026`.
- Emacs bridge is moved out (`~/git/pi/pi-emacs-bridge`) and is out of scope.
