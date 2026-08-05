# callgraph — Python

Use `scripts/py_callers.py` to build the real call graph for step 2 instead
of relying on grep alone. Grep finds text matches; this script resolves
imports (including aliases and `from x import y as z`) and distinguishes an
import statement from an actual call site. Re-export chains still require the
manual pass described below.

## Usage

```bash
python3 <path-to-this-skill>/scripts/py_callers.py --root <repo_root> SYMBOL [SYMBOL ...]
```

Example (skill installed under `~/.agents/skills/callgraph`):

```bash
python3 ~/.agents/skills/callgraph/scripts/py_callers.py \
  --root src \
  release_lock get_lock_state
```

By default the report includes production and test files. To exclude conventional
tests, add `--production-only`:

```bash
python3 ~/.agents/skills/callgraph/scripts/py_callers.py \
  --root src \
  --production-only \
  release_lock get_lock_state
```

The filter excludes `test_*.py`, `*_test.py`, and Python files beneath a path
component named `test` or `tests`.

Output is grouped per symbol:

```
release_lock  (defined in billing/locks.py:54)
  called from:
    billing/scheduler.py:112     in run_release_cycle()
    billing/cli/unlock.py:31     in handle()
    billing/api/views.py:88      in unlock_view()
  imported (no call site found) in:
    billing/tests/test_locks.py:9
```

`imported (no call site found)` usually means the import is only used for
patching/mocking in tests — check manually before assuming it's dead.

## What this script does NOT do

- No cross-function data-flow (it won't tell you whether the *value* passed
  to a call makes the traced scenario take a particular branch — that's step
  4's hand-trace, done by you, not by this script).
- No dynamic dispatch or runtime receiver-type resolution (`getattr`,
  decorators that rewrap the function, DI containers, or `object.method()`
  calls). Attribute calls are counted only when the receiver is a statically
  imported module; otherwise verify the target manually and note the gap.
- No cross-package resolution beyond `--root`, and no transitive re-export
  resolution (`api.target` re-exporting `impl.target`). Follow those chains
  manually, pass a broader root when appropriate, and note the gap.
- Module bindings are followed in source order. Function bodies are inspected
  where their `def` appears, not at every possible later invocation state, so
  late imports/rebindings can cause misses or stale provenance. Verify modules
  that mutate imports after function definitions manually.
- Class namespaces are not modeled separately. Imports/calls in a class body
  can be attributed to module scope; inspect class-body findings manually.

## When the script isn't enough

For anything beyond straightforward `import` + `Call`, do a manual read of
the surrounding code and say so explicitly in the report — don't let a clean
script run stand in for checking decorators, metaclasses, or `**kwargs`
dispatch tables.
