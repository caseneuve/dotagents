---
description: Implement a todo item using this repo’s development protocol
argument-hint: "<todo-id-or-title>"
---
Goal: implement `$@` using the current repository development protocol.

Before you start implementation, confirm your execution plan with the steering human and wait for approval.

Then execute using repo protocol:
- follow `AGENTS.md` workflow rules
- keep todo status/commits/review flow compliant
- run relevant tests
- summarize changes, test results, and open risks

Sidebar progress protocol (must):
- update `channel_status` at phase boundaries: start `0.05`; todo `in_progress` + branch ready `0.15`; implementation done `0.50`; tests done `0.70`; review requested `0.85`; approved/final wrap-up `1.00`
- before any `commit`, major test run, or `review-request`, send matching `channel_status` first
- if waiting/blocking >2 min, set waiting status and log the blocker
- on completion: set `done ✅`, then clear progress with `progress=-1`
