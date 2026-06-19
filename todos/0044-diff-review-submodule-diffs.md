---
title: Show dirty submodule diffs in Pi diff review
status: in_progress
priority: medium
type: feature
labels: []
created: 2026-06-19
parent: null
blocked-by: []
blocks: []
---

## Context

The Pi `diff-review` extension currently runs `git diff` only in the current worktree. When a repository contains dirty submodules, the review buffer shows at most the superproject gitlink/status change and omits the actual file-level diffs inside each submodule. Reviewers need one review buffer that includes dirty submodule changes recursively, with paths anchored clearly enough for inline comments to be sent back to the agent.

## Acceptance Criteria

- [ ] `/diff dirty` and `/diff-dirty` include tracked staged/unstaged dirty diffs from dirty submodules recursively.
- [ ] `/diff dirty-all` and `/diff-dirty` include untracked file diffs from dirty submodules recursively.
- [ ] Submodule diff paths are rewritten or prefixed so `parseReviewComments` anchors comments to the superproject-relative submodule file path.
- [ ] Clean submodules do not add noise to the review buffer.
- [ ] Failures while inspecting a submodule produce a useful UI error instead of silently omitting changes.
- [ ] Tests or a documented manual verification cover nested submodules, tracked changes, and untracked files.

## Affected Files

- `pi/extensions/diff-review.ts` — discover submodules recursively, collect per-submodule diffs, and path-prefix appended patches.
- `test/` or relevant Pi extension tests — verify submodule diff inclusion and path anchoring if a suitable test harness exists.
- `pi/README.md` or related docs — update command behavior if user-facing docs mention diff scope.

## E2E Spec

GIVEN a superproject with a nested dirty submodule containing tracked and untracked file changes
WHEN the user runs `/diff dirty-all`
THEN the editor review buffer includes the superproject diff plus file-level diffs from the submodule using superproject-relative paths.

## Notes

Implementation likely needs to run git commands with an explicit cwd or `git -C <path>` instead of assuming `process.cwd()`. Consider `git submodule foreach --recursive` or parsing `git submodule status --recursive`; path rewriting should preserve normal `diff --git a/... b/...` headers so existing inline comment parsing keeps working.
