---
title: runtime-footer ordered rows and extension status blocks
status: open
priority: medium
type: feature
labels: [pi, ux]
created: 2026-07-12
parent: null
blocked-by: []
blocks: []
---

## Context

Pi extensions publish compact UI state through
`ctx.ui.setStatus(key, text)`. The built-in footer renders those statuses, but
`runtime-footer` replaces the built-in footer and currently exposes only a fixed
set of blocks. Although it receives
`FooterDataProvider.getExtensionStatuses()`, arbitrary extension statuses cannot
be placed through configuration and are silently absent.

The current layout has one configurable primary row with `left` and `right`
blocks plus one hardcoded exception: when `branchStatusLine` is enabled,
`runtime-footer` reads the `branch-status` extension status and appends it as a
full-width row below the primary row. This proves multi-row rendering already
works, but the concept is not generalized. Other extensions, such as HOTL
subagent status and cumulative delegated cost, should use Pi's standard
`setStatus` API rather than inventing footer-specific widgets or integrations.

Generalize the footer into ordered rows and make individual Pi extension status
keys first-class blocks.

## Decisions

### Ordered rows

Add a canonical `rows` configuration. Rows render from top to bottom; each row
uses the existing left/right alignment and block rendering behavior:

```jsonc
{
  "rows": [
    {
      "left": ["project", "git-branch", "session-notes"],
      "right": ["model", "cost", "context"]
    },
    {
      "left": ["status:branch-status", "status:hotl"],
      "right": ["status:hotl-cost"]
    }
  ]
}
```

This makes “above” and “below” a consequence of row order instead of adding
special-purpose placement flags. Every row reuses the existing separator,
truncation, explicit separator-token, conditional text, and width-allocation
rules where applicable. A row with no rendered blocks is omitted.

### Extension statuses

- `status:<key>` reads exactly `<key>` from
  `FooterDataProvider.getExtensionStatuses()`.
- A missing or currently empty status renders no block.
- Status text is constrained to one display line and width-safe, consistent with
  Pi's built-in footer treatment.
- Placement is explicit. There is no implicit “render every status” fallback and
  no `status:*` wildcard in this version.
- The same status key may be placed only once across the configured rows.
  Duplicate placement is a clear configuration error rather than duplicated UI.
- Existing named blocks that are backed by a status key (currently
  `session-notes`) remain compatibility aliases and participate in duplicate
  detection against `status:session-notes`.

### Backward compatibility

- Existing configs without `rows` continue to use top-level `left` and `right`
  unchanged.
- Existing `branchStatusLine: true` continues to append the current
  `branch-status` row when `rows` is absent.
- When `rows` is present it is the complete ordered layout. Mixing `rows` with
  legacy `left`, `right`, or `branchStatusLine` is rejected with a clear config
  error; do not silently merge two layout models.
- The generated/default configuration remains behaviorally compatible with the
  current footer until a user opts into `rows`.

## Acceptance Criteria

- [ ] Config accepts a non-empty ordered `rows` array whose entries have ordered
      `left` and `right` block arrays.
- [ ] Rows render top-to-bottom, preserve existing left/right alignment and width
      constraints, and omit rows that have no visible blocks.
- [ ] `status:<key>` renders the current value for that exact Pi extension status
      and disappears when the value is absent or cleared.
- [ ] Status values are sanitized to one line and truncated without broken ANSI
      styling or terminal-width overflow.
- [ ] Status updates made through `ctx.ui.setStatus()` become visible on the next
      render without runtime-footer-specific events or producer integration.
- [ ] Duplicate placement of a status key, including through a compatibility
      alias such as `session-notes`, produces a clear configuration error.
- [ ] Empty/malformed `status:` tokens produce a clear configuration error;
      well-formed but currently unknown status keys are allowed and render
      nothing until their producer appears.
- [ ] No wildcard or automatic all-status rendering is introduced; the config is
      the explicit status filter.
- [ ] Legacy top-level `left`/`right` configs render exactly as before.
- [ ] Legacy `branchStatusLine: true` still renders branch status below the
      primary row when `rows` is absent.
- [ ] Mixing canonical `rows` with legacy layout fields fails clearly rather than
      silently choosing or merging layouts.
- [ ] The config editing command/template and documentation show the `rows` and
      `status:<key>` syntax, migration from `branchStatusLine`, and the explicit
      placement policy.
- [ ] Pure tests cover parsing/validation, row ordering, empty-row omission,
      dynamic status appearance/clearing, duplicate aliases, ANSI/control-text
      safety, truncation, and legacy behavior.
- [ ] Repository formatting and relevant test tasks pass.

## Affected Files

- `pi/extensions/runtime-footer.ts` — parse/validate ordered rows, resolve dynamic
  status blocks, render multiple aligned rows, and preserve legacy layout.
- `pi/README.md` — document row schema, extension status placement, examples,
  compatibility, and migration.
- `test/` — add pure layout/config/render coverage following repository
  conventions.

## E2E Spec

GIVEN two extensions publish:

```text
branch-status = [⋔ review → main]
hotl = subagents 2▶ 0? 1✓
hotl-cost = delegated $0.23
```

AND runtime-footer is configured with a primary row followed by a row containing
`status:branch-status`, `status:hotl`, and `status:hotl-cost`
WHEN the footer renders
THEN the primary row appears first
AND the configured status row appears below it with each value on its configured
side
AND clearing `hotl` removes only that block without requiring a
runtime-footer-specific event.

GIVEN a legacy config with top-level `left`, `right`, and
`branchStatusLine: true`
WHEN the updated extension loads it
THEN its visible layout remains unchanged and branch status remains the second
row.

GIVEN a `rows` config that places `session-notes` and
`status:session-notes`
WHEN configuration is loaded
THEN runtime-footer reports the duplicate status placement clearly and does not
silently render duplicate content.

## Notes

- Pi's existing `setStatus`/`getExtensionStatuses` contract is sufficient; do
  not introduce a footer-specific provider API as part of this item.
- Current branch rendering is implemented by appending
  `statuses.get("branch-status")` after the main `renderFooterLine(...)` result.
  Replace that hardcoded shape only for canonical `rows`; retain the legacy path
  for compatibility.
- This extends completed layout/config work in `0028` and `0035` without
  reopening those items.
- Keep this narrower than `0048`'s possible runtime UI plugin/provider
  architecture. Dynamic status consumption is an existing Pi API, not a new
  provider system.
