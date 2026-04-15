# AGENTS.md

Guidance for agents working in this `dotagents` repo.

## Project shape

This repo maintains parallel agent runtimes and shared helpers:

- `claude/` -- Claude-facing docs/config
- `agents/` -- Codex/agents-facing docs/config
- `shared/` -- shared hooks and helper scripts used by multiple runtimes
- `shared/darwin/` -- macOS-specific shared skills (bootstrapped on Darwin only)
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

For platform-specific skills (e.g. macOS-only), the canonical content lives in
`shared/darwin/skills/`. Runtime trees (Pi extensions, etc.) symlink back to it.
Bootstrap handles symlinking into `~/.agents/skills/` on Darwin automatically.

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

## Final check before finishing a change

Before wrapping up, verify:
- there is one obvious canonical implementation for the behavior you changed
- docs match behavior
- tests exercise the canonical entrypoint
- obsolete paths were not accidentally kept alive
- runtime parity is still preserved where it should be
