---
title: Validate TmuxBackend end-to-end on Linux
status: open
priority: high
type: chore
labels: [comms]
created: 2026-04-16
parent: null
blocked-by: []
blocks: []
---

## Context

The TmuxBackend was developed and tested on macOS in a tmux session.
All tmux primitives (pane options, border format, display-message) work,
but the full flow — Pi running as a TUI inside tmux, with the extension
auto-configuring pane borders and delivering notifications — has not been
verified on an actual Linux box.

Key things to validate:
- Backend detection: `$TMUX` set + no cmux → TmuxBackend selected
- Lobby resolution: `tmux/<session>-<hash>` derived correctly
- `setup()`: pane-border-status and pane-border-format configured automatically
- `setStatus`/`setProgress`: pane border updates live during agent work
- `teardown()`: original pane state restored on exit
- `notify-send` integration: auto-detected, dunst stack tags work for in-place progress
- Multi-pane: two Pi agents in split panes, each targeting their own `$TMUX_PANE`
- Comms flow: channel_send/watch/ack between agents using tmux lobby

## Acceptance Criteria

- [ ] Pi launches inside tmux on Linux, TmuxBackend is selected
- [ ] Pane border shows `🟢 ready` after `/comms on`
- [ ] `channel_status` updates are visible in pane border in real time
- [ ] `notify-send` fires with dunst stack tags (on systems with dunst)
- [ ] Two agents can communicate via the tmux-derived lobby
- [ ] Pane border is restored cleanly after Pi exits

## Notes

- Can be tested in a podman container with tmux + node installed
- The E2E container already has tmux; may be able to extend `test/Containerfile`
- `notify-send` requires a notification daemon — skip on headless containers, test manually on desktop Linux
