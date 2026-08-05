# testmap — Python

Two scripts, opposite directions, sharing `_common.py` for AST/import
resolution (both are AST-only, no test execution, no import execution).

## Scenario 1 — forward: does this source module's functions have tests?

```bash
python3 <path-to-this-skill>/scripts/py_testmap.py \
  --root <repo_root> --src <path/to/module.py> [--test-pattern PATTERN] [--include-private]
```

`--test-pattern` overrides the default `<pkg>/tests/test_<module>.py`
convention explicitly; it's relative to the source file's own directory and
supports `{module}`. When no override is given, the default now walks up
from the source file's directory looking for a `tests/test_<module>.py`
sibling at each ancestor (stopping at `--root`) -- this handles Django's
`<app>/management/commands/<module>.py` layout, where tests live at
`<app>/tests/test_<module>.py` several directories above the source file,
automatically, without needing `--test-pattern` for that specific case.

Example:

```bash
python3 ~/.agents/skills/testmap/scripts/py_testmap.py \
  --root src --src billing/locks.py
```

Per top-level function/class: `placed` / `misplaced: <file>` /
`imported only (...)` / `no reference found`. See the previous section of
this doc's git history or `SKILL.md` step 3 for exact definitions.

## Scenario 2 — reverse: does this test file's tests target their own module?

```bash
python3 <path-to-this-skill>/scripts/py_testtarget.py \
  --root <repo_root> --test-src <path/to/test_module.py> [--expected-source PATH]
```

`--expected-source` overrides the default `<pkg>/<module>.py` reversal
explicitly (relative to `--root`). When no override is given, the default
now also falls back to a recursive, unambiguous search under the app
directory (`<pkg>/`) for a file named `<module>.py` outside any `tests/`
dir -- this covers Django's `<app>/management/commands/<module>.py` layout
automatically too. If that search finds zero or multiple matches, it falls
back to the naive guess (reported as `MISSING`) rather than pick one
arbitrarily -- pass `--expected-source` explicitly in that case.

Example:

```bash
python3 ~/.agents/skills/testmap/scripts/py_testtarget.py \
  --root src --test-src billing/tests/test_locks.py
```

For every top-level `test_*` function and every `test_*` method inside a
`TestCase`-like class, resolves which imported, in-repo, non-test production
symbols it actually calls, and reports:
- `on-target (symbol, symbol, ...)` — every resolvable production call in
  that test body belongs to the expected source module.
- `⚠ off-target: symbol (path/to/other_module.py)` — at least one resolvable
  call belongs to a different module.
- `no production symbols called (fixture-only / trivial?)` — nothing
  resolvable was called; likely a pure-data/setup test, not necessarily a
  problem.

**Important gotcha, found while validating this tool against a real
repo:** the naive reversal (`<pkg>/tests/test_<module>.py` →
`<pkg>/<module>.py`) breaks for source files that don't live directly in
`<pkg>/`, e.g. Django's `<pkg>/management/commands/<module>.py`. This is now
auto-detected (see above) via an unambiguous recursive search, but if the
search is ambiguous (multiple files share the module's name under the app
dir) the script still reports `expected source module: ... MISSING` rather
than guess — pass `--expected-source` explicitly whenever that happens, and
check the reported line before trusting any off-target flags that follow it.

**Second gotcha:** `--root` doubles as both "boundary for repo-wide scans"
and "basis for resolving dotted import paths" (`from billing.locks import y`
resolves as `<root>/billing/locks.py`). In a project where the actual
Python path root is a subdirectory (e.g. `src/`), passing the git repo root
as `--root` will resolve zero production imports (every test will show
`no production symbols called`) even though the paths themselves are found
correctly. Pass the actual import root (e.g. `--root src`), not the repo
root, whenever imports aren't resolving.

**Third gotcha, fixed:** `py_testmap.py`'s repo-wide scan used to filter out
any path containing a dot-prefixed segment (`.venv`, `.git`, etc.) by
checking `path.parts` on the *absolute* path — which also matches any
dot-prefixed directory in the repo's own ancestry (e.g. a worktree checked
out under `~/.cache/...`), silently skipping every file in the repo. Fixed
to filter on the path relative to `--root` instead.

## Shared behavior and limitations (both scripts)

- Only symbols resolvable to a real `.py` file under `--root` are ever
  flagged — stdlib, third-party, and framework imports (Django, pytest,
  `unittest.mock`) are out of scope by construction, not filtered
  heuristically.
- `@patch(f"{MODULE}.symbol")` string targets are **not** counted as calls
  (correct — patch targets aren't invocations of the real function). Only
  literal `ast.Call` nodes count. Verify this against a `@patch(...)`-heavy
  test file in your own project before trusting the result.
- Dynamic dispatch (`getattr`, decorator-wrapped rebinding, DI containers)
  isn't resolved — same blind spot as `callgraph`'s helper.
- Module imports/rebindings are followed in source order. Calls inside a
  function are resolved against bindings visible where its `def` appears,
  not every possible later invocation state; late module imports/rebindings
  need a manual check.
- Class namespaces are not modeled separately, so class-local imports can be
  attributed to module scope. Inspect class-body findings manually.
- A model/fixture class from another module used only to *set up* test data
  (e.g. a shared `AuditLog` or `Session` record) will show as off-target in
  scenario 2 even though the test is legitimately about the expected module
  — read the flagged line before treating it as evidence of drift, don't
  auto-move it.
- Indirect/integration coverage is still a false negative for scenario 1,
  same as documented in `SKILL.md`.
