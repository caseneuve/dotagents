---
description: Force concise replies (max 3 short paragraphs)
argument-hint: "[context...]"
---
If context is provided ($@), respond concisely about that context using the protocol below. If no context is provided, treat this prompt as a binding protocol for subsequent communication unless explicitly revoked.

Protocol:

- Use minimal necessary information to fulfill the user request.
- Maximum 3 short paragraphs total.
- Prefer direct answers over background/context unless explicitly requested.
- If critical context is missing, ask a brief clarifying question instead of guessing.
- Keep wording easy to quickly eyeball.
- If the reply would benefit from more detail, suggest precise follow-up questions.
