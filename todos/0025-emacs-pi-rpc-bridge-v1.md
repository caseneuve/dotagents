---
title: emacs on-demand attach bridge for pi editor context
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

- `.pi/extensions/` or `~/.pi/agent/extensions/` — `emacs-bridge` extension.
- Emacs integration package/mode files — discovery, pairing, attach, and editor-context send UX.
- `docs/` — socket protocol, discovery format, and operator workflow documentation.
- `test/` — protocol framing/discovery and attach-to-editor integration tests.

## E2E Spec

GIVEN a Pi interactive session is running with the emacs-bridge extension enabled
WHEN I run Emacs commands to discover and attach to that session
THEN I can send current buffer/region/cursor context and see it inserted into the Pi editor buffer
AND no new Pi process is launched from Emacs.

## Notes

- Keep native Pi file editing tools (`read/edit/write`) as the write path; do not proxy file edits through Emacs.
- Keep bridge protocol/editor-injection semantics separate from `agent-channel`.
- Follow-up item: Pi-side read tools for open buffers and guarded elisp eval support.
