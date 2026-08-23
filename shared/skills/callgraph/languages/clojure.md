# callgraph — Clojure and Babashka

Use the skill-local `clj_callers.clj` helper to collect deterministic,
source-level invocation evidence. It is an evidence pass for step 2 of the
callgraph skill; it never replaces the required concrete forward scenario trace
before a claim can receive a `Confirmed` verdict.

## CLI

From the callgraph skill directory:

```bash
bb scripts/clj_callers.clj \
  --root <project-root> \
  [--production-only] \
  namespace/var [namespace/var ...]
```

`--root` is required and must name a directory. Targets are EDN-readable
symbols with a namespace and non-empty name; matching is exact. Bare names are
rejected, while names such as `clojure.core//` are valid. Duplicate targets are
removed and targets are reported in lexical order. Diagnostics go to stderr;
stdout contains only the canonical EDN report.

The helper discovers regular, non-symlink `.clj` and `.bb` files recursively.
It does not follow symlinked files or directories, ignores every path component
beginning with `.`, and never analyzes `.cljc` or `.cljs`. Tests are included by
default. `--production-only` removes files beneath a `test`/`tests` component and
files whose extension-stripped basename starts with `test_` or ends with
`_test`.

The helper invokes one `clj-kondo` process over the sorted explicit file list.
It uses the project root as its working directory, `<root>/.clj-kondo` as the
config directory, `--cache false`, `--repro`, `--fail-level error`, JSON output,
and analysis including `protocol-impls`. The analyzer version is recorded after
stripping the `clj-kondo v` prefix. Repeated runs are byte-stable only when the
source, root configuration, Kondo version, targets, and flags are unchanged.

## Canonical EDN v1

The report is sparse: an omitted evidence key means an empty collection.
Locations are root-relative maps containing exactly `:file`, `:row`, and `:col`.
All identities are strings, all vectors are sorted by the documented lexical
comparators, duplicate normalized records are removed, and no absolute path,
raw Kondo record, duration, or summary is emitted.

Minimal clean report:

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

Populated report with optional evidence:

```clojure
{:schema "dotagents.callgraph.clojure"
 :schema-version 1
 :status :ok
 :analyzer {:name "clj-kondo" :version "2026.01.19"}
 :options {:production-only false}
 :targets
 [{:target "app.service/lookup"
   :status :ok
   :definitions
   [{:kind :multimethod
     :location {:file "src/app/service.clj" :row 10 :col 7}}]
   :direct-callees
   [{:callee "app.store/load"
     :site {:file "src/app/service.clj" :row 12 :col 3}}]
   :references
   {:incoming
    [{:var "app.service/lookup"
      :owner "app.cli/main"
      :namespace "app.cli"
      :site {:file "src/app/cli.clj" :row 18 :col 9}}]
    :outgoing
    [{:var "app.service/options"
      :owner "app.service/lookup"
      :namespace "app.service"
      :site {:file "src/app/service.clj" :row 11 :col 12}}]}
   :macro-boundaries
   {:outgoing
    [{:macro "clojure.core/->"
      :owner "app.service/lookup"
      :namespace "app.service"
      :site {:file "src/app/service.clj" :row 11 :col 3}}]}
   :dispatch
   {:sites
    [{:var "app.service/lookup"
      :owner "app.cli/main"
      :namespace "app.cli"
      :site {:file "src/app/cli.clj" :row 20 :col 5}}
     {:var "app.service/lookup"
      :owner nil
      :namespace "app.cli"
      :site {:file "src/app/cli.clj" :row 22 :col 1}}]
    :candidates
    [{:kind :multimethod-method
      :target "app.service/lookup"
      :implementation-namespace "app.service"
      :defined-by "clojure.core/defmethod"
      :dispatch-value ":cached"
      :location {:file "src/app/service.clj" :row 25 :col 12}}]}
   }]
 :limits
 [:clj-and-bb-only
  :no-higher-order-resolution
  :no-macro-expansion-proof
  :no-runtime-receiver-resolution
  :static-only]}
```

Map keys are printed in the schema order shown above and every record uses a
fixed key order. Locations compare by file, row, then column; literal `nil`
sorts before a location map. Vectors use these comparators:

- targets: target;
- definitions: kind, location;
- direct callers: caller, site;
- direct callees: callee, site;
- references and dispatch sites/outgoing: var, owner, namespace, site;
- macro boundaries: macro, owner, namespace, site;
- unattributed invocations: var, namespace, site;
- dispatch candidates: target, kind, dispatch value, location; and
- gaps: kind, location, message.

Duplicate normalized records are removed. Nested `:incoming` and `:outgoing`
collections follow the same omission rule as top-level evidence collections.
The fixed record shapes are `{:kind ... :location ...}` for definitions,
`{:caller ... :site ...}`, `{:callee ... :site ...}`, `{:var ... :owner ...
:namespace ... :site ...}`, `{:macro ... :owner ... :namespace ... :site ...}`,
`{:kind ... :target ... :implementation-namespace ... :defined-by ...
:dispatch-value ... :location ...}`, and `{:var ... :namespace ... :site ...}`
for unattributed invocations. Every gap contains `:kind`, `:location` (a
location or `nil`), and `:message`.

Top-level `:gaps` are scan/analyzer gaps. A target's `:gaps` belong only to
that target. Any global gap or target gap makes the global report `:partial`,
but a global gap alone does not downgrade a target whose own evidence is sound.
A missing or duplicate local definition makes that target partial. At minimum,
v1 reports these gap kinds:

- `:analyzer-error` — syntax/reader/configuration/hook failure or a discovered
  source file that Kondo did not analyze;
- `:analyzer-nonzero` — a nonzero analyzer exit not explained by a recognized
  finding or diagnostic;
- `:unresolved-invocation` — an unknown-namespace invocation owned by the
  requested target;
- `:missing-definition` — no local definition for the requested target; and
- `:duplicate-definition` — more than one local definition for the target.

Warnings and unrelated lint findings do not make an otherwise sound graph
partial. Exit status is `0` for a complete report, `1` for a valid partial EDN
report, and `2` for invalid CLI input, missing/unstartable Kondo, malformed or
incomplete analyzer output, invalid roots, or empty discovery. Fatal errors
write no EDN to stdout.

## Evidence categories and limits

Kondo evidence is classified in this order:

1. `:refer` usages are import declarations and are omitted from edges.
2. `:defmethod` usages are multimethod candidates, not invocations.
3. `:macro` usages are macro boundaries.
4. Invocations of locally defined protocol functions or multimethods are
   runtime-dispatch sites, not proven direct callees.
5. Other resolved usages with invocation `:arity` are direct source-level var
   invocations.
6. Resolved usages without `:arity` are references, including function-as-data
   and the function argument passed to `apply`.
7. Unknown-namespace invocations become target-owned gaps only when their
   enclosing var is the requested target; otherwise they are omitted.

Threading macros are reported as boundaries while their resolved threaded
functions are classified separately. Calls without Kondo's `from-var` are
recorded as `:unattributed-invocations` only for direct source-level
invocations, never as `top-level` calls. Unattributed protocol or multimethod
invocations remain dispatch `:sites` with a `nil` `:owner`. Protocol
implementation records and `defmethod` records are candidates only; they do not
prove runtime dispatch. Dependency-defined protocol or multimethod vars can
remain syntactically direct because their local kind is unavailable.

This is static source evidence only. It does not resolve higher-order calls,
`eval`, runtime receiver types, protocol/multimethod dispatch, dependency
injection, macro expansion semantics, or `.cljc`/`.cljs` reader-condition
branches. Kondo may execute checked-in `.clj-kondo` hooks while analyzing a
trusted repository; this is separate from executing application code and is a
trust boundary that should be disclosed in review output.
