---
title: ag-todo: support `done` status separately from `closed`
status: done
priority: low
type: chore
labels: []
created: 2026-05-14
parent: null
blocked-by: []
blocks: []
---

## Context

`ag-todo status` currently accepts only `open|in_progress|closed|blocked`.
There's no way to distinguish "implemented and merged" from "dropped /
no longer needed" — both end up as `closed`.

This conflates two very different ticket lifecycles:

- **Done**: the work shipped. The ticket carries useful context (acceptance
  criteria, decisions, links to commits/PRs). Future agents may reference
  it as precedent.
- **Closed**: the ticket was abandoned (scope changed, superseded, no
  longer relevant). The work did not ship.

Treating them the same loses signal when scanning history (`ag-todo list
--status closed` returns both kinds; you can't quickly answer "what got
done last sprint?" without reading every file).

Surfaced during pat-cli extraction (`#0017` in agentic-stuff) — the
project's AGENTS.md prescribed "mark todo `done`" as the success path,
which doesn't match the CLI's actual enum. Workaround: edit YAML
front-matter manually (`status: done`).

## Acceptance Criteria

- [ ] `ag-todo status NNNN done` accepted as a valid status transition.
- [ ] `ag-todo list --status done` filters correctly.
- [ ] Front-matter validation (if any) accepts `status: done`.
- [ ] Skill SKILL.md updated to document the distinction:
      - `done` — implemented, work shipped (terminal success)
      - `closed` — dropped / superseded / no longer relevant (terminal failure)
      - `blocked` — paused on external dependency (non-terminal)
- [ ] No backward-compatibility break — existing `closed` todos stay closed
      (we don't auto-migrate, since some "closed" tickets really were
      drops, not shipped work).

## Affected Files

- The `ag-todo` script (location depends on this repo's layout — likely
  under `agents/` or a `scripts/` dir; whoever picks this up should grep
  `which ag-todo`).
- `~/.agents/skills/add-todo/SKILL.md` — documentation update.
- Possibly the front-matter template (in skill or a separate template
  file).

## Notes

- Trivial implementation: extend the status enum + valid transitions.
- The semantic distinction is the actual value here. Without docs, agents
  will continue to use whichever they remember; clear naming is what makes
  the distinction stick.
- After this ships, `pat-cli` and `agentic-stuff` AGENTS.md can drop their
  workaround language ("manually edit YAML to set `status: done`").
