---
title: "agent-channel: tmux lobby should default to window scope"
status: open
priority: high
type: bug
labels: [agent-channel, tmux, comms]
created: 2026-05-19
parent: null
blocked-by: []
blocks: []
---

## Context

In `pi/extensions/agent-channel`, tmux lobby resolution currently scopes to tmux session (`tmux/<session>-<hash>`), so all windows in the same session share one lobby.

This causes cross-window presence/channel bleed and confuses agents working on unrelated tasks.

## Problem

Default tmux lobby scope is too broad.

## Acceptance Criteria

- [ ] Lobby scope in tmux is window-scoped (session+window identity)
- [ ] Orientation text clearly states tmux lobby scope
- [ ] Channel visibility defaults align with tmux window scope
- [ ] cmux lobby resolution and behavior are unchanged
- [ ] Tests cover tmux window-scoped behavior and confirm cmux path is unaffected

## Suggested Files

- `pi/extensions/agent-channel/index.ts` (`resolveLobby()` + config plumbing)
- `pi/extensions/agent-channel/README.md`
- relevant tests under `pi/extensions/agent-channel/*.test.ts`

## Notes

No backward-compatibility mode is required for tmux session-scoped lobby behavior.
