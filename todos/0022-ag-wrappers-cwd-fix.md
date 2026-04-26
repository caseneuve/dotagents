---
title: ag-* CLI wrappers fail outside dotagents repo cwd
status: done
priority: high
type: bug
labels: [bootstrap, cross-platform]
created: 2026-04-26
parent: null
blocked-by: []
blocks: []
---

## Context

The `~/.local/bin/ag-{todo,tmux,sandbox}` entries installed by
`bb bootstrap` are raw symlinks to the skill CLI files:

```
~/.local/bin/ag-todo    -> shared/skills/add-todo/src/todo/cli.clj
~/.local/bin/ag-tmux    -> shared/skills/pk-tmux/src/tmux_agent/cli.clj
~/.local/bin/ag-sandbox -> shared/skills/sandbox/src/sandbox/cli.clj
```

Each file has shebang `#!/usr/bin/env bb` and `:require`s namespaces
(`todo.core`, `sandbox.core`, `mux.protocol`, `mux.cmux`, `mux.tmux`,
`mux.runner`, `mux.runner.preflight`) that live on a classpath the
file itself does not declare. `bb` resolves its classpath from the
*cwd's* `bb.edn`, so the scripts only work when invoked from inside
the dotagents checkout:

```
$ cd ~ && ag-todo list --status open
Could not locate todo/core.clj on classpath.

$ cd /tmp && ag-sandbox
Could not locate sandbox/core.clj on classpath.

$ cd ~ && ag-tmux
Could not locate mux/protocol.clj on classpath.
```

This is a regression relative to the master branch, where the bash
helpers (`todo-list.sh`, `tmux-run.sh`, `sandbox-create.sh`, …) had
no classpath requirement and worked from any cwd. It blocks the
`macos → master` merge: every Claude/Codex/pi invocation of these
skills from a project worktree will hit a hard classpath error.

## Root cause

`bb`'s classpath discovery is cwd-rooted. The skill CLIs need three
things at load time: their own `src/` on the classpath, any local
`core.clj` siblings, and the `mux-bb` git dep (for pk-tmux and
sandbox). Only the repo-root `bb.edn` declares all three; the
per-skill `bb.edn` files (where present) declare only `:paths`.

## Fix

Verified approach: `bb --config <repo>/bb.edn --deps-root <repo>
-m NS.cli -- "$@"` works from any cwd because the root `bb.edn`
already has:

- `:paths` covering every skill's `src/` and `test/` directory
- `:deps {io.github.caseneuve/mux-bb …}`

So each `ag-*` can be a thin bash wrapper that:

1. Resolves its own real path through symlinks (standard bash idiom).
2. Derives the dotagents repo root via `git -C <script-dir> rev-parse
   --show-toplevel` — unambiguous, layout-independent, no path math.
3. `exec bb --config "$repo/bb.edn" --deps-root "$repo" -m NS.cli --
   "$@"`.

Wrappers are checked into each skill directory. Bootstrap's
`bin-ops` is updated to symlink `~/.local/bin/ag-*` at the wrappers
instead of the raw `.clj` files.

## Acceptance criteria

- [ ] `cd ~ && ag-todo list --status open` works without classpath
      errors.
- [ ] `cd /tmp && ag-sandbox create 1` reaches real logic (git
      toplevel lookup) rather than classpath failure.
- [ ] `cd ~ && ag-tmux` prints usage.
- [ ] `bb bootstrap agents --dry-run` and `bb bootstrap claude
      --dry-run` show the new wrapper targets.
- [ ] `bb test:unit` passes including updated `bin-ops` test.
- [ ] Wrappers live in `shared/skills/<skill>/ag-<name>`, checked in
      with `+x`, following a consistent template.

## Affected files

- `shared/skills/add-todo/ag-todo` (new)
- `shared/skills/pk-tmux/ag-tmux` (new)
- `shared/skills/sandbox/ag-sandbox` (new)
- `scripts/bootstrap.clj` — `bin-ops`
- `test/unit/bootstrap_pure_test.clj` — `bin-ops-test`

## E2E spec

Not strictly required for a bug fix of this shape (the regression is
directly observable at the shell), but the existing E2E harness
already has a bootstrap suite in `test/e2e/cases.edn`. If time
permits, add a scenario: after `bb bootstrap agents`, run
`ag-todo next-id --dir {work}/todos` from a fresh cwd and expect a
numeric ID on stdout.

## Notes

- `git rev-parse --show-toplevel` is deterministic here because
  dotagents is always a git checkout (part of its workflow).
- `bb` must be on PATH; a missing-bb failure surfaces with a plain
  `bash: bb: command not found` which is fine.
- First-time classpath resolution on a fresh Linux host still needs
  `clojure` CLI + Java (transitive via `bb --config` with git deps).
  Already implicit in the current repo bb.edn; not a regression.
