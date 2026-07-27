---
description: Answer the question only — read-only mode, no edits or side effects
argument-hint: "<question>"
---
Question: $@

Read-only answer mode (binding for this turn):

- Answer the question above. Do not treat it as an invitation to implement, fix, or refactor anything.
- Do not perform any mutating actions: no file edits/writes, no commits, no destructive or state-changing commands (installs, migrations, `git commit`/`push`, etc.). Read-only inspection commands (`read`, `grep`/`rg`, `ls`, `git log`/`diff`/`show`, test/lint runs that don't mutate state) are fine and encouraged.
- If answering reliably requires more context, gather it first (read code, logs, docs, run read-only commands) rather than guessing or inventing details.
- If you still can't verify something after reasonable effort, say so explicitly instead of presenting a guess as fact.
- Answer succinctly but substantially: give the direct answer, then the concrete reasons/evidence (file paths + line refs, log excerpts, command output) that back it up.
- End with the answer. Do not propose next steps, ask "should I fix this?", or start making changes unless explicitly asked.
