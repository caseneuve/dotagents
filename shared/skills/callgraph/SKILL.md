---
name: callgraph
description: Validates an RFC, design doc, or patch by rebuilding the real call graph of the code it touches and forward-tracing concrete scenarios through it, instead of checking backward reachability alone. Use when asked to validate a design/RFC's claims, draw a call graph for a proposed fix, or check whether a change actually works for a specific real-world case.
triggers:
  - call graph
  - validate this rfc
  - validate this design
  - trace this scenario
  - will this actually work
  - validate the fix
---

# callgraph — Validate a Proposed Implementation Against Reality

Use this skill when asked to check whether an RFC, design doc, patch, or plan
actually does what it claims. It produces two things: the **real** call graph
of the code the change touches (not the one the doc describes), and a
per-claim verdict from **forward-executing concrete scenarios** through that
graph.

## Core principle — forward, not backward

The failure mode this skill exists to prevent: confirming a function is
*reachable* from N call sites (backward/structural check) and reporting a
claim as "correct" without ever confirming that a *specific real-world case*
actually *takes the path* that reaches it (forward/scenario check).

Reachability-in-general is a much weaker claim than "this concrete state's
control flow reaches the changed code." A design can be fully reachable and
still never fire for the exact population it was written for, if an
early-return/guard/other branch intercepts that population first.

**Rule: no claim gets a "Confirmed" verdict from call-graph structure alone.**
Structure only tells you what to trace. Every claim needs at least one
concrete scenario hand-executed end-to-end before it can be marked confirmed.

## Inputs required before starting

Refuse to produce a "Confirmed" verdict for any claim until you have:

1. The proposed diff/design/RFC text.
2. At least one **concrete real-world instance** to trace — specific
   values, not "an account" or "a request." If the source doc only
   describes things abstractly, build a concrete instance from any example
   it cites, from existing tests/fixtures in the repo, or by asking the user.
   No concrete instance → the claim can only get a `Structural only` verdict
   (see Verdicts below), never `Confirmed`.

## Procedure

### 1. Extract claims

List every discrete, falsifiable claim made by the design doc as its own
row — not "the design is correct" but each individual assertion ("X is
self-healing", "Y requires no separate migration", "Z's existing tests still
apply unchanged"). Vague or non-falsifiable statements get flagged, not
traced.

### 2. Build the real call graph

For every symbol the change adds, removes, or modifies: find every actual
caller and callee in the **current repository**, not the ones implied by the
doc's prose. **Run the language-specific helper script now** rather than
trusting the doc's own "blast radius" table or eyeballing/grepping by hand
— that table is itself an unverified claim, and manual grep misses aliased
imports. Follow renamed re-export chains manually; the helper does not resolve
them transitively.

Language-specific instructions:
- Python: run, from this skill's directory:
  ```bash
  python3 scripts/py_callers.py --root <repo_root> SYMBOL [SYMBOL ...]
  ```
  for every symbol identified above, in one call. See `languages/python.md`
  for output format and the script's known blind spots (dynamic dispatch,
  decorators, cross-package boundaries) — those still need a manual read.
- (Clojure and others: not yet supported — do a manual grep/read pass and
  note this explicitly in the output's scope-limitations section.)

Record, per changed symbol: its direct callers, its direct callees, and any
*other code path that computes or asserts the same fact* (e.g. two different
queries/signals that both answer "is this locked/valid/enabled"). This last
category is the one most likely to hide a divergence bug — always look for
it explicitly, don't wait to stumble on it.

Also track **constant/config flow**, not just control flow: any timeout,
threshold, retry count, feature flag, or limit the design claims a value for.
Find its actual definition site and follow it through every hop (default
param, env var, settings override, decorator-injected value, hardcoded
constant shadowing it downstream) to the place it's actually used. A call
graph can be fully correct while the constant the doc claims is in effect
never reaches the call site, or is overridden partway there — treat this as
its own claim to verify, not an assumption to wave through.

### 3. Instantiate concrete scenarios

Pick 2-3 scenarios, minimum:

- **The motivating case** — whatever concrete example the bug report/RFC
  cites, in its exact cited state. If none is cited, build one from a real
  fixture/test/data sample in the repo.
- **The already-correct/boundary case** — a state that should require no
  action. Confirm the change actually leaves it alone (or, if it's meant to
  act on it, confirm it does).
- **The dual-signal/adversarial case** — a state where two different
  signals for the same fact would disagree if only one of them is updated
  by the change. Construct this whenever step 2 turned up more than one
  code path answering the same question.

### 4. Trace forward, from the real entry point

For each scenario, start execution at the real entry point (cron job,
request handler, CLI command) — **not** at the changed function. Walk the
control flow one step at a time using the scenario's actual concrete values.

At every conditional, guard, or early-return:
- write down the actual value being tested (computed from the scenario, not
  a placeholder)
- state which branch it takes and why
- if the value is a timeout/threshold/limit/flag the design makes a claim
  about, confirm it's the value actually in effect at this point (not a
  default or override shadowing it) — don't assume the constant from step 2
  survived unchanged to here
- if the branch is an early-return / no-op / "nothing to do" path, treat
  that as an explicit claim ("this case needs no action") and don't move on
  until you've confirmed that claim is true for *this* scenario. This step is
  the one most reviews skip — do not skip it.

Continue until the trace reaches the changed code, or terminates without
reaching it. Both outcomes are useful data — write the full transcript, not
a summary of it.

### 5. Validate generated code, not just prose

If the design embeds any generated code (SQL, shell, API payloads, config),
never treat it as illustrative. Verify it against the target's real
grammar/API — run it in a sandbox, check it against existing passing tests
that exercise the same call, or explicitly mark it `Unverified — not
executed` if you cannot. A syntactically-plausible-looking string is not
evidence.

### 6. Verdict per claim

One row per claim from step 1. Verdict must be one of:

| Verdict | Meaning |
|---|---|
| `Confirmed` | Traced end-to-end against a concrete scenario; branch taken checked explicitly |
| `Structural only` | Call graph supports the claim but no scenario was traced through it |
| `Contradicted` | A traced scenario does not reach the code the claim depends on, or reaches contradictory code |
| `Unverified — generated code` | Claim depends on generated code/SQL that was not executed or grammar-checked |

`Structural only` is not a passing grade — it means "not yet checked," and
should prompt either a scenario trace or an explicit call-out that one is
still needed.

## Output format

Default output must be succinct. Do the full work described in steps 1-5
(build the real graph, hand-trace every scenario, check generated code) but
**do not dump the scenario transcripts by default** — keep them in scratch
notes and only paste one in if asked. What ships by default:

1. **Call graph(s)** — one indented tree per changed symbol, callers above
   it, callees/other-signal-paths below it, one line per node. Annotate a
   node only when its role isn't obvious from the name (e.g. "gates every
   caller behind `is_authorized`"). No prose paragraphs here.

   ```
   get_state()                          [module/file.py:42]
   ├─ called by process_case_a()
   ├─ called by process_case_b()
   ├─ called by get_aggregated_state()
   │   ├─ called by caller_x()
   │   └─ called by caller_y()
   └─ other signal: get_state_alt_source()   # reads underlying store directly, bypasses this fn's filtering
   ```

2. **Verdict table** — one row per claim, columns `claim | verdict`, no
   evidence column by default (one clause inline if truly needed). Full
   evidence/trace available on request, not shown unprompted.

3. **Scope note** — one line, only if something got `Structural only` or
   `Unverified` and needs a caveat. Omit entirely if everything was traced.

If the user asks for detail on a specific claim or scenario afterward,
produce the full step-by-step transcript for *that one* — don't re-dump
everything.
