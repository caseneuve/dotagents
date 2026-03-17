---
name: org-journal
description: Create structured session logs in `~/org/agent-journal/` using helper scripts that gather project, branch, ticket, commit context, and the writing agent identity.
---

# Org Journal

Use this skill for session logs that should be kept in Org mode rather than Markdown.

Entries live in `~/org/agent-journal/YYYY/MM/dd/HHMM-<project>.org`.

## Process

1. Get metadata:
   ```bash
   bb ~/.agents/skills/org-journal/new-entry.bb [--mkdir] [project-name]
   ```
   The helper returns an EDN map with `:path :date :hostname :agent :project :branch :ticket :commits :dirs-exist :last-entry`.

   If `:project` is `"unknown"` and the helper includes `:suggestions`, choose a sensible project name from the suggestions or from local repo context, then re-run with `--mkdir <chosen-name>`.

2. If `:last-entry` is non-nil, read it first for prior state and any unfinished next steps.

3. Determine `:LLM_CATEGORY:` (`feature|bug|refactor|chore`) and `FILETAGS`.
   Always include `:agent-journal:`, the agent tag (for example `:codex:`), and the project name.

4. Write the entry to `:path`, then rebuild the shared index:
   ```bash
   emacs --batch -l ~/.agents/skills/org-journal/update-index.el
   ```

## Template

Use inline `=code=` for symbols, hashes, and flags, and `~path~` for paths.
Skip optional sections when they add no signal.

```org
#+TITLE: [concise title]
#+DATE:  [YYYY-MM-DD HH:MM]
#+STARTUP: showall
#+LLM_SCHEMA: v1
#+FILETAGS: [:agent-journal:agent:project:tags:]

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
[1-3 sentences: scope, what was done, current status]

* State
[Completed / in-progress / blocked. If not done: what remains or blocks it]

* Learnings                                                        :optional:
[Useful findings that should survive the session]

* Mistakes & Feedback                                              :optional:
[Wrong turns, corrections, or workflow issues]

* Commits
- =hash= [message]

* Next Steps
- [Actionable item to resume]

* Insights                                                         :optional:
[Process or tooling observations worth preserving]
```
