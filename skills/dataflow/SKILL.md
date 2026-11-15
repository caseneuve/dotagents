---
name: dataflow
description: Visualizes how data moves through a pipeline/call chain using its declared types, as a simple ASCII graph, marking each step as pure or side-effecting (functional-core/imperative-shell) and flagging missing/Any/mismatched types or tangled pure+impure logic. Use when asked to trace or visualize data flow, show how a value's type changes through a chain of functions, check whether pure and side-effecting code are cleanly separated, or spot type/purity gaps in a pipeline.
triggers:
  - data flow
  - trace types
  - visualize the flow
  - type flow
  - show me how this data moves
  - pure vs side effects
  - fcis
---

# dataflow — Visualize Data Flow Expressed as Types

Use this skill to make a pipeline's shape reasonable-about at a glance: what
type enters, what it becomes at each hop, where that story breaks down
(missing annotation, `Any`, or a mismatch between what one function produces
and what the next expects), and where pure transformation ends and
side-effecting code (I/O, mutation, ambient state) begins.

This is a **visualization** tool, not a type checker. Prefer running the
project's real type checker (mypy/pyright) first if one is configured —
this skill's job is to turn that ground truth (or, failing that, the plain
annotations) into something a human can read in one glance, and to call out
anywhere the ground truth is missing.

## Principle — simplest diagram that is still honest

- One node per hop, one edge per data handoff, type label on the edge.
- No node/edge without a real value flowing through real code. Don't editorialize
  or restructure the pipeline to look tidier — draw what's actually there,
  including awkward branches or fan-in/fan-out.
- Every gap gets a visible mark on the diagram itself (inline), not a
  footnote you might miss. A silent "this part's type is unclear" is a
  wrong diagram, not an incomplete one.
- If the true diagram doesn't fit in a simple straight chain (branches,
  loops, fan-out to multiple consumers), draw the branches — don't collapse
  them into a single averaged path.
- Every node also gets a purity mark (see step 3a). This is a
  functional-core/imperative-shell reading of the pipeline, not just a type
  trace: the diagram should make it obvious at a glance where the pure
  transformation logic ends and I/O/mutation begins, and whether the two are
  cleanly separated or tangled together in the same function.

## Procedure

### 1. Identify the pipeline

Pin down the entry point (where the value is created/received) and the exit
point (where it's stored/returned/emitted) the user cares about. If unclear,
ask, or default to one full function call chain the user pointed at.

### 2. Gather real type information, in this priority order

1. Run the project's configured type checker in strict-ish mode if one
   exists (`mypy`, `pyright`) and read its inferred/reported types for the
   values along the chain — this is ground truth, prefer it over guessing.
2. Fall back to static annotations in source (params, return types,
   dataclass/TypedDict fields) via the language helper's script.
3. If a hop has neither — no annotation and the checker can't infer it —
   this is a gap. Do not guess a plausible-looking type to fill it in.

Language-specific helpers:
- Python: **run `scripts/py_typeflow.py` now, before hand-tracing anything.**
  From this skill's directory:
  ```bash
  python3 scripts/py_typeflow.py --root <repo_root> SYMBOL [SYMBOL ...]
  ```
  Do this for every symbol on the chain identified in step 1, in one call.
  This is not optional tooling to consult if convenient — skipping it and
  eyeballing the source is exactly how a function with unresolved/indirect
  calls gets silently misclassified as `pure`. See `languages/python.md` for
  output format and the heuristic's known blind spots.
- (Clojure and others: not yet supported — do a manual read and note this
  explicitly.)

### 3. Walk the chain hop by hop

For each function boundary the value crosses:
- what type does the producer declare/return for it
- what type does the consumer declare/expect for it
- do they match? If not, that's a flagged mismatch, not a note to smooth over
- is the value narrowed, wrapped, or unwrapped along the way (e.g.
  `Optional[X]` checked and narrowed to `X`, or a dataclass field pulled out
  of a container)? Show that as its own edge — narrowing is a real
  transformation, draw it.

#### 3a. Classify each node: pure or side-effecting

For every node (function) in the chain, read its body and classify it:

- **pure** — output is a deterministic function of its inputs; no I/O,
  no mutation of anything outside its own locals, no reliance on
  ambient state (clock, randomness, global/module state, env vars).
- **side-effecting** — performs I/O (DB, network, filesystem, subprocess,
  email/logging), mutates something the caller doesn't own (an ORM object,
  a passed-in mutable container, module/global state), or depends on
  ambient state that isn't passed in as an argument.
- **mixed** — both in the same function body: some lines are pure
  transformation, others are side-effecting, interleaved rather than
  delegated to a sub-call. This is its own flag (step 5), not just a note —
  it's the shape FCIS says to avoid, and the diagram should make it visible
  without the reader having to open the function.

When a language helper exists for the target language (see step 2's
instruction), you must have already run it before this step — use its
output as the starting classification for each node, then confirm borderline
cases (anything it reports as `mixed` or `unknown`) by reading the body
yourself. Never hand-classify a node as `pure` without either running the
helper or reading the full body — "I didn't see an obvious side effect" is
not the same claim as "this is pure," and the diagram must not conflate them.

### 4. Draw the ASCII graph

Keep it small enough to read in one screen. Prefer top-to-bottom or
left-to-right arrows, whichever keeps lines short. Put the type on the edge,
not buried in prose beside it.

```
Order                        Order                        ShipDecision
  {customer, items,           (unchanged)                  (EXPRESS|STANDARD|
   total: float,                                             HOLD_FOR_REVIEW)
   status: Status=PENDING}
      │
      ▼
process_order() [mixed ⚠]──────────────────────────────────────┐
      │                                                         │
      │ stock_rows: list[tuple]  ⚠ Any-shaped (list[tuple],     │
      ▼                            no element schema)           │
  fetch_inventory() [IO: SELECT stock]                          │
      │                                                         │
      ▼                                                         │
  decide_shipping_method(is_express: bool,      [pure]         │
                          is_international: bool) ──────────────┘
```

Use a small, consistent symbol set and only explain symbols actually used,
right below the graph:

```
Legend: ──▶ data handoff   ⚠ gap/mismatch flagged   (unchanged) same type carried through
        [pure] no I/O, deterministic   [IO: <what>] side-effecting, kind noted
        [mixed ⚠] pure logic and side effects interleaved in one function
```

Omit the legend line entirely if the graph uses no symbols beyond a plain
arrow.

### 5. Flag gaps and inconsistencies inline

Mark directly on the edge or node where the problem is, using `⚠` plus a
short label:

- `⚠ untyped` — no annotation present anywhere along this edge
- `⚠ Any` — annotated, but as `Any` or something Any-shaped (`dict`,
  `list[tuple]` with no further schema) that erases the real structure
- `⚠ mismatch: produces X, consumer expects Y` — an actual type
  disagreement between two hops
- `⚠ unchecked Optional` — a value typed `Optional[X]`/`X | None` crosses a
  boundary that uses it as plain `X` without a visible narrowing step
- `⚠ mixed` — a node interleaves pure transformation and side effects in
  the same function body, rather than isolating the side effect behind a
  clearly separate call — flag this even if the types all line up cleanly,
  since it's a structural gap (FCIS violation), not a type gap

Do not silently "fix" or interpret past a gap — show it as it is, and let
the human decide.

## Output format

Ship, by default:

1. **The ASCII graph** — as small as honestly possible, every node marked
   `[pure]` / `[IO: <what>]` / `[mixed ⚠]`, gaps marked inline on edges.
2. **Legend** — only if the graph uses symbols beyond a plain arrow.
3. **Gaps list** — one line per `⚠` on the graph (type gaps and `mixed`
   nodes both included), in case any got missed at a glance:
   `node/edge — what's wrong — why it matters`.

No prose walkthrough of the graph by default. If asked for more detail on a
specific hop, expand just that hop.
