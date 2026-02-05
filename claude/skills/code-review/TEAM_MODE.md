# Code Review Parallelization

Use this reference only when the current runtime actually supports parallel subagents or team orchestration. It is not a portable agent-skills standard.

For Claude-specific environments that expose team-style orchestration, this file can be used as the review split. In runtimes without those capabilities, ignore this file and run the review sequentially.

## Suggested split

- Agent 1: automated checks via `detect-and-lint.sh`
- Agent 2: code quality, tests, complexity, and performance
- Agent 3: docs, security, API design, and tracking updates

## Lead workflow

1. Complete context gathering first so every reviewer sees the same diff and project rules.
2. Dispatch the automated and manual review passes in parallel only if the runtime supports that.
3. Merge findings into one review file and deduplicate overlaps.
4. Fall back to a single-agent review if parallel execution fails or is unavailable.
