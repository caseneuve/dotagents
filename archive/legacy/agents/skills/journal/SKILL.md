---
name: journal
description: Record post-mortems and durable learnings in `~/.agents/journal` so future agents can reuse them.
---

# Journal

Use this skill to write short, durable notes about failures, corrections, and reusable patterns.

Entries live in `~/.agents/journal/`.
Create the directory on first use if it does not exist yet.

## Entry types

- `post-mortem`: document a mistake, failure, or risky behavior that should change future behavior
- `learning`: document a reusable pattern, discovery, or useful technique

## File naming

Use:

```text
~/.agents/journal/YYYY-MM-DD-{type}-{slug}.md
```

The slug should usually be 2-4 lowercase hyphenated words, such as `wrong-test-pattern` or `deleted-user-files`.

## Process

1. Gather the minimal context: what happened, what the impact was, and what should be learned from it.
2. Pick `post-mortem` or `learning`.
3. Draft the entry with the matching template.
4. Show the draft to the user before writing if the content depends on user intent or shared interpretation.
5. Ensure `~/.agents/journal/` exists.
6. Write the file under `~/.agents/journal/`.

## Post-mortem template

Use for mistakes and failures:

```markdown
---
type: post-mortem
date: YYYY-MM-DD
project: [project name or path]
tags: [destructive, test, build, git]
severity: [low | medium | high | critical]
---

# [Brief title]

## What Happened

[Factual description]

## Root Cause

[Why it happened]

## Impact

[Outcome and cost]

## Prevention

[Specific actions to avoid recurrence]

## Checklist Addition

[Optional workflow or review check to add]
```

## Learning template

Use for durable, reusable insights:

```markdown
---
type: learning
date: YYYY-MM-DD
project: [project name or path]
tags: [relevant tags]
---

# [Brief title]

## Context

[Where this came up]

## Insight

[What was learned]

## Application

[When to use it]

## Example

[Optional concrete example]
```
