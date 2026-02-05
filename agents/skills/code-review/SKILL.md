---
name: code-review
description: Review uncommitted changes or a branch diff, run automated checks, and write a structured review file that another agent can consume.
---

# Code Review

Use this skill for reviews of local diffs, staged changes, or branch-to-branch comparisons.

## Optional arguments

- `--todo <ref>`: review against a todo, ADR, or issue reference
- `--host-tests`: explicitly allow test execution on the host

## Phase 1: gather context

1. Get the change set with `git diff HEAD`, `git diff --cached`, or `git diff <base>..HEAD`.
2. If diffing against a base branch, check divergence with `git log --oneline HEAD..<base>`.
3. Detect project type from files such as `package.json`, `pyproject.toml`, `deps.edn`, `Cargo.toml`, or `go.mod`.
4. Read project docs and local agent rules.
5. Sample a few nearby files to understand established patterns.

## Phase 2: automated checks

Run `~/.agents/skills/code-review/detect-and-lint.sh`.

## Output

Save the review with `~/.agents/skills/code-review/review-file.sh` so another agent can find it later.
