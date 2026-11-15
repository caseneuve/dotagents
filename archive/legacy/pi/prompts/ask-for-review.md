---
description: Ask another agent to review your latest work
argument-hint: "[agent-name] [focus]"
---
Request a code review via /agent-channel.

Review comms protocol (mandatory):
1. Create a dedicated review channel and WATCH it immediately.
2. Send the primary `review-request` to that dedicated channel (address the reviewer by name when provided).
3. Ping the reviewer by name in the active lobby channel and include the dedicated review channel ID/name.
4. Do not assume delivery until reviewer ack/presence is confirmed.
5. Reviewer must confirm they are WATCHING the dedicated review channel.
6. If reviewer is not yet confirmed on the dedicated channel, send a short fallback ping in the lobby pointing to the dedicated channel.
7. Do not report "review requested" complete until reviewer ack is received.
8. Comms are successful only when both agents acknowledge and complete their side of the review; idle waiting or sending only to unwatched channels is not successful.

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
