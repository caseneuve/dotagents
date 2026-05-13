---
title: pi extensions: migrate imports from @mariozechner to @earendil-works
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

Upstream pi renamed its npm publisher namespace from `@mariozechner/*` to
`@earendil-works/*` somewhere around v0.74. The old directory tree under
`/opt/homebrew/lib/node_modules/@mariozechner/` is gone after the
upgrade.

pi 0.74.0's extension loader (`dist/core/extensions/loader.js`) keeps the
old names alive via a compatibility alias map:

```
"@earendil-works/pi-coding-agent": piCodingAgentEntry,
"@mariozechner/pi-coding-agent": piCodingAgentEntry,
... // same for pi-tui, pi-ai, pi-agent-core
```

So extensions written against the legacy namespace still load on a
restarted pi process — but it is clearly a deprecation shim. Migrate
our extensions to the canonical name now.

## Acceptance Criteria

- [x] All `import ... from "@mariozechner/..."` lines under
      `pi/extensions/` rewritten to `@earendil-works/...`.
- [x] Same rename applied to historical references in `todos/*.md` where
      they were quoting import paths (not where they describe the
      upstream rename itself).
- [x] No `@mariozechner` strings remain in the repo outside
      this todo's context section.
- [x] Live pi restart confirms extensions load cleanly under the new
      names.

## Affected Files

- `pi/extensions/**/*.ts` — import statements
- `todos/0019-pi-upstream-asks-tree-ergonomics.md`,
  `todos/0027-pi-extension-extraction-v1-epic.md` — inline references

## Notes

- Single mechanical commit on master.
- Triggered by user observation that `/reload` failed after a pi
  upgrade because the running process still had `@mariozechner` paths
  cached; the structural fix is to migrate to the new namespace, the
  procedural fix is "fully restart pi after upgrades".
