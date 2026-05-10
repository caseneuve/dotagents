---
title: emacs on-demand attach bridge for running pi sessions
status: done
priority: medium
type: feature
labels: []
created: 2026-05-09
parent: null
blocked-by: []
blocks: []
---

## Context

Need Emacs to connect on demand to already-running Pi interactive sessions and inject context into the Pi editor buffer (human submits manually). Spawning dedicated `pi --mode rpc` processes from Emacs is not acceptable as the primary workflow. This bridge should be separate from `agent-channel` semantics.

## Acceptance Criteria

- [x] A Pi extension (loaded in normal interactive sessions) exposes a local attach bridge (Unix socket + per-session metadata file) for on-demand attach.
- [x] Emacs can discover attachable Pi sessions, choose one, and attach/detach without restarting Pi.
- [x] Emacs can send buffer/region/cursor context that lands in the Pi editor buffer (append/replace modes), not directly as a session prompt.
- [x] Protocol and docs explicitly keep this bridge separate from `agent-channel` tooling/flows.
- [x] Design documents local IPC security boundaries and fallback behavior when a session is not bridge-enabled.

## Affected Files

- `pi/extensions/emacs-bridge.ts` — local UDS bridge, metadata lifecycle, request methods.
- `shared/emacs/pi-emacs-bridge.el` — session discovery/attach, context send helpers, prompt/location/error helpers.
- `docs/pi-emacs-bridge.md` and `pi/README.md` — protocol and operator workflow docs.

## E2E Spec

GIVEN a Pi interactive session is running with the emacs-bridge extension enabled
WHEN I run Emacs commands to discover and attach to that session
THEN I can send current buffer/region/cursor context and see it inserted into the Pi editor buffer
AND no new Pi process is launched from Emacs.

## Notes

- Implemented bridge methods: `ping`, `get_state`, `insert`, `send_return`, `send_escape`, `clear_editor`.
- Implemented Emacs UX includes: attach/detach, buffer/region send, position DWIM (`path:line` / `path:start-end`), error-at-point send, minibuffer prompt send (with and without location), return/escape/clear helpers.
- Bridge remains separate from `agent-channel` semantics.
- Follow-up item: Pi-side read tools for open buffers and guarded elisp eval support.
