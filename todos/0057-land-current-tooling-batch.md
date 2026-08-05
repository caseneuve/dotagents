---
title: land current tooling batch
status: done
priority: medium
type: chore
labels: [pi, skills]
created: 2026-08-05
parent: null
blocked-by: []
blocks: []
---

## Context

Land the current uncommitted tooling batch: responsive viewport control for the Pi Playwright
extension, Python analysis skills for call graphs/data flow/test placement, and a small prompt
clarification.

## Acceptance Criteria

- [x] Expose bounded Playwright viewport resizing and document the tool.
- [x] Cover viewport tool registration, active-page enforcement, and resize delegation.
- [x] Add the callgraph, dataflow, and testmap shared skills with behavioral regression coverage.
- [x] Clarify the optional path wording in the Markdown handoff prompt.

## Affected Files

- `pi/extensions/playwright/` — add the viewport tool.
- `test/pi/playwright.test.ts` — verify viewport behavior.
- `shared/skills/{callgraph,dataflow,testmap}/` — add analysis skills, helpers, and tests.
- `pi/prompts/md-dump.md` — clarify optional argument wording.

## Notes

This item was created retroactively after implementation and review because the changes already
existed on `master`. Per the user's direction, it records that history honestly rather than
simulating the normal `open` → `in_progress` commit flow. The batch is intentionally landing as one
commit.
