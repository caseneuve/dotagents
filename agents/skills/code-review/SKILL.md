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
2. If there are no uncommitted changes, use the provided `--todo` reference if available. Otherwise review the requested branch or recent commits explicitly.
3. If diffing against a base branch, check divergence with `git log --oneline HEAD..<base>`.
4. Detect project type from files such as `package.json`, `pyproject.toml`, `deps.edn`, `Cargo.toml`, or `go.mod`.
5. Read project docs and local agent rules.
6. Sample a few nearby files to understand established patterns.

If the base branch has moved ahead, treat the diff carefully. Apparent deletions may actually be code that exists only on the newer base branch. In that case:

- Do not flag those lines as removals by the author.
- Raise a Critical finding that the branch has diverged and review results are unreliable until rebased.
- Stop the checklist-based review until the divergence is resolved.

## Phase 2: automated checks

Run:

```bash
~/.agents/skills/code-review/detect-and-lint.sh [project-dir]
~/.agents/skills/code-review/detect-and-lint.sh --skip-tests
~/.agents/skills/code-review/detect-and-lint.sh --run-tests
```

Test policy:

- If the project has a containerized test path, prefer it.
- If `--host-tests` is explicitly allowed, host test execution is acceptable.
- Otherwise, do not run host tests silently. Call out the limitation or get explicit permission.
- If the script suggests installing tools, ask the user before doing so.

## Phase 3: review checklist

Check for issues in these areas:

- General engineering: DRY, YAGNI, single responsibility, pure versus impure boundaries, control-flow complexity, naming consistency
- Documentation: comments explain why, behavior changes reflected in docs, complex logic justified
- Tests: new paths covered, behavior-oriented assertions, isolation, clear names
- Security: secrets exposure, input validation, path traversal, unsafe query construction
- Error handling: swallowed failures, poor context, weak recovery behavior
- Consistency and performance: style fit, resource cleanup, query shape, obvious inefficiencies
- API design: intentional breaking changes, compatibility with existing interface patterns

## Output

Save the review with `~/.agents/skills/code-review/review-file.sh` so another agent can find it later:

```bash
REVIEW_SCRIPT=~/.agents/skills/code-review/review-file.sh
REVIEW_PATH=$($REVIEW_SCRIPT create)
REVIEW_PATH=$($REVIEW_SCRIPT latest)
$REVIEW_SCRIPT list
```

Write a structured review with:

- brief summary
- automated check results
- findings grouped by `Critical`, `Important`, and `Minor`
- file and line references for each finding
- a short test coverage assessment
- any required doc or tracking updates

Use a template like:

```markdown
# Code Review: [scope]

## Summary
[1-2 sentence assessment]

## Automated Checks
- Tests: PASS/FAIL
- Linter: PASS/FAIL
- Types: PASS/FAIL

## Findings

### Critical
- [ ] **[file:line]** [issue]

### Important
- [ ] **[file:line]** [issue]

### Minor
- [ ] **[file:line]** [issue]

## Test Coverage Assessment
[coverage quality, gaps, and risk]

## Security Assessment
[issues found, or "No security issues identified"]

## Positive Observations
- [what was done well]

## Documentation & Tracking
- [ ] README or docs updates
- [ ] changelog or task tracking updates
```

Primary goal: identify bugs, regressions, risks, and missing tests before style nits.

For multi-agent review flows, also read `TEAM_MODE.md` when relevant.
