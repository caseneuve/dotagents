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
supports `{module}`. Relative segments such as `..` are normalized before
classification. When no override is given, the default walks up from the
source file's directory looking for both `tests/test_<module>.py` and the
mirrored `tests/<source-subdirectories>/test_<module>.py` at each ancestor
(stopping at `--root`). The latter handles layouts such as
`<app>/module/<module>.py` -> `<app>/tests/module/test_<module>.py`; the
former continues to handle Django's flattened
`<app>/management/commands/<module>.py` -> `<app>/tests/test_<module>.py`
layout automatically. A flattened candidate is used only when the reverse
convention maps it back to the requested source; otherwise it is ambiguous
with another same-named module and requires an explicit `--test-pattern`. If
flattened and mirrored candidates both exist below the same ancestor, the more
specific mirrored candidate wins.

Example:

```bash
python3 ~/.agents/skills/testmap/scripts/py_testmap.py \
  --root src --src billing/locks.py
```

Per top-level function/class: `placed` / `misplaced: <file>` /
`patched only (...)` / `imported only (...)` / `no reference found`. See
`SKILL.md` step 3 for exact definitions.

## Scenario 2 — reverse: does this test file's tests target their own module?

```bash
python3 <path-to-this-skill>/scripts/py_testtarget.py \
  --root <repo_root> --test-src <path/to/test_module.py> [--expected-source PATH]
```

`--test-src` and `--expected-source` paths are relative to `--root` unless
absolute. `--expected-source` overrides the default `<pkg>/<module>.py`
reversal explicitly. When no override is given, the default
recognizes directories nested below `tests/` as mirrored source directories:
`<app>/tests/module/test_<module>.py` maps to
`<app>/module/<module>.py`. It also falls back to a recursive, unambiguous
search under the app directory (`<pkg>/`) for a file named `<module>.py`
outside any `tests/` dir -- this covers Django's flattened
`<app>/management/commands/<module>.py` layout automatically too. If that
search finds zero or multiple matches, it falls back to the naive guess
(reported as `MISSING`) rather than pick one arbitrarily -- pass
`--expected-source` explicitly in that case.

Example:

```bash
python3 ~/.agents/skills/testmap/scripts/py_testtarget.py \
  --root src --test-src billing/tests/test_locks.py
```

For every top-level `test_*` function and every `test_*` method inside a
`TestCase`-like class, resolves which imported, in-repo, non-test production
symbols it directly calls and which ones it statically targets with a
`@patch` decorator, and reports:
- `on-target (symbol, patched: symbol, ...)` — resolvable calls or static
  patch targets include expected-source symbols and no external production
  references.
- `on-target (...); supporting refs: symbol (path/to/other_module.py)` — the
  test directly targets its expected module and calls the external symbol as an
  argument nested inside that target call, or passes its directly assigned result
  to that target call. Treat it as input construction, not drift.
- `⚠ off-target: symbol (path/to/other_module.py); on-target: symbol` — an
  external production call outside an expected-source call, or any external
  static patch target, remains visible even when the test also calls its target.
- `no production symbols called (fixture-only / trivial?)` — nothing
  resolvable was called or named in a static patch target; likely a
  pure-data/setup test, not necessarily a problem.

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
- A `@patch` decorator target is reported as a static reference, never as a
  direct call. The resolver supports literal targets and f-strings or `+`
  concatenations composed only of lexically visible literal-string constants,
  such as `MODULE = "billing.locks"` plus
  `@patch(f"{MODULE}.acquire_lock")`. Module and test-class constants are
  supported, and a test-class decorator applies to every contained test method.
  The decorator must be a statically verified import from `unittest.mock` or
  `mock` (including aliases), so an arbitrary `object.patch(...)` is ignored.
  Dynamic values, patch context managers, and `patch.object(...)` are out of
  scope.
- Dynamic dispatch (`getattr`, decorator-wrapped rebinding, DI containers)
  isn't resolved — same blind spot as `callgraph`'s helper.
- Module imports/rebindings are followed in source order. Calls inside a
  function are resolved against bindings visible where its `def` appears,
  not every possible later invocation state; late module imports/rebindings
  need a manual check.
- Class namespaces are not modeled separately, so class-local imports can be
  attributed to module scope. Inspect class-body findings manually.
- Production calls nested as arguments inside an expected-source call, or whose
  directly assigned result is passed to that call, are supporting references.
  Other external calls in separate statements and external static patches remain
  off-target, even when the test also calls its expected source module.
- Indirect/integration coverage is still a false negative for scenario 1,
  same as documented in `SKILL.md`.
