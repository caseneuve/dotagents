# Inactive source archive

Nothing here is installed, executed by active tasks or exposed through the Pi
manifest. Historical READMEs, AGENTS, tasks and tests describe their old layouts,
not current setup instructions. Archived AGENTS/CLAUDE guidance uses
`*.original.md` names so starting Pi inside an archive does not auto-load the
obsolete instructions. Do not restore an installer or add archive roots to
resource discovery as a shortcut.

## Approved Pi-only simplification (#0069)

`legacy/` preserves tracked obsolete Claude/Agents trees, unused shared code,
bootstrap/fragments, historical launchers/plans and their obsolete test runners.
This includes unfinished testmap, review/Linear/UX and experiment work: archival
is **not** implementation, cancellation or a false DONE. Existing historical
`todos/` remain the task record; future work can recover the source deliberately.

[`index.json`](index.json) is the per-file recovery map. Every row records:

- `original`: exact path at the default `source_ref`
  **7a592f9c9290b6f670eda23662da2f52f60187bc**; the three already archived
  #0047.1 helpers carry their earlier per-row `source_ref` explicitly;
- `blob`, `mode`: original Git object ID and executable mode;
- `archive`: byte/mode-preserving tracked destination;
- `replacement`: canonical maintained replacement, or explicit `null` (none);
- `disposition`: why it is historical, including unfinished/superseded scope.

Five canonical skills/helpers moved to root `skills/`; five canonical prompts
moved to root `prompts/`. They were **not** archived. Current docs/tasks live at
the root. Replaced historical docs/runners remain in the archive for context.
Old mixed E2E suites contain obsolete bootstrap/tmux cases; retained todo behavior
now runs against the actual skill-local wrapper in `test/native_resources_test.py`.
No mux-bb, end2edn checkout, relay wrapper or runtime installer is an active
root dependency. The original task/runner bytes remain recoverable.

Only tracked files moved. No ignored dependency tree, secret, settings, cache,
session, untracked review artifact or dirty user work was swept into the archive.
Git history and original refs remain; the index is not a backup of untracked work.

## Separate soak-gated preparation — NOT LANDABLE

**This is that separate #0069.1 PREPARED branch, NOT LANDABLE YET.** The
manifest-excluded `pi/extensions/`, `pi/themes/` and `test/pi/` files are archived
here; they remain at original paths in the approved landable core
`2dc662c7f1f8ae250266490822b0fac5bf800def`, which is an ancestor of this branch.
[`pi/retirement-index.json`](pi/retirement-index.json) records all 49 original
paths/Git blobs/modes, destinations and explicit canonical package/path/reviewed
ref (or null). Conversation/workbench/runtime/theme entries are historical
predecessors, not claimed byte-identical to maintained successors. Shared helper
ownership can name both workbench/runtime copies explicitly. Playwright and
Tree-sitter experiments have no maintained replacement; their unfinished work,
tracked lockfiles and design bytes are preserved, not marked delivered.

Only inventoried tracked files move; no ignored dependencies/secrets/local work.
The active native manifest, all canonical skills/helpers/prompts and the three
previously archived helper sources remain unchanged. Historical tests move with
their implementations and are not active runner inputs. `bb test:native` now
also verifies all 49 prepared blobs/modes and the unchanged, unwaived gate.

The original requirement remains: at least **seven calendar days AND five normal
sessions across two projects per active OS**, including startup/reload,
representative and selective/project-local use, followed by explicit exact-scope
approval. Cutover began 2026-11-15T16:20:48Z, so the earliest calendar date is
2026-11-22T16:20:48Z, not automatic eligibility. No completed soak is asserted.
A prepared/reviewed archive commit is not authorization to land it.

The [three previously approved helper archives](pi/README.md) remain unchanged.
That approval does not establish general retirement or equivalent native behavior.

## Recovery (review first)

Inspect a row and its exact original Git object, for example:

```sh
git show 7a592f9c9290b6f670eda23662da2f52f60187bc:scripts/bootstrap.clj
git ls-tree 7a592f9c9290b6f670eda23662da2f52f60187bc scripts/bootstrap.clj
```

For approved recovery, create a **new branch**, restore only selected original
paths from the recorded source ref or copy the indexed archived bytes with the
recorded mode. Compare hashes/modes first and preserve any later work; do not
reset/clean a checkout or blindly reverse all moves. Historical source may need
current API review and is not automatically loaded by restoring bytes. Never
overwrite live settings/auth/PATH/installations or a running Pi as part of recovery.
