---
name: testmap
description: Checks, without running any tests, whether functions/classes have a corresponding test in the project's expected test module (forward), and whether a test file's tests actually target their own module rather than drifting to cover another one (reverse). Purely static/AST-based -- fast feedback for slow or remote-dependent test suites. Use when asked "does X have a test", "is this covered", "check test placement", "is this test file on-topic", or before running a slow suite to get a quick structural pass first.
triggers:
  - test coverage without running tests
  - do these functions have tests
  - check test placement
  - static coverage
  - missing tests
  - is this test targeting the right module
---

# testmap — Static Test-Presence & Placement Check

Answers two separate, complementary questions, without executing anything.
Each has its own script (they share AST-resolution code, see
`languages/python.md`), because they start from opposite ends and a single
entry point can't answer both:

- **Scenario 1 (forward)** — start from a *source* module: does every
  function/class in it have a test, and does that test live in the expected
  test module? Script: `scripts/py_testmap.py`.
- **Scenario 2 (reverse)** — start from a *test* module: does every test in
  it actually target the module it's supposed to test, or has it drifted to
  cover something else? Script: `scripts/py_testtarget.py`.

Run both when auditing a source/test pair — a clean scenario 1 result
(everything "placed") does not rule out scenario 2 finding unrelated tests
that also crept into the same file, and vice versa.

## What this is not

This is **not** coverage. Real coverage (`coverage.py`, `pytest --cov`)
proves a line *executed* during a real run and requires running the suite —
exactly what this skill exists to avoid when tests are slow or need a remote
environment. This skill proves something weaker and much cheaper: *some test
file contains a static reference to this symbol* (an import, a direct call,
or a statically resolvable `@patch` target).

That gap matters and must stay visible in the output:
- A symbol can be `referenced` here and still be untested in any meaningful
  sense (imported only for mocking, named only in a `@patch` target, called
  with no assertion on its result, called inside a fixture that's never itself
  exercised).
- A symbol can be fully covered by an *integration* or *functional* test
  that never mentions its name directly (calls it indirectly through a
  higher-level entry point) and this skill will report it as untested. This
  is a real false positive — flag it as a known limitation in the output,
  don't silently under-report.

Use this for **fast, cheap triage before running the real suite**, not as a
substitute for it. If the fast pass says "referenced", that's a reasonable
signal to skip a slow re-run of that file; if it says "no reference found",
that's a strong signal to go look, not a final verdict either way.

## Procedure

### 1. Determine the naming convention

Find the project's stated test-file convention (project docs, `CLAUDE.md`/
`AGENTS.md`/`README.md`, or by inspecting a few existing source/test file
pairs). Common pattern: `<package>/<module>.py` -> `<package>/tests/test_<module>.py`.
Do not assume a convention — confirm it against at least 2-3 real existing
pairs in the repo before treating it as ground truth. If source and test
files don't consistently follow one pattern, say so explicitly instead of
picking one arbitrarily.

### 2. Run the language helper now

Don't hand-grep this. Use the language-specific scripts to get a
deterministic answer for every symbol/test at once.

- Python:
  - Scenario 1 (forward, from source): **run `scripts/py_testmap.py` now.**
    ```bash
    python3 scripts/py_testmap.py --root <repo_root> --src <path/to/module.py>
    ```
  - Scenario 2 (reverse, from test file): **run `scripts/py_testtarget.py` now.**
    ```bash
    python3 scripts/py_testtarget.py --root <repo_root> --test-src <path/to/test_module.py>
    ```
  Both compute the expected counterpart path from the convention (override
  scenario 1 with `--test-pattern`, scenario 2 with `--expected-source`) —
  check the printed "expected .../ (exists|MISSING)" line before trusting
  any result below it; a MISSING line means the naive convention guess
  failed (e.g. Django `management/commands/` layouts) and every flag that
  follows needs the explicit override, not blind trust. See
  `languages/python.md` for full output format and blind spots.
- (Clojure and others: not yet supported — do a manual read and note this
  explicitly.)

### 3. Classify each symbol (scenario 1) or each test (scenario 2)

Scenario 1, one of:

- **`placed`** — referenced (imported *and* called, not just imported) in
  the expected test file. Best signal available without running anything.
- **`misplaced: <file>`** — referenced somewhere, but not in the expected
  test file. Flag this explicitly even though the symbol technically has
  *a* test — the project's placement convention is a real requirement
  (findability, ownership, "move tests with code"), not decoration.
  Consider whether this is a genuine mislocation or a legitimate integration
  test that's expected to live elsewhere — don't auto-recommend moving it,
  just surface it.
- **`patched only`** — the expected test file has a statically resolvable
  `@patch("package.module.symbol")` target for the symbol but no direct call.
  This is an ownership signal, not proof the symbol itself is exercised. Only
  literal targets and f-strings composed of lexically visible literal-string
  constants (module or test-class scope) are resolved.
- **`imported only`** — the expected test file imports the symbol but the
  script found no direct call to it there. Call this out, don't count it as
  tested.
- **`no reference found`** — nothing anywhere in the scanned tree references
  it. Strongest signal of a real gap, but still subject to the indirect-call
  false positive noted above — say so if the symbol is the kind of thing
  (e.g. a private helper only called by an already-tested public function)
  where that's plausible.

Scenario 2, one of:

- **`on-target`** — every resolvable production-code call or static `@patch`
  target in that test belongs to the expected source module.
- **`off-target: symbol (other_module)`** — at least one resolvable call or
  static patch target reaches a different module. Could be genuine drift, or
  a legitimate integration test / fixture setup (e.g. calling an ORM model
  from another app to build test data) — read the flagged line before
  recommending a move.
- **`no production symbols called`** — the test has no production-code call
  or static patch target this script can resolve in-repo; not necessarily a
  problem (could be a pure-data/parametrization test).

### 4. Report

Keep it a flat table, one row per symbol/test — no prose per-row. Both
scripts print this table directly; reproduce it as-is rather than
re-summarizing into prose.

Scenario 1:

```
symbol                     expected test file                  status
------------------------------------------------------------------------------------
acquire_lock               billing/tests/test_locks.py         placed
release_lock               billing/tests/test_locks.py         placed
get_lock_state             billing/tests/test_locks.py         patched only (no direct call found)
_normalize_lock_key        billing/tests/test_locks.py         no reference found ⚠ private helper, may be covered indirectly
is_locked                  billing/tests/test_locks.py         placed
```

Scenario 2:

```
test                                          status
------------------------------------------------------------------------------------
SomeTestCase.test_acquires_lock_for_existing_resource      on-target (acquire_lock)
SomeTestCase.test_expires_stale_locks                       ⚠ off-target: get_lock_state (billing/locks.py)
```

Below the table, one line reminding the reader what this table does and
doesn't prove:

```
Note: static reference check only, no tests executed. "placed"/"patched only"/
"no reference found"/"on-target"/"off-target" mean "statically referenced (or
not) in test code" -- not proof of behavioral coverage or its absence, and not
proof a
flagged off-target call is actually wrong (could be a legitimate fixture or
integration test). Run the real suite, and read the flagged lines, for that.
```
