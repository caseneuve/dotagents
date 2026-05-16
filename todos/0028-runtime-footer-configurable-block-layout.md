---
title: runtime-footer configurable block layout
status: done
priority: medium
type: feature
labels: [pi, ux]
created: 2026-05-12
parent: null
blocked-by: []
blocks: []
---

## Context

`runtime-footer` currently has a fixed layout. We want users to choose which
components are shown, on which side (left/right), and in what order.

## Acceptance Criteria

- [x] Footer supports a user config file declaring ordered `left` and `right` block lists.
- [x] Unknown block ids are ignored safely.
- [x] Default behavior matches current footer when config is absent.
- [x] Config updates are picked up without restarting Pi (reload/session reload acceptable).
- [x] README documents config path and available block ids.
- [x] extension provides slash command to set the config

## Affected Files

- `pi/extensions/runtime-footer.ts` — configurable block rendering.
- `pi/README.md` — configuration docs.

## Notes

Keep this as an incremental local improvement; extraction/rewrite lives under epic `0027`.
