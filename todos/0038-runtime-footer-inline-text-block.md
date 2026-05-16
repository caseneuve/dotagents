---
title: runtime footer inline text block
status: in_progress
priority: medium
type: feature
labels: []
created: 2026-05-16
parent: 0035
blocked-by: [0037]
blocks: []
---

## Context

Users want lightweight custom literal labels in runtime-footer layout without adding new hardcoded block ids. Proposed syntax in block arrays is `text:<payload>`.

## Acceptance Criteria

- [ ] Add support for block entries with `text:` prefix (for example `text:foo`, `text:bar baz`).
- [ ] Render the payload portion verbatim as a footer block.
- [ ] Empty payload (`text:`) is ignored safely.
- [ ] `text:` blocks can coexist with normal block ids and explicit separator pseudo-blocks.
- [ ] README docs include syntax examples and constraints.

## Affected Files

- `pi/extensions/runtime-footer.ts` — block parser/rendering for `text:` entries.
- `pi/README.md` — config docs and examples.

## E2E Spec

GIVEN footer config left side includes `['text:foo', 'cwd', 'text:bar baz']`
WHEN footer renders
THEN it includes literal blocks `foo` and `bar baz` in that order with normal spacing behavior.

GIVEN footer config contains `text:` with empty payload
WHEN footer renders
THEN that block is skipped with no error.

## Notes

Do not interpret payload as markup; treat it as plain text.

Expected sequencing: implement after `#0037`, since this extends the same token parser and should build on separator-token behavior to reduce merge thrash.
