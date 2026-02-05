---
name: journal
triggers:
  - journal
  - post-mortem
  - postmortem
  - document mistake
  - learning
  - lesson learned
---

# journal - Agent Learning Journal

Use this skill to document mistakes, learnings, and patterns for future reference. Entries are stored in `~/.claude/journal/` for agents to consult.

## Entry Types

| Type          | Trigger             | Purpose                                         |
|---------------|---------------------|-------------------------------------------------|
| `post-mortem` | `/post-mortem`      | Document mistakes, bad behavior, failures       |
| `learning`    | `/journal learning` | Document useful patterns, discoveries, insights |

## Storage

```
~/.claude/journal/
├── YYYY-MM-DD-post-mortem-brief-slug.md
├── YYYY-MM-DD-learning-brief-slug.md
└── ...
```

## Process

### 1. Gather context

Ask the user (or recall from conversation):
- What happened?
- What was the impact?
- What's the lesson?

### 2. Create entry

Use the appropriate template below. File naming:
```
~/.claude/journal/YYYY-MM-DD-{type}-{slug}.md
```

Where `slug` is 2-4 words, lowercase, hyphenated (e.g., `deleted-user-files`, `wrong-test-pattern`).

### 3. Confirm with user

Show the entry before writing. The user may want to add context or adjust.

---

## Templates

### Post-Mortem Template

For documenting mistakes and failures.

```markdown
---
type: post-mortem
date: YYYY-MM-DD
project: [project name or path]
tags: [relevant tags: destructive, test, build, git, etc.]
severity: [low | medium | high | critical]
---

# [Brief title describing what went wrong]

## What Happened

[Factual description of the incident]

## Root Cause

[Why did this happen? What led to the mistake?]

## Impact

[What was the outcome? Data loss? Broken build? Wasted time?]

## Prevention

[How to avoid this in the future. Be specific and actionable.]

## Checklist Addition

[If applicable: specific check to add to code-review or workflow]
```

### Learning Template

For documenting useful patterns and insights.

```markdown
---
type: learning
date: YYYY-MM-DD
project: [project name or path]
tags: [relevant tags]
---

# [Brief title describing the learning]

## Context

[When/where did this come up?]

## Insight

[What was learned? What's the pattern or technique?]

## Application

[When to apply this learning in the future]

## Example

[Optional: code snippet or concrete example]
```

---

## Example Entry

```markdown
---
type: post-mortem
date: 2025-02-05
project: babagen
tags: [destructive, cleanup]
severity: critical
---

# Cleanup function deleted all files

## What Happened

Ran `cleanup-orphaned-posts` which deleted all directories including .git.

## Root Cause

Empty input set meant ALL directories were "orphaned". Agent violated TDD rules.

## Prevention

- Always check for empty input sets before destructive operations
- Add defensive test: "refuses to delete when source data is empty"
```

---

## Example Invocations

```
User: /post-mortem
User: /journal learning
User: document this mistake
User: let's do a post-mortem on what just happened
```
