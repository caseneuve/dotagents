---
title: Add static Clojure and Babashka shape-flow evidence
status: open
priority: medium
type: feature
labels: [skills, clojure, babashka, static-analysis]
created: 2026-08-09
parent: null
blocked-by: []
blocks: []
---

## Context

The `dataflow` skill currently has no Clojure/Babashka adapter. For a dynamic
language, its purpose is not type checking: it gives agents deterministic,
source-only evidence about data shapes, data handoffs, and effect boundaries so
they can explain code and test an implementation hypothesis without retaining
the whole implementation in context.

This parent is deliberately split. A single implementation ticket would mix a
source reader, clj-kondo integration, abstract shape interpretation,
interprocedural analysis, optional Spec interpretation, effect analysis, an
EDN protocol, documentation, and tests—too much for independent, consistent
implementation.

## Delivery Plan

- **#0061.1** establishes the static trust boundary, deterministic discovery,
  parser and clj-kondo invocation, CLI/exit contract, and canonical EDN v1
  envelope.
- **#0061.2** adds the baseline shape lattice, lexical and direct-call flow
  semantics, provenance, and deterministic fixtures. It must work with no
  schema library.
- **#0061.3** enriches the baseline only when existing `clojure.spec.alpha`
  source declarations and validation sites can be recognized statically. It
  never adds, loads, or queries Spec at runtime.
- **#0061.4** adds conservative FCIS effect classification and teaches the
  `dataflow` skill to render Clojure shape evidence honestly.

A fresh agent should pick a child in this order. Child tickets, not this parent,
are the implementation units.

## Parent Acceptance Criteria

- [ ] All four child tickets are complete and their canonical tests pass via
      `bb test` and `bb test:ci`.
- [ ] The final helper is source-only: it never requires application
      namespaces, evaluates forms, invokes runtime Spec APIs, instruments
      functions, or writes to the analyzed root.
- [ ] Its output distinguishes proven source facts, declared contracts,
      branch-local validation evidence, and unknown/opaque boundaries. It
      never turns an observed read or an unexecuted declaration into a type
      guarantee.
- [ ] Projects without any schema library receive the same baseline shape-flow
      analysis; Spec is optional enrichment, not a dependency or a suggested
      project change.

## Non-Goals

- Add `clojure.spec`, Malli, or schema declarations to analyzed projects.
- General type checking, arbitrary predicate inference, runtime tracing, or
  support for `.cljc` / `.cljs` in v1.
- A claim that static structure alone validates a concrete runtime scenario.
  The skill still needs a concrete forward trace/test to confirm a hypothesis.

## Relationship to Other Work

#0060 is a sibling callgraph task. It answers which functions call which;
shape-flow answers what known/unknown data crosses those calls. Share a
clj-kondo runner only when it preserves the static trust boundary defined in
#0061.1; neither feature depends on runtime evaluation.

## Notes

The agent-facing output remains the dataflow skill's compact ASCII graph. The
helper's canonical boundary is EDN with enough provenance for the renderer to
avoid overstating what static analysis established.