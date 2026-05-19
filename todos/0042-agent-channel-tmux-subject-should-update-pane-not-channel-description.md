---
title: "agent-channel: tmux subject updates should target pane status/title, not channel description"
status: done
priority: high
type: bug
labels: [agent-channel, tmux, ux]
created: 2026-05-19
parent: null
blocked-by: []
blocks: []
---

## Context

Agents in tmux frequently attempt to use `/agent-channel` / `channel_status` patterns as if they were setting a shared channel description (cmux mental model).

In tmux, the expected behavior is local pane-oriented subject/status updates.

## Problem

Tmux UX still leaks cmux-style guidance/behavior, so agent status/subject updates are inconsistent and often applied to the wrong surface.

## Acceptance Criteria

- [x] Tmux-mode guidance explicitly tells agents to set local pane subject/status
- [x] Subject/status intent in tmux routes to pane status/title path deterministically
- [x] Shared channel-description semantics are not presented as primary in tmux mode
- [x] Behavior remains coherent when comms are muted/off (as designed)
- [x] Tests verify tmux-specific subject/status routing and messaging

## Suggested Files

- `pi/extensions/agent-channel/index.ts` (orientation/help text, intent routing)
- `pi/extensions/agent-channel/displays.ts` (tmux display behavior, if needed)
- `pi/extensions/agent-channel/README.md`
- relevant tests under `pi/extensions/agent-channel/*.test.ts`

## Notes

Goal: remove cmux->tmux abstraction leakage and make tmux behavior predictable for agents.
