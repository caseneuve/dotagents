# Babashka Rewrite Plan

**Branch:** `master` (merged; originally developed on `macos`)
**Goal:** Rewrite all shared shell helper scripts in babashka for cross-platform
compatibility, testability, and extensibility.

## Design Principles

### FCIS (Functional Core, Imperative Shell)

Each tool follows the same structure:

```
src/<tool>/
  core.clj    — pure data shapes, transformations, validations
  cli.clj     — babashka.cli dispatch, entry point, I/O boundary
```

- **core.clj** has zero side effects: no filesystem, no process, no exit.
  Every function takes data and returns data. All business logic lives here.
- **cli.clj** wires I/O at the boundary: reads fs, shells out, prints, exits.
  It's a thin pipeline that calls core functions.

### Data Shapes

Each tool defines its domain as plain maps/vectors. Examples:

```clojure
;; A todo item
{:id "0001" :title "..." :status :open :type :feature
 :priority :medium :labels ["MVP"] :parent nil}

;; A plan (list of operations)
[{:op :link :source "/a" :target "/b"}
 {:op :copy :source "/c" :target "/d"}]
```

Shapes are documented in core.clj docstrings and tested via unit tests.

### Expressive Pipelines

CLI entry points read as top-to-bottom pipelines:

```clojure
(defn -main [& args]
  (->> (parse-cli args)
       (validate!)
       (build-plan)
       (execute!)))
```

### Pluggable

Adding a new linter to detect-and-lint = adding a map to a vector.
Adding a new todo filter = adding a key to a predicate map.
No control flow changes needed.

### Single Entry Point per Skill

Each skill gets one executable installed to `~/.local/bin/`:

| Binary | Subcommands |
|---|---|
| `todo` | `list`, `new`, `next-id`, `status` |
| `tmux-agent` | `create`, `run`, `status`, `wait` |
| `review` | `create`, `latest`, `list` |
| `detect-lint` | (no subcommands — single run) |
| `sandbox` | `create`, `finish` |

Using `babashka.cli/dispatch` for subcommand routing.

### Installation

Bootstrap installs symlinks from `~/.local/bin/<name>` → `<repo>/shared/skills/<skill>/cli.bb`.
Each cli.bb has `#!/usr/bin/env bb` and is self-contained (sources its own core.clj via bb.edn paths).

## Slices

### Slice 1: `todo` — add-todo skill

**Why first:** Simplest pure logic. Best FCIS showcase. 4 scripts → 1 entry point.

Scripts replaced:
- `todo-list.sh` (121 lines) — frontmatter parsing, filtering, formatting
- `todo-new.sh` (197 lines) — template generation, label normalization, ID allocation
- `todo-next-id.sh` (82 lines) — ID sequence logic
- `todo-status.sh` (74 lines) — frontmatter field update

Source layout:
```
shared/skills/add-todo/
  src/todo/core.clj       — pure: parse frontmatter, filter, normalize labels,
                             compute next ID, build template, update status
  src/todo/cli.clj         — dispatch: list|new|next-id|status
  bb.edn                   — {:paths ["src"], :deps {}}
  test/todo/core_test.clj  — unit tests for all pure functions
```

Tests:
- Unit: frontmatter parsing, label normalization, ID computation, filter predicates, template rendering
- E2E: `bb test:e2e` cases for list/new/status round-trips (already have some)

### Slice 2: `tmux-agent` — pk-tmux skill

**Why second:** Highest complexity. Marker-based output extraction is the gnarliest
pure logic. Proven pattern from agentic-stuff.

Scripts replaced:
- `tmux-create.sh` (40 lines)
- `tmux-run.sh` (151 lines) — polling, markers, output extraction
- `tmux-status.sh` (75 lines)
- `tmux-wait.sh` (61 lines)

Source layout:
```
shared/skills/pk-tmux/
  src/tmux_agent/core.clj  — pure: session derivation, arg parsing, marker
                              generation, output extraction
  src/tmux_agent/cli.clj   — dispatch: create|run|status|wait
  bb.edn
  test/tmux_agent/core_test.clj
```

Tests:
- Unit: md5 hashing, session info derivation, marker extraction (8+ cases from agentic-stuff),
  arg parsing
- E2E: create + run round-trip against real tmux

### Slice 3: `review` — code-review/review-file

**Why third:** Small, clean. Good warm-up before detect-lint.

Scripts replaced:
- `review-file.sh` (97 lines)

Source layout:
```
shared/skills/code-review/
  src/review/core.clj      — pure: branch sanitization, path construction, arg parsing
  src/review/cli.clj       — dispatch: create|latest|list
  bb.edn
  test/review/core_test.clj
```

### Slice 4: `detect-lint` — code-review/detect-and-lint

**Why fourth:** Largest script (578 lines). Most compat issues. Biggest win from
pluggable design.

Scripts replaced:
- `detect-and-lint.sh` (578 lines)

Source layout:
```
shared/skills/code-review/
  src/detect_lint/core.clj     — pure: detector registry, tool registry,
                                  result aggregation, summary formatting
  src/detect_lint/detectors.clj — detector definitions (data, not functions)
  src/detect_lint/tools.clj     — tool runner definitions (data + runner fns)
  src/detect_lint/cli.clj       — single entry point, orchestration pipeline
  test/detect_lint/core_test.clj
```

The pluggable design:

```clojure
;; A detector is just data
{:id :node
 :detect (fn [dir] (fs/exists? (fs/path dir "package.json")))}

;; A tool is just data
{:id :eslint
 :lang :node
 :category :lint
 :detect (fn [dir] ...)
 :run (fn [dir] ...)}

;; Adding a new tool = conj to a vector
(def tools [eslint-tool prettier-tool ruff-tool ...])
```

Tests:
- Unit: detector matching, tool selection, result aggregation, summary formatting
- E2E: detection against fixture project directories

### Slice 5: `sandbox` — sandbox skill

**Why last:** Medium complexity but depends on git worktree semantics that are
harder to unit-test. Cleanest after the patterns are established.

Scripts replaced:
- `sandbox-create.sh` (135 lines)
- `sandbox-finish.sh` (104 lines)

Source layout:
```
shared/skills/sandbox/
  src/sandbox/core.clj     — pure: ticket resolution, worktree path derivation,
                              branch naming, config detection
  src/sandbox/cli.clj      — dispatch: create|finish
  bb.edn
  test/sandbox/core_test.clj
```

### Slice 6: Bootstrap integration

Update `scripts/bootstrap.clj` to:
- Install `~/.local/bin/` symlinks for each tool
- Update `settings-permissions.json` to reference new paths
- Remove old `.sh` symlinks on `--force`

Update SKILL.md files to reference new binary names.

## Workflow Per Slice

1. Write `core_test.clj` first (TDD)
2. Implement `core.clj` to pass tests
3. Write E2E cases in `test/e2e/cases.edn`
4. Implement `cli.clj`
5. Verify: `bb test` (all green in podman)
6. Update SKILL.md references
7. Commit: `[shared] rewrite <skill> helpers in babashka`

## Not Rewriting

- `shared/skills/org-journal/new-entry.bb` — already babashka
- `shared/skills/org-journal/update-index.el` — emacs lisp, stays as-is
- `claude/hooks/smart-lint.sh` — Claude hook contract requires shell
- `claude/statusline-command.sh` — Claude statusline contract requires shell
