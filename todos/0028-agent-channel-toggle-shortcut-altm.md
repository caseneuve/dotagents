---
title: agent-channel: change default toggle shortcut from ctrl+shift+m to alt+m
status: done
priority: medium
type: chore
labels: []
created: 2026-05-13
parent: null
blocked-by: []
blocks: []
---

## Context

The `agent-channel` extension registers `Ctrl+Shift+M` as the default
shortcut for toggling comms on/off (`pi/extensions/agent-channel/index.ts`).

This chord is hostile to Linux terminals:
- `Ctrl+M` is identical to `CR` (Enter) in the legacy TTY encoding, so
  without the Kitty keyboard protocol most terminals can't distinguish
  `Ctrl+Shift+M` from plain `Enter`.
- gnome-terminal, konsole, and others bind `Ctrl+Shift+M` to terminal-native
  actions (toggle menubar, etc.), so the chord never reaches pi.
- It worked on macOS because iTerm2/Kitty/Ghostty/WezTerm enable the Kitty
  keyboard protocol by default.

Switch the default to `alt+m`, which is unambiguous on legacy terminals
(no `Ctrl+M`/Enter collision) and free in common Linux terminal default
bindings. The `/comms [on|off]` command remains as the always-works
fallback, and users can rebind via `~/.pi/agent/keybindings.json`.

## Acceptance Criteria

- [ ] `pi.registerShortcut("alt+m", …)` replaces the `ctrl+shift+m`
      registration in `pi/extensions/agent-channel/index.ts`.
- [ ] Comment above the registration mentions `Alt+M`, not `Ctrl+Shift+M`.
- [ ] `pi/extensions/agent-channel/README.md` shortcut table reflects
      `Alt+M`.
- [ ] No other docs/code reference the old chord.
- [ ] Manual smoke: shortcut fires on Linux gnome-terminal and on macOS
      iTerm2 (or equivalent) — toggles comms and prints the expected
      notice.

## Affected Files

- `pi/extensions/agent-channel/index.ts` — change registration + comment
- `pi/extensions/agent-channel/README.md` — update shortcut table

## Notes

Single-commit change. Per AGENTS.md this is a UX contract change to a
shipped default, so we file a todo rather than treating it as a chore
typo. Branch name: `0028-agent-channel-toggle-shortcut-altm` if a branch
is used; otherwise land directly on master since it's one commit.
