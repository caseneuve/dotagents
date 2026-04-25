---
title: pi upstream asks for tree-widget ergonomics
status: open
priority: low
type: chore
labels: []
created: 2026-04-25
parent: null
blocked-by: []
blocks: []
---

## Context

Three friction points hit while building the `assistant-outline` picker
(commits `2b3d5d3`, `66d73af`) that would be cleaner to fix upstream in
`@mariozechner/pi-coding-agent` than to keep working around in every
extension that consumes the session tree.

None are blocking for us today. File these with pi's maintainer when
we next have a reason to touch upstream, or leave parked.

## Ask 1 — re-export `SessionTreeNode` from the top-level package

`SessionTreeNode` is only exported from the deep path
`@mariozechner/pi-coding-agent/core/session-manager`, which extensions
should not reach into. Today we derive it via
`ReturnType<SessionManager["getTree"]>[number]` — works, but clumsy.

Any extension that constructs or filters tree nodes needs this type.
One-line upstream fix:

```ts
// @mariozechner/pi-coding-agent/dist/index.d.ts
export type { SessionTreeNode } from "./core/session-manager.js";
```

## Ask 2 — add `"assistant-only"` to the `FilterMode` union in `TreeSelectorComponent`

Current union: `"default" | "no-tools" | "user-only" | "labeled-only" | "all"`.
No way for an extension to request "assistants only" as the default
view. Extensions that need it have to pre-filter the tree themselves
(what `assistant-outline` does).

Two layers of work upstream:
1. Add the enum variant.
2. Implement the filter in `TreeSelectorComponent`'s internal
   `applyFilter()` so the variant actually suppresses non-assistants.

Doesn't remove the need for `isPickableAssistant`-style
extension-specific predicates (completion + non-empty text checks are
product-level), but does give other extensions a cheap coarse default.

## Ask 3 — config-object constructor for `TreeSelectorComponent`

Current signature:

```ts
constructor(
  tree: SessionTreeNode[],
  currentLeafId: string | null,
  terminalHeight: number,
  onSelect: (entryId: string) => void,
  onCancel: () => void,
  onLabelChange?: (entryId: string, label: string | undefined) => void,
  initialSelectedId?: string,
  initialFilterMode?: FilterMode,
)
```

Passing `undefined` for `onLabelChange` just to reach `initialSelectedId`
is fragile — if pi reorders optional slots the call site breaks
silently. A config-object variant would make call sites self-documenting:

```ts
constructor(options: {
  tree: SessionTreeNode[];
  currentLeafId?: string | null;
  terminalHeight: number;
  onSelect: (entryId: string) => void;
  onCancel: () => void;
  onLabelChange?: (entryId: string, label: string | undefined) => void;
  initialSelectedId?: string;
  initialFilterMode?: FilterMode;
})
```

Positional signature can be kept as a wrapper for backward compat.

## Acceptance Criteria

- [ ] Upstream issue or PR filed for each ask (links back to this todo).
- [ ] When/if the asks land, `assistant-outline/picker.ts` updates
      to drop the `ReturnType<...>` derivation, drop the `undefined`
      skip-slot, and potentially drop the pre-filter if
      `"assistant-only"` + `isPickableAssistant` composition becomes
      expressible via the filter mode.

## Affected Files

- `@mariozechner/pi-coding-agent` (upstream) — not this repo.
- `pi/extensions/assistant-outline/picker.ts` — the downstream consumer
  that would simplify if upstream lands.

## Notes

- Identified during the round-8 code review (ksu8) of commits
  `2b3d5d3` + `66d73af`.
- Priority `low` because all three have workarounds that ship today.
  Revisit when any extension needs similar tree-widget access.
