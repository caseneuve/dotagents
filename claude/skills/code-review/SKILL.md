---
name: code-review
triggers:
  - code review
  - review changes
  - review my code
  - review diff
  - check my changes
  - CR
---

# code-review — Comprehensive Code Review

## Optional Arguments

| Argument       | Purpose                                                         |
|----------------|-----------------------------------------------------------------|
| `--todo <ref>` | Review against a todo/ADR/issue (e.g. `--todo TODO.md#3`)       |
| `--host-tests` | Allow running tests on host (skip containerization requirement) |

## Phase 1: Context Gathering

1. **Get changes:** `git diff HEAD` (default), `git diff --cached`, or `git diff <base>..HEAD`

   **If no uncommitted changes:** use `--todo` ref if provided, otherwise ask what to review against. Fall back to `git log -10 --oneline` against identified scope.

   **Divergence check (worktree branches):** When diffing against a base branch (e.g. master), check if the base has moved ahead:
   ```bash
   git log --oneline HEAD..master   # commits on master not in this branch
   ```
   If this shows commits, the base branch has advanced since this branch diverged. Lines appearing as "deletions" in the diff may actually be **new additions on the base branch**, not code removed by the developer. In this case:
   - **Do NOT flag those "deletions" as issues** — the developer never had that code.
   - Add a **Critical** finding: *"Base branch (master) has diverged — N commits ahead. The diff includes changes from master that this branch doesn't have, which may appear as false deletions. Rebase onto master before continuing: `git rebase master`. If unsure, ask the user for the correct approach."*
   - Skip the rest of the review checklist until the branch is rebased, as findings will be unreliable.

2. **Detect project type** — check for `package.json`, `pyproject.toml`, `deps.edn`, `Cargo.toml`, `go.mod`, etc.

3. **Read project docs** — `README.md`, `CONTRIBUTING.md`, linter configs

4. **Check local rules:**
   - `CLAUDE.md` in project root (distinct from `~/.claude/CLAUDE.md`)
   - `.claude/rules/*.md` — treat as mandatory review criteria
   - If local rules conflict with global `~/.claude/CLAUDE.md`, ask user for clarification before proceeding. Local rules take precedence for project-specific concerns.

5. **Sample 2–3 existing files** to understand established patterns

## Phase 2: Automated Checks

```bash
~/.claude/skills/code-review/detect-and-lint.sh [project-dir]
~/.claude/skills/code-review/detect-and-lint.sh --skip-tests
~/.claude/skills/code-review/detect-and-lint.sh --run-tests
```

The script detects project type, runs linters/formatters/type checkers, and handles test containerization detection automatically.

**Test policy:**
- Containerization detected → tests run automatically
- `--host-tests` passed → run on host without asking
- Neither → ask: *"No containerized test setup detected. Run on host, or skip?"*

**If tool suggestions appear → ask user before installing anything.**

## Phase 3: Review Checklist

### General Engineering
- [ ] DRY — duplicated logic that should be extracted?
- [ ] YAGNI — speculative code, unused params, over-engineering?
- [ ] Single Responsibility — each function/module does one thing?
- [ ] Pure/impure separation — side effects isolated?
- [ ] Function length > 30 lines or nesting > 3 levels?
- [ ] Naming consistent with codebase conventions?

### Documentation
- [ ] Comments explain "why" not "what"
- [ ] No obvious docstrings on self-evident functions
- [ ] Complex logic, workarounds documented
- [ ] Docs/comments updated if behavior changed

### Tests
- [ ] New code paths covered?
- [ ] Tests verify real behavior (not tautologies or mock-assertion loops)?
- [ ] Tests isolated from external state and execution order?
- [ ] Test names describe scenario and expected outcome?

### Security
- [ ] No hardcoded credentials or secrets in logs/URLs
- [ ] Input validated/sanitized
- [ ] Parameterized queries (no string SQL)
- [ ] File paths validated against traversal

### Error Handling
- [ ] No swallowed errors or empty catch blocks
- [ ] Errors include context; recovery strategy appropriate

### Consistency & Performance
- [ ] Matches codebase style and error handling patterns
- [ ] No N+1 queries; appropriate data structures; resources cleaned up

### API Design (if public interfaces changed)
- [ ] Breaking changes intentional and documented?
- [ ] Consistent with existing API patterns and defaults?

## Output Format

**Save review to file** so other agents can access it:

```bash
REVIEW_SCRIPT=~/.claude/skills/code-review/review-file.sh
REVIEW_PATH=$($REVIEW_SCRIPT create)          # Reviewer: get new timestamped path
REVIEW_PATH=$($REVIEW_SCRIPT latest)          # Implementing agent: find latest review
$REVIEW_SCRIPT list                           # List all reviews for current branch
$REVIEW_SCRIPT create --branch feat/auth      # Override branch detection
```

Write the full review to `$REVIEW_PATH` and print the path for the user. If the current runtime supports parallel agent coordination, share that path with the implementing agent using the runtime's native mechanism.

```markdown
# Code Review: [brief description]

## Summary
[1-2 sentence overview and overall assessment]

## Automated Checks
- Tests: PASS/FAIL (X passed, Y failed)
- Linter: PASS/FAIL (N issues)
- Types: PASS/FAIL (N errors)

## Findings

### Critical (must fix)
- [ ] **[FILE:LINE]** [Category]: [Issue]
  - Current: `[snippet]`
  - Suggested: `[fix]`
  - Reason: [why]

### Important (should fix)
- [ ] **[FILE:LINE]** [Category]: [Issue]

### Minor (consider fixing)
- [ ] **[FILE:LINE]** [Category]: [Issue]

### Positive Observations
- [What was done well]

## Test Coverage Assessment
[Analysis of test quality]

## Security Assessment
[Issues found, or "No security issues identified"]

## Documentation & Tracking

### Updates Required
- [ ] `README.md`: [what or "No updates needed"]
- [ ] `CHANGELOG.md`: [what or "No updates needed"]
- [ ] `TODO.md` / in-code TODOs / issues: [what or "No updates needed"]

**Action Required**: Update any checked items BEFORE committing.

## Recommendations
1. [Prioritized action]
2. [Next action]
```

---

## Advanced: Parallel Team Mode
See `~/.claude/skills/code-review/TEAM_MODE.md`
