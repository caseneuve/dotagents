---
title: Add deterministic Clojure and Babashka callgraph evidence
status: open
priority: medium
type: feature
labels: [skills, clojure]
created: 2026-08-08
parent: null
blocked-by: []
blocks: []
---

## Context

The callgraph skill has a Python static-analysis helper but tells Clojure and
Babashka users to use manual grep/read passes. Grep is not adequate evidence
for validating architecture, design, implementation, or refactor claims: it
cannot reliably resolve namespace aliases, `:refer` bindings, lexical
shadowing, threading macros, or the difference between a var reference and a
source-level invocation.

Provide a deterministic Clojure/Babashka helper backed by `clj-kondo`. The
helper supplies normalized **static invocation evidence**; it does not claim to
reconstruct runtime control flow and never replaces the skill's required
concrete, forward scenario trace before a claim can be `Confirmed`.

## Goals

- Give agents repeatable, namespace-aware evidence for requested fully
  qualified vars in a Clojure/Babashka project.
- Make the same source contents, root project kondo configuration, kondo
  version, requested targets, and flags yield byte-stable, sorted,
  root-relative output.
- Emit compact versioned EDN instead of grep matches or raw kondo JSON, with
  canonical omission semantics for empty evidence.
- Separate proven source-level invocations from references, macro boundaries,
  and runtime-dispatch candidates.
- Make missing ownership, analyzer errors, and unsupported dynamic behavior
  explicit rather than silently treating them as ordinary calls.

## Non-Goals

- Prove a design claim from graph structure alone; agents must still trace a
  concrete scenario from a real entry point.
- Execute application code or evaluate project macros.
- Resolve higher-order invocation, `eval`, runtime receiver types, protocol or
  multimethod dispatch, dependency-injection registries, or other dynamic
  control flow.
- Support `.cljc` or `.cljs` in v1. Reader-condition branches require an
  explicit platform contract and must not be silently merged.
- Provide a grep or custom-source-parser fallback when `clj-kondo` is
  unavailable.
- Render the EDN graph as Markdown. The callgraph skill remains responsible for
  its succinct human-facing call trees and verdict table.

`clj-kondo` may execute checked-in `.clj-kondo` hooks in its sandbox while
analyzing trusted repositories. This is distinct from executing application
code, but must be disclosed in the language guide.

## Required Design Contract

### CLI

Canonical invocation:

```bash
bb <path-to-skill>/scripts/clj_callers.clj \
  --root <project-root> \
  [--production-only] \
  namespace/var [namespace/var ...]
```

- `--root` is required and is resolved to a canonical directory.
- At least one target is required.
- Every target must parse as a symbol with both a namespace and a non-empty
  name. Bare names are rejected; matching is always exact on the parsed
  namespace and name. Do not validate by counting `/` characters because `/`
  itself is a valid Clojure var name (for example `clojure.core//`).
- Duplicate targets are deduplicated and targets are reported in lexical order,
  so argument order cannot affect output.
- Stdout is reserved for the canonical EDN report. Diagnostics go to stderr.

### File discovery

Do not pass the project directory directly to kondo: a directory scan includes
`.clj`, `.cljc`, and `.cljs` while omitting `.bb`, which violates this task's
scope.

The helper must instead discover inputs itself:

- recursively include non-symlink regular files ending in `.clj` or `.bb`;
- ignore `.cljc`, `.cljs`, and every other extension;
- do not follow file or directory symlinks;
- exclude files beneath any root-relative path component beginning with `.`;
  this keeps `.git`, `.clj-kondo` hook sources, and similar metadata out of the
  graph while still allowing `.clj-kondo` to configure analysis;
- normalize relative paths with `/` separators and sort them lexically before
  invoking kondo.

By default, production and test sources are included. `--production-only`
filters input files **before** analysis when either condition holds:

- a root-relative directory component is exactly `test` or `tests`; or
- the basename without extension starts with `test_` or ends with `_test`.

The same rules apply to `.clj` and `.bb` files. No other directories such as
`dev`, `examples`, or `fixtures` are excluded implicitly.

### Kondo invocation

- The supported test runtime pins `clj-kondo v2026.01.19`.
- User installations may run another version; the helper strips the
  `clj-kondo v` prefix and records the remaining version string. If the version
  cannot be detected, preflight fails. Determinism is promised only for
  repeated runs with the same version.
- Invoke kondo with JSON output, `--cache false`, `--repro`, `--fail-level
  error`, and analysis that includes `protocol-impls` in addition to the normal
  namespace/var definition and usage sections. The explicit fail level prevents
  ordinary warnings from causing a nonzero analyzer exit.
- Set the process working directory to `--root` and explicitly use
  `<root>/.clj-kondo` as the config directory, even when it does not yet exist.
  This preserves checked-in project config while preventing unrelated home or
  parent-directory config from leaking into the result.
- Project `:lint-as` and hooks must retain their kondo semantics. Add a fixture
  proving that checked-in project configuration is honored.
- Run one kondo process over all sorted explicit `.clj` and `.bb` paths,
  joined for `--lint` with `java.io.File/pathSeparator`; normalize the combined
  analysis once. Do not run one analyzer process per file.
- Kondo duration, absolute filenames, raw summaries, and raw analysis records
  must never appear in the canonical report.

### Evidence classification

Use only facts present in kondo analysis. Do not infer runtime reachability.
For a var usage, the fully qualified used var is `to/name`; its enclosing var,
when supplied by kondo, is `from/from-var`.

Apply these rules in order:

1. A `:refer true` usage is an import declaration, not an invocation or
   reference site; omit it from edges.
2. A `:defmethod true` usage is a multimethod candidate declaration, not an
   invocation.
3. A usage with `:macro true` is a macro boundary, even though kondo also
   supplies an arity.
4. A non-macro usage of a locally identified protocol function or multimethod
   with an invocation `:arity` is a runtime dispatch site, not a proven direct
   callee.
5. Any other resolved non-macro usage with an invocation `:arity` is a direct
   **source-level var invocation**.
6. A resolved var usage without invocation `:arity` is a reference. This
   includes a function used as data and the function argument passed to
   `apply`; neither is a proven direct invocation of that function.
7. A usage resolved to `clj-kondo/unknown-namespace` **with invocation
   `:arity`** is not an edge. Emit an `:unresolved-invocation` target gap only
   when its `from/from-var` exactly matches a requested target. Otherwise omit
   it from the requested graph. An unknown-namespace usage without invocation
   `:arity` is neither an edge nor a gap. This avoids false partial results for
   valid declaration/binding symbols such as a `defprotocol` method parameter.

Threading macros normally produce both a macro usage and resolved usages for
the threaded functions. Report the threading macro as a boundary and the
resolved function usages according to the rules above.

Incoming direct invocations are `direct-callers` only when kondo supplies an
enclosing `from-var`. Calls without `from-var` are recorded under
`unattributed-invocations`, with their namespace and location. They must not be
labeled `top-level`: kondo can also omit `from-var` inside `defmethod`,
`defrecord` protocol methods, and `extend-protocol` bodies.

Outgoing callees/references/macro boundaries are usages whose `from/from-var`
exactly matches the requested target. Do not assign unowned implementation-body
usages to a requested multimethod or protocol function.

A locally defined protocol function or multimethod is identified from its var
definition. Dispatch candidates are evidence only:

- multimethod candidates come from matching `defmethod` usages and include the
  dispatch value string and location;
- protocol candidates come from matching `protocol-impls` records and include
  the implementation namespace, defining form, and location;
- candidates are never reported as guaranteed callees.

Dispatch classification is available only when scanned local definitions
identify the invoked var as a protocol function or multimethod. A
dependency-defined var may therefore remain a syntactically direct
source-level invocation while being semantically unclassified; the language
guide must state this limitation.

If a target has no local definition, preserve any resolved usage evidence but
mark the target partial because its kind and dispatch semantics cannot be
verified. Multiple local definitions of the same fully qualified target also
make the target partial.

### Canonical EDN v1

The language guide must contain two complete examples: a minimal clean target
and a populated target illustrating optional evidence fields. The canonical
report shape is sparse:

```clojure
{:schema "dotagents.callgraph.clojure"
 :schema-version 1
 :status :ok
 :analyzer {:name "clj-kondo"
            :version "2026.01.19"}
 :options {:production-only false}
 :targets
 [{:target "app.service/run"
   :status :ok
   :definitions
   [{:kind :function
     :location {:file "src/app/service.clj" :row 10 :col 7}}]
   :direct-callers
   [{:caller "app.cli/main"
     :site {:file "src/app/cli.clj" :row 20 :col 5}}]
   :direct-callees
   [{:callee "app.store/load"
     :site {:file "src/app/service.clj" :row 12 :col 3}}]}]
 :limits
 [:clj-and-bb-only
  :no-higher-order-resolution
  :no-macro-expansion-proof
  :no-runtime-receiver-resolution
  :static-only]}
```

Contract details:

- `:status` is `:ok` or `:partial`, globally and per target.
- Top-level identity/version/status/analyzer/options/targets/limits fields are
  required. Every target requires `:target` and `:status`.
- Evidence collections appear only when non-empty; an omitted evidence key
  canonically means an empty collection. `:gaps` appears only on a partial
  global or target result. Nested `:incoming`/`:outgoing` evidence keys follow
  the same omission rule.
- Gap ownership is represented by placement, not a redundant record field:
  top-level `:gaps` are global scan/analyzer gaps, while a target's `:gaps`
  belong only to that requested target. A global partial report may retain an
  `:ok` status on targets whose own collected evidence is sound.
- Definition kinds map mechanically: `defmacro` → `:macro`, `defmulti` →
  `:multimethod`, a definition carrying `protocol-name` →
  `:protocol-function`, `defn`/`defn-` → `:function`, any other recognized
  definition → `:var`, and a definition whose defining form is absent or not
  recognized → `:unknown`.
- Every source location contains exactly `:file`, `:row`, and `:col`, using the
  kondo name position when available and otherwise the form position.
- Files are canonical root-relative strings with `/` separators. Absolute root
  paths must not appear anywhere.
- Target and var identities are strings, not EDN symbols.
- When a non-empty evidence collection is present, record shapes are fixed:
  - `:definitions`: `{:kind ... :location ...}`;
  - `:direct-callers`: `{:caller "ns/var" :site ...}`;
  - `:direct-callees`: `{:callee "ns/var" :site ...}`;
  - incoming/outgoing `:references`:
    `{:var "ns/var" :owner "ns/var-or-nil" :namespace "ns" :site ...}`;
  - incoming/outgoing `:macro-boundaries`:
    `{:macro "ns/var" :owner "ns/var-or-nil" :namespace "ns" :site ...}`;
  - dispatch `:sites` and `:outgoing`:
    `{:var "ns/var" :owner "ns/var-or-nil" :namespace "ns" :site ...}`;
  - dispatch `:candidates`:
    `{:kind :multimethod-method|:protocol-implementation
      :target "ns/var"
      :implementation-namespace "ns-or-nil"
      :defined-by "qualified/defining-form"
      :dispatch-value "printed-value-or-nil"
      :location ...}`;
  - `:unattributed-invocations`:
    `{:var "ns/var" :namespace "ns" :site ...}`; and
  - every gap:
    `{:kind ... :location location-or-nil
      :message "normalized actionable text"}`.
  The quoted `-or-nil` placeholder means the EDN value is either a location map
  or literal `nil`; the keys remain present in both cases. Gap ownership comes
  only from the containing top-level or target `:gaps` collection.
- Vectors are sorted by the first applicable tuple: target/var/macro identity,
  owner, file, row, column, kind. Definitions sort by kind then location;
  dispatch candidates by target, kind, dispatch value, then location; gaps by
  kind, location, then message. Duplicate normalized records are removed.
- `:limits` has the fixed lexical order
  `[:clj-and-bb-only :no-higher-order-resolution
  :no-macro-expansion-proof :no-runtime-receiver-resolution :static-only]`.
- Map keys are printed in the order shown by the documented schema and record
  shapes; output ends with exactly one newline.
- Repeating an identical run must produce byte-identical stdout.
- Schema changes require a schema-version increment and updated contract
  fixture.

Dynamic gaps use compact normalized maps rather than copied kondo records. The
language guide must document every gap kind introduced by v1. At minimum cover
`:analyzer-error`, `:analyzer-nonzero`, `:unresolved-invocation`,
`:missing-definition`, and `:duplicate-definition`.

### Status and exit behavior

- Exit `0`: a complete `:ok` report was printed to stdout.
- Exit `1`: a valid but `:partial` report was printed to stdout. Stderr may
  summarize that gaps exist but must not contain the only copy of a gap.
- Exit `2`: CLI, preflight, or fatal analyzer failure. Print an actionable
  diagnostic to stderr and print no EDN graph to stdout.

Fatal failures include:

- invalid or nonexistent root;
- invalid target syntax;
- no discoverable input files after filtering;
- missing or unstartable `clj-kondo`;
- malformed/non-JSON analyzer output;
- missing required analysis sections; or
- an analyzer filename that cannot be normalized beneath root.

Kondo runs with `--fail-level error`, so ordinary warnings do not cause a
nonzero analyzer exit. A nonzero kondo exit with valid JSON and usable analysis
is not automatically fatal: it is accounted for when well-formed findings at
the configured fail level explain it, even if those findings are intentionally
not graph gaps. Normalize only soundness-relevant findings into global gaps:
source parse/reader failures (at minimum the pinned kondo `:syntax` finding),
configuration or hook failures, and failures that prove an included source was
not analyzed. Ordinary error-level lint findings (for example unused vars or
style/project-policy violations) do not affect graph status and are not copied
into output. A nonzero exit with no recognized analyzer finding or diagnostic
that accounts for it adds an `:analyzer-nonzero` global gap.

A target with no local definition is partial, not fatal. A target is partial
only for its own target gaps (such as missing/duplicate definition or an
unresolved invocation it owns). Global status is partial when any global or
target gap exists; a global gap does not by itself downgrade locally sound
target statuses.

## Acceptance Criteria

- [ ] `clj-kondo v2026.01.19` is pinned in `test/Containerfile`; the helper
      records the installed version, and missing kondo exits `2` without a
      grep/parser fallback.
- [ ] The CLI implements the documented root, target validation,
      deduplication, ordering, stdout/stderr, and exit-code contract.
- [ ] Discovery analyzes regular `.clj` and `.bb` files only, does not follow
      directory symlinks, excludes hidden path components, and ignores
      `.cljc`/`.cljs` definitions and errors.
- [ ] `--production-only` applies the documented Clojure/Babashka path and
      basename rules before analysis; tests remain included by default.
- [ ] Kondo runs reproducibly with cache disabled, root `.clj-kondo` config,
      JSON analysis, `--fail-level error`, and `protocol-impls`; a fixture
      proves project `:lint-as` configuration is honored and warning-only
      findings do not make an otherwise complete graph partial.
- [ ] The helper emits the documented sparse canonical EDN v1 shape with
      required identity fields, canonical omission of empty evidence,
      normalized locations, deterministic ordering, analyzer version, explicit
      limits, and no absolute paths, durations, summaries, or raw analysis
      records.
- [ ] Fixtures demonstrate exact semantics for aliases, `:refer`, qualified
      calls, lexical shadowing, direct callees, a namespace-level unattributed
      call, threading macros, macro boundaries, function-as-data, `apply`,
      multimethods, protocols, and dispatch candidates. The language guide
      documents that dependency-defined protocol/multimethod vars can remain
      syntactically direct but semantically unclassified.
- [ ] `.bb` definitions and usages are included despite kondo's directory-scan
      behavior.
- [ ] Gap ownership is explicit: parse/reader/config/hook failures and other
      scan-wide omissions are top-level global gaps; missing/duplicate target
      definitions and target-owned unresolved invocations are per-target gaps.
      Neither category can be silently omitted.
- [ ] Ordinary lint findings, including error-level findings unrelated to
      source-analysis completeness, do not make the graph partial. A nonzero
      analyzer exit explained by well-formed findings is not an
      `:analyzer-nonzero` gap. Valid no-arity unknown-namespace
      declaration/binding usages do not create false gaps; unexplained analyzer
      failures still follow the documented partial/fatal and exit-code rules.
- [ ] Two identical runs and two target argument orders produce byte-identical
      EDN; the expected contract fixture contains no temporary absolute path.
- [ ] Pure discovery/normalization/classification/formatting logic is tested
      directly, while analyzer-backed fixture tests exercise the CLI through
      the pinned shared runner (containerized under `bb test`, direct under
      `bb test:ci`).
- [ ] One shared callgraph test runner is used by both canonical paths: `bb
      test` runs it in the container, while `bb test:ci` runs the same runner
      directly in CI. Neither path writes to the host.
- [ ] `shared/skills/callgraph/SKILL.md` directs Clojure/Babashka analysis to
      this helper, and `languages/clojure.md` documents the CLI, EDN contract,
      trust boundary, guarantees, gap kinds, and limits. Both preserve the rule
      that a concrete forward trace is required for a `Confirmed` verdict.

## Affected Files

- `shared/skills/callgraph/scripts/clj_callers.clj` — CLI boundary, kondo
  invocation, pure normalization, and canonical EDN formatting.
- `shared/skills/callgraph/languages/clojure.md` — exact CLI, schema, status,
  exit behavior, production filter, trust boundary, and limitations.
- `shared/skills/callgraph/SKILL.md` — replace the Clojure manual-pass exception
  with the canonical helper workflow.
- `shared/skills/callgraph/test/` — pure tests, analyzer-backed tests, source
  fixtures, and byte-stable expected EDN.
- `test/Containerfile` — install the pinned kondo binary in the supported test
  image.
- `bb.edn` — add a shared callgraph test runner; run it through the existing
  container boundary in `test` and directly in `test:ci`.

## Test Plan

### Pure tests

Test discovery predicates, production filtering, target validation,
classification of representative kondo maps, gap/status reduction,
root-relative path normalization, sorting, and canonical formatting without
starting a process.

### Analyzer-backed tests

Use fixture projects under `shared/skills/callgraph/test/fixtures/` and execute
the real CLI through the pinned shared test runner: in the repository test
container for `bb test`, and directly in the equivalent CI environment for
`bb test:ci`. Cover:

- `.clj`, `.bb`, ignored `.cljc`/`.cljs`, hidden paths, and test filtering;
- alias, refer, qualified, shadowed, threaded, referenced, and `apply` uses;
- incoming and outgoing macro boundaries;
- protocol dispatch plus `protocol-impls` candidates;
- multimethod dispatch plus `defmethod` candidates;
- a true namespace-level invocation remaining unattributed rather than being
  mislabeled as an owning var;
- checked-in `:lint-as` config;
- missing/duplicate targets, target-owned unresolved invocation, valid no-arity
  unknown declaration/binding usages, parse/reader/config failures,
  warning-only and unrelated error-level lint findings, missing kondo, invalid
  root/target, and empty discovery;
- global versus target gap ownership, sparse expected EDN, canonical
  omitted-empty semantics, and exit codes; and
- byte stability across repeat runs and target argument permutations.

## E2E Spec

GIVEN a fixture project containing `.clj`, `.bb`, ignored `.cljc`/`.cljs`,
aliases, `:refer`, a shadowed local, a threaded invocation, a macro, an indirect
function reference, `apply`, a multimethod, a protocol, and test-only callers

WHEN an agent runs the helper for one or more fully qualified vars

THEN it receives byte-stable root-relative EDN containing only normalized
static evidence, with direct source-level invocations separated from
references, macro boundaries, runtime dispatch, candidates, unattributed
invocations, and gaps

AND `--production-only` removes inputs matching the documented test conventions
before analysis

AND incomplete but usable analysis exits `1` with `:partial` EDN, while fatal
preflight/analyzer failures exit `2` with no graph on stdout.

## Notes

The final callgraph skill report remains succinct Markdown: call trees, verdict
rows, and a short scope note. EDN is the helper's canonical evidence interface;
a text renderer is explicitly deferred.

A future `.cljc`/`.cljs` adapter must require explicit platform selection and
keep branch-specific graph evidence separate.

Keep this work as one coherent feature: protocol/multimethod dispatch
classification is necessary to avoid misreporting dynamic dispatch as direct
calls. Tests and documentation remain part of the behavior they verify rather
than becoming separate horizontal tasks.
