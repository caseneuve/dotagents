---
description: Dump current findings into a persistent Markdown handoff doc
argument-hint: "[path-or-filename]"
---
Create a persistent Markdown handoff document that captures the current discussion/findings so another agent can continue from scratch.

If $1 is provided, write to that path. Otherwise, create `./notes/YYYY-MM-DD-<semantic-topic>-handoff.md` using today’s ISO date and a content-specific slug.

Include, at minimum:
- Goal / request summary
- Key decisions and rationale
- Findings and evidence (commands run, files inspected, relevant outputs)
- Files changed or proposed changes (with paths)
- Open questions / risks
- Exact next steps another agent can execute immediately

Requirements:
- Be precise and self-contained; avoid references like "as discussed above".
- Prefer bullets and short sections for scanability.
- Include concrete file paths, command snippets, and acceptance criteria where relevant.
- End with a "Ready-to-run next action" section with the first command or edit to make.
