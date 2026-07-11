---
name: linear-todo
description: Claim and finish repository todo work in Linear, with release, block, and cancel transitions.
---

# Linear todo

Use when starting or stopping work represented by `todos/NNNN-*.md`.
Todo files own requirements and acceptance criteria; Linear records work state,
agent, host, and branch.

## MCP budget

Use only:

- `linear_list_projects`
- `linear_list_issues`
- `linear_list_comments`
- `linear_save_issue`
- `linear_save_comment`

Do not inspect MCP schemas, statuses, initiatives, or full issue details during
this flow. Use limits below to keep results small.

Gather the todo ID, title, path, repository directory name, `hostname`, current
branch, and agent/runtime name locally before calling Linear.

## Find or create the issue

1. `linear_list_projects(query: <repo>, limit: 10)`. Require one project with
   exactly one team; otherwise ask the user.
2. `linear_list_issues(project: <project-id>, query: <todo-id>, limit: 10,
   includeArchived: true)`.
3. Match the ID as a title token or the exact todo path in the description.
   Stop on ambiguity.
4. If needed, use `linear_save_issue` with:
   - `team`: the project's team
   - `project`: project ID
   - `title`: `<todo-id> <todo-title>`
   - `description`: `Source: \`todos/<filename>\``
   - `state`: the operation's target state

Never copy the todo body into Linear or create a Linear project.

## Claim

1. Find or create the issue in `In Progress`.
2. For an existing issue, load transition history with
   `linear_list_comments(issueId: <issue>, limit: 250, orderBy: createdAt)`.
   Follow `cursor` while `hasNextPage` is true; an older claim may still be
   active. Ignore non-transition comments when evaluating claims.
3. Claim identity is `(agent, host, branch)`. If another identity has an
   unresolved `CLAIM`, stop. If this identity already has one, only ensure the
   issue is `In Progress`.
4. Otherwise post:

```text
CLAIM
Agent: <agent/runtime>
Host: <hostname>
Branch: <branch>
Todo: todos/<filename>
```

5. Reload the complete paginated transition history. The earliest unresolved
   claim wins, ordered by
   `createdAt`, then comment ID. A loser posts `RELEASE` for its own identity
   and stops before editing work.
6. Set the issue to `In Progress` with `linear_save_issue`.

A transition resolves only a claim with the same identity. Do not set the
assignee: agents share one Linear user.

## Other transitions

Find the issue, post the comment, then set its state:

| Operation | Comment | State |
| --- | --- | --- |
| Release incomplete work | `RELEASE` + agent, host, branch, current state | `Todo` |
| Block work | `BLOCKED` + agent, host, branch, reason | `In Progress` |
| Finish completed work | `DONE` + agent, host, branch, summary, commits/PR, tests | `Done` |
| Abandon a `closed` todo | `CLOSED` + reason | `Canceled` |

For a Linear blocker, pass its identifier in `blockedBy` to
`linear_save_issue`; otherwise do not add relations. Finish only after todo
acceptance criteria, tests, review, and repository completion rules pass.

## Safety

- Never guess when project, team, or issue lookup is ambiguous.
- Never work after losing or encountering an active claim.
- Do not post routine progress between transitions.
- Linear failure must not silently change repository state.
- If a named state is missing, report the workspace configuration problem; do
  not perform extra discovery on every invocation.
