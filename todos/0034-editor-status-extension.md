---
title: editor status extension
status: in_progress
priority: medium
type: feature
labels: []
created: 2026-05-16
parent: null
blocked-by: []
blocks: []
---

## Context

Runtime status signals are split across extensions and currently rendered in the footer. `agent-channel` already custom-renders the editor top border for agent name, while `runtime-footer` renders comms and git-diff blocks in the footer.

Desired UX is:
- left side of editor upper border: agent name + optional comms icon
- right side of editor upper border: git-diff info
- lighter footer by default

We need a robust architecture that avoids `setEditorComponent` races where multiple extensions overwrite each other.

## Acceptance Criteria

- [ ] Add a dedicated `editor-status` extension that is the sole owner of `ctx.ui.setEditorComponent`.
- [ ] `editor-status` renders left segment (agent name + optional comms icon) and right segment (git diff summary).
- [ ] `agent-channel` no longer owns editor border rendering; it only publishes state/events consumed by `editor-status`.
- [ ] Define explicit state contract for `editor-status` inputs:
  - [ ] consumed events and payloads are documented (`agent-channel:name` as string name, `agent-channel:comms` as boolean active).
  - [ ] emission guarantees are documented (initial snapshot available on session start; change events emitted on every name/comms change).
  - [ ] `editor-status` is not event-order fragile (renders correctly from current snapshot even if events were emitted before subscription).
- [ ] Git diff formatting logic is shared/extracted so `editor-status` and `runtime-footer` do not duplicate behavior.
- [ ] `editor-status` fallback behavior is explicit and stable:
  - [ ] narrow-width truncation/drop priority is defined (e.g. preserve agent name first, then comms icon, then right-side git diff).
  - [ ] outside git repos, right side is empty with no errors.
  - [ ] git command timeout/failure degrades silently (no crash; layout remains valid).
- [ ] Runtime footer defaults are updated to remove `comms` and `git-diff` from default left blocks while keeping them optional via config.
- [ ] Migration guardrail is defined for roll-out safety:
  - [ ] either temporary compatibility fallback preserves agent-name top-border when `editor-status` is missing,
  - [ ] or docs/settings/bootstrap changes guarantee `editor-status` is enabled whenever `agent-channel` is enabled.
- [ ] Ownership race-safety has an enforceable regression check:
  - [ ] add a static repo check/test asserting only `editor-status` owns `setEditorComponent` in the enabled stack.
  - [ ] specifically assert `agent-channel` no longer calls `setEditorComponent`.
- [ ] `pi/README.md` documents the new UI responsibility split and updated defaults.

## Affected Files

- `pi/extensions/editor-status.ts` — new extension, editor-border status rendering.
- `pi/extensions/agent-channel/index.ts` — remove editor-border rendering responsibility, keep state publishing.
- `pi/extensions/runtime-footer.ts` — consume shared git diff formatter and adjust defaults.
- `pi/extensions/...` shared helper module (new, if needed) — git diff formatting/state helpers.
- `pi/README.md` — docs for new extension and footer default layout changes.

## E2E Spec

GIVEN Pi runs with `agent-channel`, `editor-status`, and `runtime-footer` enabled
WHEN comms are ON and the repo has local git changes
THEN the editor upper border shows agent name + comms icon on the left and git diff summary on the right.

GIVEN comms are OFF
WHEN the editor upper border renders
THEN the comms icon is hidden while agent name and git diff area behavior remains stable.

GIVEN terminal width is narrow
WHEN editor status renders
THEN truncation/drop behavior follows the documented priority without border corruption or jitter.

GIVEN cwd is outside a git repo
WHEN editor status renders
THEN right-side git diff area is empty and no warning/error is shown.

GIVEN git diff collection times out or fails
WHEN editor status renders
THEN rendering degrades gracefully (no exception; valid border output remains).

GIVEN runtime footer uses default config
WHEN status renders
THEN comms and git-diff are not shown in footer defaults, but can be re-enabled via runtime-footer block config.

## Notes

Prefer extracting pure formatting and data-read helpers so the new extension and footer share one canonical git summary implementation.

## Test Targets

- Unit: shared git summary helper (parse/format/cache behavior where pure boundaries allow).
- Integration: agent name + comms on/off state propagation from `agent-channel` into `editor-status` rendering.
- Regression: runtime-footer default block layout drops `comms`/`git-diff`, while explicit config still renders those blocks.
- Static ownership guard: assert only `editor-status` uses `setEditorComponent` in active extension set.
