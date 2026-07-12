---
title: Add cwd selection to Pi diff review
status: open
priority: medium
type: feature
labels: []
created: 2026-06-21
parent: null
blocked-by: []
blocks: []
---

## Context

Pi's `/diff` extension currently runs git commands relative to the process current working directory. When a Pi session is launched from one repository but the human wants to review work in another repository, the diff viewer cannot target that other project without restarting Pi from the desired repo.

Add an explicit, low-ambiguity way to select the repository/directory for a diff review dynamically.

## Acceptance Criteria

- [ ] `/diff --cwd DIR ...` or equivalent explicit option lets the human review diffs for a repo outside Pi's launch cwd.
- [ ] The option supports absolute paths, relative paths, and `~` expansion.
- [ ] The selected path is validated as a git worktree and normalized to the git top-level before diff collection.
- [ ] Existing modes still work from the selected repo: default worktree diff, `staged`, `dirty`, `dirty-all`, `latest`, `master`, numeric commit count, and custom revspecs.
- [ ] `dirty` / `dirty-all` submodule diff collection uses the selected repo root rather than `process.cwd()`.
- [ ] Review comments sent back to the agent include enough repo context for repo-relative file paths to be unambiguous.
- [ ] Argument parsing avoids guessing that a positional revspec is a path; cwd selection is explicit.
- [ ] Tests cover cwd parsing/path normalization and submodule cwd threading.
- [ ] Pi README documents the cwd/repo option with examples.

## Affected Files

- `pi/extensions/diff-review.ts` — parse cwd option, validate repo root, thread cwd through git/untracked/submodule diff collection, and include repo context in rendered comments.
- `test/pi/diff-review.test.ts` — cover parsing and cwd-sensitive helpers.
- `pi/README.md` — document the new `/diff --cwd DIR` usage.

## E2E Spec

GIVEN Pi was launched from repository A
AND repository B has unstaged or dirty changes
WHEN the human runs `/diff --cwd /path/to/repository-b dirty-all`
THEN the review buffer contains repository B's diff
AND any inline comments sent to the agent identify repository B as the reviewed repo.

## Notes

Prefer an explicit option such as `--cwd DIR` / `--cwd=DIR` or `--repo DIR` over implicit positional directory detection, because branch names and revspecs can look like paths.
