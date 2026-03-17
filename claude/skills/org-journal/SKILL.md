---
name: org-journal
triggers:
  - org-journal
  - session log
  - work log
  - log session
---

# org-journal — Session Work Journal (Org Mode)

Entries stored in `~/org/agent-journal/YYYY/MM/dd/HHMM-<project>.org`.

## Process

1. **Get metadata** — run helper script:
   ```bash
   bb ~/.claude/skills/org-journal/new-entry.bb [--mkdir] [project-name]
   ```
   Returns EDN map with `:path :date :hostname :agent :project :branch :ticket :commits :dirs-exist :last-entry`.
   If `:project` is `"unknown"`, the map includes `:suggestions [hostname os-name]` — use `AskUserQuestion` to pick a name, then re-run with `--mkdir <chosen-name>`.

2. **Read last entry** — if `:last-entry` is non-nil, read it for prior state and next steps.

3. **Determine** `:LLM_CATEGORY:` (`feature|bug|refactor|chore`) and `FILETAGS` (always include `:agent-journal:`, `:claude:`, and the project name; add language/domain tags as appropriate).

4. **Fill template** → show user for review → write to `:path` → rebuild index:
   ```bash
   emacs --batch -l ~/.claude/skills/org-journal/update-index.el
   ```

## Template

Inline markup: `=code=` for symbols/hashes/flags, `~path~` for paths.
Omit any optional section if there's nothing meaningful to write.
Bracketed values in the template (for example `[YYYY-MM-DD HH:MM]`) are placeholders to replace, not literal brackets to keep.
`Learnings`, `Mistakes & Feedback`, and `Insights` are optional sections: include them only when useful, otherwise omit those headings entirely.

```org
#+TITLE: [concise title]
#+DATE:  [YYYY-MM-DD HH:MM]
#+STARTUP: showall
#+LLM_SCHEMA: v1
#+FILETAGS: :agent-journal:claude:project:tags:

* Meta
:PROPERTIES:
:LLM_PROJECT:  [project]
:LLM_AGENT:    [agent]
:LLM_BRANCH:   [branch]
:LLM_TICKET:   [ticket|none]
:LLM_CATEGORY: [feature|bug|refactor|chore]
:LLM_MACHINE:  [hostname]
:END:

* Summary
[1-3 sentences: ticket, scope, what was done]

* State
[Completed / in-progress / blocked. If not done: what remains or blocks it]

* Learnings
[Optional. Useful findings. Short code snippets welcome]

* Mistakes & Feedback
[Optional. Wrong approaches, corrections. Omit if session was clean]

* Commits
- =hash= [message]

* Next Steps
- [Actionable item to resume]

* Insights
[Optional. Process/workflow observations worth preserving]
```
