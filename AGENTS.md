# AGENTS.md

Guidance for agents working in this `dotagents` repo.

## Project shape

This repo maintains parallel agent runtimes and shared helpers:

- `claude/` -- Claude-facing docs/config
- `agents/` -- Codex/agents-facing docs/config
- `shared/` -- shared hooks and helper scripts used by multiple runtimes
- `pi/` -- Pi extensions and themes
- `scripts/` -- repo-local Babashka entrypoints
- `test/` -- unit + E2E tests

## Design principles (for scripting)

### Push I/O to the boundary

Prefer FCIS-style structure:
- keep planning, transformation, merge, and formatting logic pure when possible
- keep filesystem writes, process execution, and CLI exits at the edges

For Babashka scripts in this repo:
- pure logic should be easy to require from tests
- impure logic should stay in small executor / CLI layers

### Prefer shared helpers over duplication

If behavior is the same across runtimes, put it in `shared/` and wire runtime-specific trees around it.
Do not copy helper logic into multiple runtime directories unless the behavior genuinely diverges.

Skills and extensions are cross-platform. Backend auto-detection (cmux, tmux,
or file-only) handles platform differences at runtime, not at build/bootstrap time.
Bootstrap links `shared/skills/` into all runtime trees uniformly.

### Preserve intentional parity across runtimes

When changing shared workflows, check whether the change should also affect:
- `claude/`
- `agents/`
- `shared/`
- `pi/`

In particular:
- agent-facing skill docs should stay meaningfully aligned across `claude/skills/` and `agents/skills/`
- shared executable helpers should live under `shared/` when they are not runtime-specific
- avoid silent capability drift between runtimes

## Bootstrap

Canonical entrypoint:

```bash
bb bootstrap
```

Shortcut alias:

```bash
bb boot
```

Supported modes:

```bash
bb bootstrap claude
bb bootstrap agents
bb bootstrap pi
bb bootstrap all
```

Supported flags:

```bash
bb bootstrap --dry-run
bb bootstrap --force
```

Expected behavior:
- preserve directory structure where runtime install trees are still used
- skip already-correct links
- replace stale symlinks
- do not overwrite regular files unless `--force`
- keep Pi bootstrap limited to extensions + themes via settings, not mirrored install trees

When changing bootstrap behavior:
- update tests first or alongside the code
- keep README/docs in sync
- preserve idempotence

## Testing

### Use `bb.edn` tasks
Prefer repo tasks over ad hoc commands.

```bash
bb test
bb test:unit
bb test:e2e
```

### Containerized E2E is the default
E2E tests are intended to run in podman and should not touch the host environment.

When adding tests:
- keep host writes out of the test flow
- use temporary paths under `/tmp` inside the container
- prefer assertions on resulting state over fragile output scraping

### Unit-test pure functions directly
If logic can be tested without shelling out, do that.

Good unit-test targets:
- pure planning helpers
- merge/transformation functions
- formatting logic
- normalization helpers

### Use fixtures for readable E2E setup
When E2E tests need static input files:
- prefer `test/fixtures/` over giant inline shell blobs
- avoid escaped JSON in `sh -c` when a fixture file is enough

## Relay management

The agent-channel relay (`bun shared/relay/main.ts`) is a long-running
per-user daemon. Manage it through `bb` tasks, not by hand-starting
shells:

```bash
bb relay:status    # PID, uptime, socket, log tail
bb relay:start     # start detached; logs to /tmp/agent-relay.log
bb relay:stop      # SIGTERM, clean shutdown
bb relay:restart   # stop + 700ms pause + start
bb relay:logs      # tail -f the log
```

Use `bb relay:restart` after any change to `shared/relay/server.ts`
(or anything it imports) — the relay caches modules at startup, so
edits don't take effect until the process restarts.

Relay state is in-memory only (`ChannelStore`). A restart wipes every
channel's message history. Active UdsTransport / HttpTransport clients
auto-reconnect and re-subscribe on the next operation.

## end2edn usage in this repo
The E2E suite is intentionally dogfooding-oriented.

When working on E2E tests here:
- use `end2edn` features idiomatically
- prefer setup/teardown plus assertions over one-off shell tricks
- add custom assertions only when they are genuinely useful
- if custom assertions prove broadly useful, consider upstreaming them to `end2edn`

## Pi extension work

### Format TypeScript consistently

When editing Pi extensions, use Prettier with spaces, not tabs:

```bash
bunx prettier --write --parser typescript --use-tabs false pi/extensions/*.ts
```

Check formatting with:

```bash
bunx prettier --check --parser typescript --use-tabs false pi/extensions/*.ts
```

### Preserve extension responsibilities

When changing extensions:
- do not silently repurpose an existing extension without confirmation
- prefer adding a new extension over changing the responsibility of an old one
- treat current runtime UX as a contract unless the user asks to redesign it

Keep responsibilities separated unless explicitly requested otherwise. For example, do not merge footer concerns and conversational branch-status concerns by accident.

## Documentation

When behavior changes, update the relevant docs:
- `README.md`
- `pi/README.md`
- skill docs when applicable
- task/test docs when commands change

Docs should describe the canonical current path, not legacy entrypoints or historical behavior.

## Work tracking

Every non-trivial change references an item in `todos/NNNN-*.md` (sub-tasks use `NNNN.M-*.md`).

- `status: open` → `in_progress` when work starts, with a `[chore] mark #NNNN in_progress` commit as the first commit on the branch.
- `status: in_progress` → `done` in the final commit: `[chore] mark #NNNN done`.
- Use `blocked-by` / `blocks` frontmatter to model sequencing.
- Reference the todo ID in every commit subject on the branch (e.g. `[pi(#0018)] …`, `[relay(#0020)] …`).

**Trivial exceptions** (no todo required): typo fixes, removing a committed temp file, trailing-whitespace or import-order cleanup. Use `[chore] ...` with no todo id. If in doubt, file a todo — takes 30 seconds via `bb -cp ~/.agents/skills/add-todo/src -m todo.cli new`.

## Branches & merges

- The trunk branch is whatever the current default is on this host (today: `master`). References to "trunk" below mean that branch.
- Single-commit chore-style work lands directly on the trunk branch.
- Multi-commit scope uses a flat feature branch named `NNNN-slug`; sub-task scope uses `NNNN.M-slug`. Never `trunk/NNNN-slug` — git refuses nested refs when the parent branch exists.
- Merge feature branches with `git merge --ff-only` to keep history linear; if ff is refused, rebase on trunk first.
- Delete the feature branch after merge.
- Never `git push` without explicit human approval. Never `git commit --amend` a commit that has been reviewed or pushed.

## Commits

Use commit messages in this format:

```text
[category] short description
```

Examples:
- `[pi] fix repo-todos overlay height clipping`
- `[shared] add bootstrap symlink helper`
- `[test] cover stale symlink replacement`

Prefer the narrowest useful category for the area changed, such as:
- `pi`
- `shared`
- `agents`
- `claude`
- `scripts`
- `test`
- `docs`
- `bootstrap`

### Checkpoint commits

When the RED commit is independently meaningful — e.g. a characterization test for a bug that was already passing, or a failing test written before implementation — keep RED and GREEN in separate commits so `git bisect` can distinguish “was the test there?” from “was it passing?” Refactors after green are their own commits.

For bug fixes where the regression test and the fix are logically one unit (test fails only because the fix isn’t applied yet), one commit is fine. Doc-only and refactor-only changes have no test phase to split.

Never squash unrelated concerns into one commit. One logical change per commit.

## Peer review

Implementation is not complete until another agent has reviewed it. The agent-comms flow (see `~/.agents/skills/agent-comms/SKILL.md` for OVER/OUT sign-off conventions and ack-first protocol):

1. **Announce** on the lobby: `review-request` naming the branch, todo ID, and a sub-channel `<your-agent>/review-<NNNN>`.
2. **Sub-channel message** carries: problem statement, commit list, acceptance-criteria checklist, test results, any known warts or deferred items.
3. **Reviewer acks** on the sub-channel (`type: "ack"`), runs tests locally, walks the diff, replies with `code-review` → `APPROVED` or `CHANGES-REQUESTED` with concrete items.
4. **Implementer addresses findings** in new commits (not `amend`). Re-request review by sending a short `status` message on the same sub-channel listing the new commit shas and which findings each addresses; no need to repeat the full `review-request`.
5. **Merge only after `APPROVED`** — and only with explicit human merge authorization.
6. Close the review cycle with mutual OUT: implementer `ack. OUT` once reviewer has approved.

Sub-channels are task-scoped (`pqdw/review-0042`, not `pqdw/review`). A closed channel is dead — new task, new channel.

The protocol mechanics (ack-first, OVER/OUT, turn-suppression for `type: "ack"`) are defined once in `~/.agents/skills/agent-comms/SKILL.md`. If that skill and this section disagree, the skill wins — these AGENTS.md notes are repo-specific overrides, not a second source of truth.

**If the reviewer goes silent**, follow the timeout pattern from the skill: re-ping the sub-channel at ~2 min, notify the human at ~5 min. Do not block the branch indefinitely on an unresponsive reviewer.

## Final check before finishing a change

Before wrapping up, verify:
- there is one obvious canonical implementation for the behavior you changed
- docs match behavior
- tests exercise the canonical entrypoint
- obsolete paths were not accidentally kept alive
- runtime parity is still preserved where it should be
- branch was reviewed and approved before merging; merge was `--ff-only`
- referenced todo is marked `done` in the final commit
