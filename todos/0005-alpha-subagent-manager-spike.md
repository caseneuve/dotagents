---
title: alpha subagent manager spike
status: in_progress
priority: medium
type: feature
created: 2026-04-04
parent: null
blocked-by: []
blocks: []
---

## Context

We want to validate whether Pi subagents are actually useful before we commit to
full framework work such as Markdown specs, trace viewers, and review-loop
orchestration. The first spike should prove the core runtime and UX shape:
background child sessions, lightweight observability from the main Pi frame,
and explicit control so the user can inspect or kill stale workers.

The spike should stay intentionally narrow. It should favor one generic
primitive over a full declarative framework: a `spawn_subagent` tool backed by
an extension-hosted job manager.

## Acceptance Criteria

- [ ] There is a generic `spawn_subagent` tool that starts a child Pi session in
a background task and returns immediately with a job identifier.
- [ ] The extension keeps a transient in-memory registry of subagent jobs with at
least: job id, status, label or task summary, origin parent entry id, and
latest activity summary.
- [ ] A main-frame widget shows compact live status for running or recently
finished jobs without dumping nested transcript text.
- [ ] The user can inspect and cancel subagents from the main Pi frame via
commands.
- [ ] Subagent reasoning stays separate from the parent conversation context by
default; the parent only gets the spawn acknowledgement and explicitly surfaced
results.
- [ ] Subagents are treated as separate sessions or equivalent isolated child
conversations linked to the parent entry they were spawned from.
- [ ] Navigating the parent session tree after spawning a subagent does not
implicitly stop or rewrite the running child job.
- [ ] The spike documents the chosen alpha lifecycle semantics well enough to
inform later framework work.

## Affected Files

- `pi/extensions/` — alpha subagent manager extension and supporting modules
- `pi/README.md` — document alpha semantics and intended growth path if the
  spike lands
- `test/unit/` — pure helpers for job-state transitions and summary formatting
  if they are extracted
- `test/e2e/` — spike coverage for spawning, observing, and cancelling jobs

## E2E Spec

GIVEN a user asks Pi to delegate work through `spawn_subagent`
WHEN the tool is called
THEN Pi starts an isolated background child job, immediately returns a job id,
and shows compact job status in the main frame

GIVEN a running subagent spawned from parent tree entry X
WHEN the user navigates the parent tree elsewhere and inspects the job
THEN the subagent remains independently observable and cancellable, and its
nested transcript is not injected into the parent conversation by default

## Notes

Keep this spike small and opinionated:

- widget + commands are the primary human UX
- transient runtime state is acceptable for alpha
- no Markdown subagent spec yet
- no generalized workflow engine yet
- no automatic result import into the current parent branch

### Progress comments (2026-04-06)

Implemented in `agentbox/dotagents-0005` branch:

- Added `pi/extensions/subagents.ts` with a generic `spawn_subagent` tool.
- Background delegated jobs now run asynchronously and return a job id
  immediately.
- Added transient in-memory job registry with status, origin entry id, and
  activity summaries.
- Added main-frame observability (`setStatus` + widget) and command controls:
  `/subagents`, `/subagent <id>`, `/subagent-kill <id>`.
- Updated `pi/README.md` with alpha behavior and usage notes.

Known gaps / follow-up:

- Current child runs are process-isolated but `--no-session` (session-less), so
  durable child-session inspection is not available yet.
- Parent LLM cannot fetch subagent output directly yet without user relay; add a
  parent-facing communication/result tool next.
- This spike is now informing a separate experiment epic (`0007-*`) focused on
  SQLite-backed agent communication and optional tmux-spawned interactive agents.

The goal is to learn from real usage and only then decide how much of the
existing `0004-*` framework draft should be kept, reordered, or replaced.
