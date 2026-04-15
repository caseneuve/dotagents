---
title: comms skill improvements from mux-bb review session
status: open
priority: medium
type: chore
labels: [comms]
created: 2026-04-15
parent: null
blocked-by: []
blocks: []
---

## Context

During the mux-bb code review session, both agents (dev + reviewer) identified
friction points in the cmux-comms and code-review skill workflows. These are
real observations from a working multi-agent review cycle, not theoretical.

## Acceptance Criteria

### cmux-comms SKILL.md

- [ ] Add guidance on combining lobby announcement with first task-channel message
      (send both simultaneously to reduce the 3-message ceremony to 2)
- [ ] Add `re-review-response` message type to the conventions table
- [ ] Add `fixes-ready` message type (distinct from `task-complete` — signals
      "please verify" rather than "I'm done")
- [ ] Add tip: pre-load project context (AGENTS.md, source, rules) while waiting
      for a review-request or task assignment
- [ ] Add tip: continue non-dependent work while watching for review responses
      (don't block idle)

### code-review SKILL.md

- [ ] Add a task-complete / fixes-ready template matching the review-request format:
      ```
      ## What was fixed
      <Finding → fix mapping>

      ## How to verify
      <Exact command: git diff <before>..<after>, test command>

      ## What was deferred
      <Findings acknowledged but not fixed, with reasoning>
      ```
- [ ] Document the re-review round convention (reviewer sends `re-review-response`
      after verifying fixes, may include new findings)

## Affected Files

- `pi/darwin/extensions/agent-channel/skills/cmux-comms/SKILL.md`
- `agents/skills/code-review/SKILL.md`
- `claude/skills/code-review/SKILL.md`

## Notes

- Keep parity across claude/ and agents/ skill docs per AGENTS.md guidance
- These are documentation-only changes, no code
- Sourced from agents z23q (dev) and xkb2 (reviewer) during mux-bb/review-initial
