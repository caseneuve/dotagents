---
description: Suggest simpler, more human-friendly prose edits
argument-hint: "<what to style...>"
---
Review the prose described by: $ARGUMENTS

Default mode: suggest edits first. Do not rewrite the text directly unless the request clearly asks you to write, replace, apply, or produce the revised text immediately.

Goal: make the writing sound clear, plain, and human. Remove anything that feels like LLM output, corporate/cargo-cult language, "best practices" filler, or redundant fuss.

When reviewing, focus on:

- Replace em dashes with simpler punctuation or shorter sentences.
- Remove "not X, but Y" and similar rhetorical contrast formulas unless they are genuinely needed.
- Cut corporate abstractions, cargo-cult phrases, and vague process language.
- Avoid "best practices" language; say the concrete advice instead.
- Remove throat-clearing, hedging, inflated transitions, and repeated ideas.
- Prefer short, direct sentences with ordinary words.
- Preserve the author's meaning, useful nuance, and domain-specific terms.

Response format in default suggest-first mode:

1. List the main style issues briefly.
2. Suggest concrete edits or replacement snippets.
3. If helpful, include one cleaned-up version clearly labeled as optional.

If the request clearly asks for an immediate rewrite, return only the revised prose unless a warning or clarification is necessary.
