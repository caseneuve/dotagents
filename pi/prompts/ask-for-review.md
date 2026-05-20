---
description: Ask another agent to review your latest work
argument-hint: "[agent-name] [focus]"
---
Request a code review via /agent-channel.

Use a dedicated task channel (not a shared general channel). Both agents must watch that channel throughout the review.

Delivery protocol (mandatory):
- Send the primary `review-request` to the dedicated task channel, addressed to the reviewer when provided.
- Do not assume delivery until reviewer presence/ack is confirmed.
- If reviewer is not yet confirmed on the dedicated channel, send a short fallback ping on the active lobby channel that points to the dedicated channel.
- Do not report "review requested" complete until reviewer ack is received.

If this work has a dedicated `./todos` item, structure the review request to match that todo (ID/title, acceptance criteria, and status context).
If there is no dedicated todo, include:
- concise problem statement
- acceptance criteria checklist
- commit list
- local test results
- known limitations / deferred items

Assume review is for the current workspace/branch (do not repeat branch unless clarification is needed).

Ask for a critical, honest review (no rubber-stamping), following this repo’s review protocol and standards.

Reviewer (optional): $1
Extra focus (optional): ${@:2}
