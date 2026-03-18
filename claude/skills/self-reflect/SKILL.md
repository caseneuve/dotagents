---
name: self-reflect
triggers:
  - self-reflect
  - reflect
  - what went wrong
  - improve rules
  - session review
---

# self-reflect — Session Self-Diagnosis

Use this skill to critically review the current session, identify mistakes and friction points, and propose concrete improvements to docs and rules.

## Process

### 1. Read all governing docs

Read every doc that shapes agent behavior in this project:

- `~/.claude/CLAUDE.md` (global rules)
- Project-local `CLAUDE.md` / `AGENTS.md` (if present)
- `.claude/rules/*.md` (if any)
- All skill files referenced from the skills table
- `~/.claude/journal/` entries (recent, if any)
- Auto-memory files in `~/.claude/projects/*/memory/`

Do NOT skip this step. You need the full rule set to judge whether a mistake was caused by a missing rule, a vague rule, or a rule that was ignored.

### 2. Critically review the session

Walk through the conversation from the start. For each exchange, ask:

- Did the agent follow the rules?
- Was the user satisfied, or did they correct / redirect / express frustration?
- Did the agent waste effort (wrong approach, unnecessary work, over-engineering)?
- Did the agent miss something obvious?
- Did the agent ask when it should have acted, or act when it should have asked?

Produce a list of **findings**, each with:

| Field       | Content                                                    |
|-------------|------------------------------------------------------------|
| **What**    | Factual description of what happened                       |
| **Why**     | Root cause (missing rule, vague rule, ignored rule, gap)   |
| **Impact**  | Wasted time, wrong output, user frustration, risk          |
| **Fix**     | Specific doc/rule change that would prevent recurrence     |
| **Where**   | Which file to change (`CLAUDE.md`, skill, memory, etc.)    |

### 3. Ask the user clarifying questions

If any finding is ambiguous — e.g., the user redirected but the reason isn't clear — ask concise, targeted questions:

- "You corrected me when I did X. Was the issue Y or Z?"
- "You seemed frustrated at step N. What should I have done instead?"

Do NOT ask questions you can answer from the conversation or docs. Keep the list short.

### 4. Present diagnosis and proposals

Show the user:

1. **Session score** — quick honest assessment (e.g., "Mostly good, two significant missteps")
2. **Findings table** — from step 2, refined with user answers from step 3
3. **Proposed changes** — grouped by target file, showing exact additions/edits:

```
## Proposed Changes

### ~/.claude/CLAUDE.md
- Add to MUST NOT: "Do not X when Y"

### skills/foo/SKILL.md
- Add step: "Before Z, always check W"

### ~/.claude/projects/.../memory/MEMORY.md
- Add: "User prefers A over B"
```

### 5. Apply approved changes

If the user approves (all or selectively), apply the edits. Do not apply anything the user hasn't confirmed.

After applying, briefly summarize what was changed.

---

## Guidelines

- Be honest, not defensive. The point is to improve.
- Be constructive (instead of "sorry, it's on me", suggest concrete improvements for the future)
- Prioritize findings by impact — user frustration and wasted time over minor style issues.
- Prefer precise, minimal rule changes over broad rewrites.
- If the session was clean, say so — don't manufacture findings.
- Consider whether a fix belongs in rules (CLAUDE.md), a skill, memory, or a journal entry.

## Example Invocations

```
User: /self-reflect
User: /reflect
User: what went wrong this session?
User: let's review and improve the rules
```
