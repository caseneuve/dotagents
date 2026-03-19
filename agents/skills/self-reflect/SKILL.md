---
name: self-reflect
description: Review the current session for mistakes and friction, then propose targeted improvements to docs and rules.
---

# Self-Reflect

Use this skill to critically review the current session and turn mistakes into durable improvements.

## Process

### 1. Read all governing docs

Read every document that shapes agent behavior:

- Global agent rules (`AGENTS.md`, `CLAUDE.md`)
- Project-local rules and `.claude/rules/*.md` if present
- All referenced skill files
- Recent journal entries (`~/org/agent-journal/`)
- Auto-memory files

You need the full rule set to judge whether a mistake stems from a missing rule, a vague rule, or an ignored rule.

### 2. Critically review the session

Walk through the conversation. For each exchange, evaluate:

- Did the agent follow the rules?
- Was the user satisfied, or did they correct, redirect, or show frustration?
- Did the agent waste effort or miss something obvious?
- Did the agent ask when it should have acted, or act when it should have asked?

Produce findings, each with:

- **What**: factual description
- **Why**: root cause (missing rule, vague rule, ignored rule, gap)
- **Impact**: wasted time, wrong output, user frustration, risk
- **Fix**: specific doc or rule change to prevent recurrence
- **Where**: target file (`AGENTS.md`, skill, memory, journal)

### 3. Ask the user clarifying questions

If any finding is ambiguous, ask concise targeted questions. Do not ask things answerable from the conversation or docs.

### 4. Present diagnosis and proposals

Show:

1. A brief honest session assessment
2. The findings table from step 2 (refined with user input)
3. Proposed changes grouped by target file with exact additions or edits

### 5. Apply approved changes

Only apply changes the user explicitly confirms. Summarize what was changed.

For symlink-managed agent configs:
- Apply edits in the source-of-truth repository, not only in the live local path (unless the user explicitly asks for local-only setup changes).
- If the source-of-truth location is unclear, ask once before editing.

## Guidelines

- Be honest, not defensive.
- Be constructive (instead of "sorry, it's on me", suggest concrete improvements for the future)
- Prioritize by impact: user frustration and wasted time first.
- Prefer precise, minimal rule changes over broad rewrites.
- If the session was clean, say so.
- Route fixes to the right place: rules, skills, memory, or journal.
