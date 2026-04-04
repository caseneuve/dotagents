---
title: Build a Python-first Tree-sitter POC for Pi with an extensible tool architecture
status: open
priority: medium
type: feature
created: 2026-04-04
parent: null
blocked-by: []
blocks: [0006.1, 0006.2, 0006.3, 0006.4]
---

## Context

We want to evaluate whether Tree-sitter can materially improve how Pi agents
explore and work in complex codebases. The first experiment should stay small:
a Python-first proof of concept that adds syntax-aware inspection tools without
committing us to a Python-only design or to AST-driven edits too early.

The POC should prove three things:

- a Pi extension can load and use Tree-sitter reliably in the extension runtime
- the resulting tools are genuinely useful for agent workflows such as outlining
  files, locating enclosing context, and finding structural matches
- the implementation leaves a clean path to a future beta with additional
  language adapters and a stable tool surface

This epic tracks the design, implementation spike, workflow validation, and
follow-up documentation needed to decide whether Tree-sitter belongs in the
canonical Pi setup for this repo.

## Acceptance Criteria

- [ ] There is one documented canonical POC architecture for a Pi Tree-sitter
      extension, with Python as the first supported language and a clear
      adapter boundary for future languages.
- [ ] The POC exposes at least one useful syntax-aware tool that an agent can
      use during normal work, with output shaped for compact agent consumption.
- [ ] The implementation includes a Python parser-loading spike plus enough
      functionality to evaluate outline, context, and structural-find
      workflows.
- [ ] The work remains read-only and inspection-oriented for the first version;
      it does not overreach into semantic refactoring or AST-based writes.
- [ ] The repo documents how to evaluate the POC in real tasks and what would
      justify expanding it into a broader beta.

## Affected Files

- `pi/extensions/` — new Tree-sitter extension and helper modules
- `pi/README.md` — user-facing notes if the extension becomes part of the repo
- `README.md` — only if top-level workflow/docs should mention the POC
- `test/unit/` — pure parser/adapter/output-shaping tests where practical
- `test/e2e/` — smoke coverage if the extension workflow is exercised end to end

## E2E Spec

GIVEN a Python file in a non-trivial repository
WHEN a Pi agent uses the Tree-sitter POC tools
THEN it can retrieve a compact file outline, inspect enclosing syntax context,
and locate structural matches more precisely than plain text search alone

GIVEN the Python-first POC implementation
WHEN we review the architecture and docs
THEN there is an obvious path to add more languages later without redesigning
all tool contracts

## Notes

Prefer a Pi-native TypeScript extension first, and only fall back to a helper
process if Node-side parser integration proves too painful. Keep the first
version focused on proving workflow value, not on building a full IDE or LSP
replacement.
