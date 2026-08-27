---
description: Create a persistent Markdown handoff for another agent
argument-hint: "[path-or-filename|-] [context]"
---
Create a persistent Markdown handoff document so another agent can continue from scratch.

If `$1` is provided and is not `-`, treat it as the output path. If it is omitted or `-`, create `./notes/YYYY-MM-DD-<semantic-topic>-handoff.md` using today’s ISO date and a content-specific slug. Use `-` when providing focus context without a custom path.

Focus context (optional, all arguments after the destination): ${@:2}

When focus context is provided, emphasize what it asks the next agent to work on while retaining any prerequisites, risks, or decisions needed for a self-contained handoff. Without it, capture the full current discussion and findings.

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
