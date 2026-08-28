---
description: Create a persistent Markdown handoff for another agent
argument-hint: "[path-or-filename|-] [context]"
---
Create a persistent Markdown handoff document so another agent can continue from scratch. Your only task is to write the handoff; do not continue the underlying work.

Invocation arguments:
- Destination: `$1`
- Focus context: `${@:2}`

Resolve the destination as follows:
- If the destination is empty or `-`, create `./notes/YYYY-MM-DD-<semantic-topic>-handoff.md` using today’s ISO date and a content-specific slug.
- If it names a directory, create `YYYY-MM-DD-<semantic-topic>-handoff.md` inside that directory.
- Otherwise, write to the exact path provided.

When focus context is non-empty, emphasize what it asks the next agent to work on while retaining any prerequisites, risks, or decisions needed for a self-contained handoff. Without it, capture the full current discussion and findings.

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
- End with a "Ready-to-run next action" section with the first command or edit to make, but do not execute it.
- After writing, report only the created or updated path and a one-sentence summary.
