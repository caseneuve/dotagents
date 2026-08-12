---
name: invariants
description: Discovers and records the constraints a narrow code change must preserve before editing, then audits the diff against them. Use before changing unfamiliar or mature code when the task lacks full business context, when a "small fix" invites refactoring, or when reviewing whether a patch violated existing contracts, guards, ordering, compatibility, security, or scope boundaries.
triggers:
  - invariants
  - preserve behavior
  - what must not change
  - hidden constraints
  - scope fence
  - avoid unrelated refactors
  - invariant audit
---

# invariants — Recover the Change Contract Before Editing

Use this skill before planning or editing a narrow behavior in existing code.
Its job is not to make the code cleaner. Its job is to establish the smallest
safe change surface and the constraints that surface must continue to satisfy.
It can also audit an existing patch.

## Non-negotiable rule — minimum necessary change

Unless the task explicitly authorizes broader work:

- Edit only artifacts on the demonstrated call, data, contract, build, or test
  path from the relevant entry point to the requested outcome.
- Preserve identified observable contracts and affected scenarios the task
  does not explicitly change.
- Do not rename, move, generalize, deduplicate, upgrade, or "clean up" adjacent
  code merely because the current implementation looks awkward. Run required
  formatters on touched code, but do not include unrelated formatting churn.
- A refactor is allowed only when it is necessary for the requested behavior.
  State why it is necessary, keep it local, and add focused checks for old
  behavior the task did not authorize changing.
- If the necessary path expands, update the scope fence with evidence before
  editing the newly included code. Do not silently grow the task.

This is the default change invariant even when the repository never wrote it
down. Existing code may be imperfect; that does not authorize drive-by repair.

## What analysis can and cannot recover

At a fixed repository state, static helpers can reproducibly recover **facts
within their analysis model**: resolved caller candidates, branches, types,
defaults, schemas, assertions, test references, effects, and source history.
Reflection, dependency injection, callbacks, generated code, external
consumers, and runtime dispatch can make that evidence incomplete. Static
analysis cannot, by itself, prove **why** a fact exists or whether the business
still wants it.

Keep those two claims separate:

- `fact confidence` — how certain are we that the behavior/constraint exists?
- `intent confidence` — how certain are we that it is a requirement to
  preserve, rather than an accident or obsolete behavior?

A guard seen in reachable code has high fact confidence. Its intent confidence
is only high when supported by an active requirement, public contract,
focused test, explicit rationale, or user confirmation. Never turn "the code
currently does X" into "the business requires X" without that second kind of
evidence.

There is deliberately no universal `detect_invariants` script in this skill.
Such a script could deterministically list candidates but could not classify
business intent without inventing certainty. Reuse the repository's analysis
helpers to collect evidence; make the preservation decision explicit and
reviewable.

## Evidence grades and authority

Record all material corroborating or conflicting evidence for each ledger row,
not only the strongest item. Grade every item and cite a stable location:
`path:line`, symbol, test name, schema pointer, task section, or commit.

| Grade | Evidence | What it supports |
|---|---|---|
| `A specified` | Current task/user statement, repository policy, active spec/RFC, documented public contract | Intended requirement within its stated scope |
| `B enforced` | Active, applicable focused test/assertion, type or schema, validator, database constraint, protocol/API check | Mechanically enforced behavior; intent still depends on what the check actually says |
| `C implemented` | Reachable guard/branch/default/order/effect, caller behavior, explicit historical rationale | Current behavior; history supports intent only when the rationale is explicit |
| `D inferred` | Naming, repetition, symmetry, age, absence of code, broad integration behavior | Hypothesis only; never enough by itself to justify broadening a change |

Evidence grade is not source authority. Determine which source owns the
contract in dispute: repository-wide policy and active security/data/public
contracts constrain a local task; the task's acceptance criteria authorize the
requested delta within those constraints; tests and implementation describe
behavior but cannot silently waive a higher-scope contract. Do not assume the
newest source wins or that a local request can authorize a privacy, money,
destructive-write, migration, or public-compatibility break. When applicable
authoritative sources disagree, record `conflict—stop` and ask the relevant
owner. A stale or inapplicable lower-grade artifact should be recorded as such,
not allowed to block work without explanation.

## Choose the proportional mode

- **Lightweight (default for a private, local, low-risk leaf change):** perform
  steps 1-2, inspect applicable policy/contracts, the touched control/effect
  path, and focused tests, then write only affected ledger rows. Use history
  only when intent remains uncertain.
- **Full:** use every evidence category and deeper caller/data tracing for
  shared utilities, public interfaces, persistent data, security/privacy,
  money, destructive effects, concurrency, migrations, compatibility,
  unresolved dynamic behavior, or any proposed refactor.
- **Patch audit:** start with the complete diff, derive a scope candidate from
  each hunk, then trace outward to entry points and contract surfaces. A file's
  presence in the patch is not evidence that it belongs in scope.

Never choose lightweight mode merely because the task is described as small.
State the chosen mode and why.

## Workflow

### 1. Restate the requested delta

Write one sentence for each:

- **Current:** the observable behavior relevant to the report.
- **Requested:** the observable behavior the task authorizes changing.
- **Unchanged:** callers, inputs, outputs, effects, interfaces, and adjacent
  flows that have not been authorized to change.

Use concrete scenarios, not goals such as "make this robust" or "clean up the
flow." If the requested behavior itself is ambiguous, ask before continuing.

### 2. Establish the scope fence

Record:

- real entry point(s)
- target symbol(s) and state/data involved
- affected callers and callees
- files currently justified for editing, with one reason each
- explicit non-goals and no-touch areas
- unknown paths or dynamic dispatch that analysis cannot resolve

Build the affected slice before reading widely or proposing architecture:

- Load and use `callgraph` when available for callers/callees, then
  forward-trace at least the motivating scenario from the real entry point.
  Reachability alone is not proof that the scenario takes that path.
- Load and use `dataflow` when available if values, types, defaults, ordering,
  mutation, I/O, or ambient state may change.
- Load and use `testmap` when available for a quick static test-location check,
  but do not call its reference results behavioral coverage.
- When a helper or language adapter is unavailable, inspect definitions, exact
  symbol references, imports, dispatch tables, and real entry points manually;
  state the analysis limitation rather than implying completeness.

Bound traversal to branches exercised by the motivating and boundary
scenarios, direct contract consumers, and the first relevant side-effect or
public boundary. Expand only when evidence shows the changed value or effect
continues farther. Do not include a file because it is "related" by name.
Include it only when a call, data, contract, configuration, generated artifact,
build, or required test path connects it to the requested delta.

### 3. Harvest invariant candidates

Inspect only the affected slice and its contract surfaces. In full mode, check
each category. In lightweight mode, mark non-applicable categories `skipped —
<reason>` rather than implying they were searched; for searched categories,
write `none found` rather than silently skipping them.

1. **Repository and task policy** — `AGENTS.md`/`CLAUDE.md`, issue/RFC,
   ownership rules, generated-code instructions, compatibility promises.
2. **Interfaces and data** — function signatures, public exports, CLI/API
   shapes, types, schemas, serialization, defaults, nullability, units,
   ordering, uniqueness, migration and backward-compatibility rules.
3. **Control and safety** — validation, authorization, feature flags,
   early returns, error classes/messages, resource limits, transactional
   boundaries, cleanup, idempotency, retry/timeout behavior.
4. **Effects and sequence** — reads/writes, emitted events, logging/auditing,
   external calls, mutation ownership, lock/commit ordering, exactly-once or
   at-least-once expectations.
5. **Tests and examples** — focused positive, negative, boundary, regression,
   and snapshot/contract cases. Read assertions and fixtures; a test name or
   symbol reference is not enough.
6. **History and rationale** — only when present locally. Use targeted history,
   for example:

   ```bash
   git blame -L <start>,<end> -- <file>
   git log --follow -- <file>
   git log -S'<exact token>' -- <relevant paths>
   git log -G'<relevant regex>' -p -- <relevant paths>
   ```

   Blame and code age identify where to investigate; they do not prove a
   requirement. A commit supports intent only when its message or diff states
   the reason clearly. Do not fabricate business rationale from a plausible
   patch.

Look especially for negative invariants: what must **not** happen, who must not
see data, which input must not be accepted, which side effect must not occur,
and which path must remain a no-op. Agents often preserve the happy path while
breaking these.

### 4. Build the invariant ledger

Create one falsifiable statement per row. Avoid vague rows such as "maintain
backward compatibility." State the state, operation, and required result.

```markdown
## Invariant ledger

| ID | Invariant | Kind | Applies to | Evidence | Fact | Intent | Disposition | Preservation check |
|---|---|---|---|---|---|---|---|---|
| I1 | Unauthorized callers receive no record and emit no audit event | security/effect | lookup entry point | B `test_lookup.py:81`; C `lookup.py:42-49` | high | high | preserve | focused negative test |
| I2 | Missing cache entries return `None`, not an exception | interface | direct callers A/B | C `cache.py:27`; D caller pattern | high | medium | candidate—confirm | characterization test or user answer |
```

Allowed dispositions:

- `preserve` — the task does not authorize changing it and evidence makes it a
  contract.
- `change-authorized` — the requested delta explicitly changes it; add a check
  for the new invariant.
- `candidate—confirm` — fact exists, preservation intent is uncertain and the
  proposed implementation would affect it.
- `conflict—stop` — authoritative sources disagree, or the task appears to
  violate a safety/public/data contract.

Every `preserve` or `change-authorized` row needs a concrete check: an existing
focused test, a new test, a type/schema/static check, or a hand-traced scenario
when execution is impossible. "Code review" alone is not a check for a
behavioral claim.

### 5. Decide before editing

Proceed only when:

- every proposed edit maps to the requested delta or to one ledger check
- no `conflict—stop` row remains
- every affected `candidate—confirm` has been answered, or the implementation
  is changed so it cannot affect that candidate
- high-risk constraints (authorization, privacy, money, destructive writes,
  concurrency, migrations, public compatibility) have both a preservation
  disposition and a concrete check
- unresolved analysis gaps cannot affect a high-risk or public boundary; if
  they might, obtain owner/user confirmation, isolate the change from the gap,
  or record `conflict—stop`

Ask a narrow question that includes the evidence and consequence. Do not ask
"should I preserve existing behavior?" Ask, for example: "The current public
schema and two callers accept a missing `region` (`schema.json:18`,
`client.py:44`). This task does not mention that case, but option B would reject
it. Must missing `region` remain valid?"

### 6. Implement inside the fence

Keep the ledger visible while editing. For each tempting cleanup, ask:

1. Is it required to produce the requested observable delta?
2. Is it on the demonstrated call/data/contract path?
3. Which ledger row proves its old behavior is preserved?

If any answer is missing, leave it alone or propose it as separate work. Do not
weaken a guard, assertion, type, schema, or test merely to make the chosen
implementation pass. An old test may change only when its exact asserted
behavior is `change-authorized`, and replacement coverage must enforce the new
contract.

### 7. Audit the resulting diff

After editing—or first, in patch-audit mode—inspect the whole diff rather than
only the intended hunk:

```bash
git diff --stat
git diff --function-context
git diff --check
```

Then:

- Map every changed hunk to the requested delta or an invariant check. Revert
  unmapped hunks.
- Re-run the concrete entry-point scenarios and each ledger preservation check.
- Compare changed signatures, defaults, branches, guards, errors, schemas,
  effects, and operation order against the ledger.
- Confirm no generated file, dependency, public export, caller, or unrelated
  formatting changed accidentally.
- If the diff revealed a new path or candidate invariant, return to the scope
  fence; do not rationalize it after the fact.

Passing tests is necessary evidence, not permission for extra semantic change.

## Output format

Default output is concise and appears **before implementation**:

1. **Mode** — lightweight / full / patch audit, with one-clause rationale.
2. **Requested delta** — Current / Requested / Unchanged, one bullet each.
3. **Scope fence** — entry point, affected slice, allowed files, no-touch areas,
   and analysis limits.
4. **Invariant ledger** — the table from step 4.
5. **Questions/conflicts** — only unresolved items; omit when empty.
6. **Edit contract** — allowed edits and required checks, one line each.

After implementation, append:

7. **Verification** — `invariant | check run | pass/fail/unverified`.
8. **Diff audit** — `hunk/file | authorized by | invariants checked | verdict`,
   with verdict `within fence`, `unproven`, or `violates I<n>`. Patch-audit
   mode produces this directly without pretending implementation was performed.

Do not pad the ledger with every fact found in the code. Include constraints the
proposed change could affect, plus high-risk boundary constraints on the same
path. The goal is a small, evidence-backed change contract—not a speculative
business-requirements document.

## Failure modes this skill prevents

- **Optimization as authorization** — a simpler design is not permission to
  change more behavior.
- **Current behavior as invented intent** — implementation facts and business
  rationale are different claims.
- **Happy-path tunnel vision** — no-op, denied, missing, repeated, and partial
  states need preservation checks too.
- **Graph-only confidence** — structural reachability does not prove a concrete
  scenario takes the path.
- **Tests as total specification** — tests sample contracts; they do not make
  unasserted changes safe.
- **History mythology** — old code and blame metadata do not imply deliberate
  design.
- **Scope laundering** — calling a drive-by refactor "necessary" without
  tracing it to the requested outcome.
