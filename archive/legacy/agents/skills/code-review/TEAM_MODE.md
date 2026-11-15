# Code Review Parallelization

Use this reference only when the current agent runtime actually supports parallel subagents. Otherwise ignore it and run the review sequentially.

## Suggested split

- Agent 1: automated checks via `detect-and-lint.sh`
- Agent 2: code quality, tests, complexity, and performance
- Agent 3: docs, security, API design, and tracking updates
