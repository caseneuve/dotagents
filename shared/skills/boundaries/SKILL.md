---
name: boundaries
description: Designs or reviews producer-consumer boundaries so refactors preserve decision-relevant semantics, assign ownership once, create independently provable slices, and cut over safely. Use for RFCs, architecture plans, staged refactors, subsystem replacements, or patches where FCIS and clean types alone do not guarantee a stable seam.
triggers:
  - boundary design
  - refactoring seam
  - staged refactor
  - subsystem replacement
  - producer consumer contract
  - safe cutover
---

# boundaries — Design Change Seams at Semantic Contracts

Use this skill when a change crosses responsibilities or replaces a data/control
path. Map only meaningful producer-consumer boundaries on that path, not every
function call.

## Core rule

Pass the smallest explicit domain contract that preserves every distinction
required by downstream decisions, including absence, zero, uncertainty, failure,
units, and precision. Assign validation, conversion, policy, and effects to one
owner each.

A concrete type or function can be a sufficient seam. Do not add an ABC,
`Protocol`, registry, adapter, or feature flag without a concrete need.

## Procedure

1. **Name the change axes.** State what should vary independently and which
   producer, consumer, policy, reporting, or lifecycle responsibility owns it.
2. **Trace reality.** For existing code, load and use `callgraph` for active paths
   and `dataflow` for types, conversions, and FCIS. Use `invariants` first when
   preservation intent is uncertain.
3. **Map each crossing.** Record:

   | Boundary | Producer | Consumer | Contract | Preserved semantics | Owner(s) | Proof | Cutover |
   |---|---|---|---|---|---|---|---|

4. **Test the boundary.** Ask:
   - Does the contract preserve every state downstream decisions distinguish?
   - Are units, precision, completeness, and failure semantics explicit?
   - Does each responsibility have one owner, with conversions at the true edge?
   - Can producer and consumer be proved separately using the same contract?
   - Could a replacement satisfy the contract without a semantic-loss adapter?
   - At each migration stage, which path is active, mergeable, and removable?
   - Is there exactly one production owner after cutover?
5. **Shape the slices.** Split work at independently provable contracts. A slice
   need not be independently deployable; mark stack-only stages explicitly.
6. **Give a verdict.** Use `sound boundary`, `semantic collapse`, `ownership leak`,
   `misplaced conversion`, `unproven seam`, `unsafe cutover`, or
   `premature abstraction`.

## Output

Return only:

1. the boundary table;
2. one line per failed check: `boundary — verdict — required correction`;
3. a short slice/cutover sequence when migration is involved.

Do not propose implementation details unrelated to repairing a failed boundary.
