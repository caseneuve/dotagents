---
name: linear
description: Generic Linear workflows via MCP — find/inspect projects, issues, milestones, labels, and post project/initiative status updates. Use for anything Linear beyond claiming a repo todo (see linear-todo for that narrow flow).
---

# Linear

General-purpose Linear operations through the `linear` MCP server. This skill
is for browsing/reporting/maintaining Linear state. If you are claiming,
blocking, or finishing work tied to a `todos/NNNN-*.md` file, use the
`linear-todo` skill instead — it has a stricter, narrower protocol.

## Glossary (read first — these names collide)

Linear has four different "status-like" concepts. Do not conflate them:

| Concept | What it is | Where |
| --- | --- | --- |
| Initiative status | Proposed / Planned / Active / etc. | `linear_list_initiatives`, `linear_get_initiative` |
| Project status | Planned / etc. (project lifecycle) | `linear_list_projects`, `linear_get_project` |
| Issue state | Backlog / Todo / In Progress / In Review / Done / Canceled / Duplicate (team-specific) | `linear_list_issue_statuses`, issue `state` field |
| Status update health | onTrack / atRisk / offTrack, on a *narrative update* | `linear_save_status_update`, `linear_get_status_updates` |

Hierarchy: **Initiative** → **Project** → **Milestone** → **Issue**. Projects
and initiatives can each carry their own sequence of narrative **status
updates** (not the same thing as issue state).

There are also three *separate* label pools — do not assume one list covers
all of them:

- Project labels (domain/tech tags, e.g. `clojure`, `babashka`, `data`) —
  `linear_list_project_labels` (no create tool observed; treat as
  workspace-curated).
- Issue labels (type tags, e.g. `Bug`, `Feature`, `Improvement`) —
  `linear_list_issue_labels`, `linear_create_issue_label`.
- Initiative labels — `linear_list_initiative_labels`,
  `linear_create_initiative_label`.

## Before writing anything: describe the tool

Read/list tool output shape does **not** reliably predict the matching
`_save_*` tool's field names. Known asymmetries already found the hard way:

- `linear_get_project` takes `query` (name, ID, or slug) — there is no `id`
  param.
- `linear_get_status_updates` requires `type: "project" | "initiative"` plus
  `project` or `initiative` (name-or-ID string) — there is no `projectId`.
- `linear_save_issue` accepts `milestone` (name-or-ID) to *write* a milestone,
  but reading an issue back shows it as `projectMilestone`.

If you are about to call a `_save_*`/`_get_*` tool for the first time in a
session and are not 100% sure of a field name, call
`mcp({ describe: "<tool_name>" })` once rather than guessing. A failed
validation call is cheap, but describing first is cheaper and doesn't spam
the transcript with retries.

Priority is an integer enum, not a string, on both issues and
initiatives/projects: `0=None, 1=Urgent, 2=High, 3=Medium, 4=Low`.

Most `project` / `initiative` / `team` / `query` params accept a human name
*or* an ID. Prefer names in ad-hoc calls for readability, but if a name is
ambiguous (matches >1 record), list and disambiguate with the user before
any write — never guess which match was intended.

## Scenario: find a project

```
linear_list_projects(query: "<name or keyword>")
```

If more than one result, disambiguate by initiative/team before using it in
a write call. Prefer passing the resolved project name (or ID if names
collide) to downstream calls in the same turn.

## Scenario: get project/initiative state

```
linear_get_project(query: "<name>", includeMilestones: true)
```

`includeMilestones: true` returns each milestone's `description` and
`progress` (percentage). Use `includeMembers` / `includeResources` only if
actually needed — they add noise.

For narrative history (what changed recently, health trend):

```
linear_get_status_updates(type: "project", project: "<name>", limit: 5)
```

(swap `type: "initiative"` / `initiative: "<name>"` for an initiative). Each
update's `diffMarkdown` is auto-computed by Linear from milestone progress
deltas — don't hand-roll a progress summary if this field already has one.

## Scenario: find / create / update an issue

Find:

```
linear_list_issues(project: "<project>", query: "<keyword or ticket id>", limit: 10)
```

**Footgun:** `linear_list_issues` defaults `includeArchived: true` (unlike
most list tools, e.g. `linear_get_status_updates`, which default `false`). A
plain list will silently include canceled/archived issues — pass
`includeArchived: false` when you want only live work.

Create or update (same tool, presence of `id` decides which):

```
linear_save_issue({
  team: "<team>",            # required on create
  project: "<project>",
  milestone: "<milestone name or id>",   # NOT projectMilestone
  title: "...",
  description: "...",        # markdown, literal newlines, no escape sequences
  priority: 2,                # integer 0-4, see priority table above
  state: "Todo",              # state *type* or *name*; fetch valid names via
                               # linear_list_issue_statuses(team: "<team>") if unsure
  assignee: "me"              # NOT assigneeId; accepts user ID, name, email, or "me"
})
```

To update, pass `id` (issue ID or identifier like `DEV-31`) plus only the
fields that change.

Write-field semantics differ per field — don't assume one rule:

- `labels` **replaces** the full label set — don't pass it unless you mean to
  overwrite existing labels (read first if adding).
- Relation and link fields are **append-only**: `blocks`, `blockedBy`,
  `relatedTo`, `links`, `addReleases` add without removing. Use the paired
  `removeBlocks` / `removeBlockedBy` / `removeRelatedTo` (or `setReleases`) to
  drop entries.

## Scenario: comment on an issue / project / initiative

```
linear_list_comments(issue: "<id or identifier>")     # or project:/initiative:
linear_save_comment({ issue: "<id>", body: "<markdown>" })
```

Presence of `id` on `linear_save_comment` decides create-vs-update; pass a
parent comment ID to reply in-thread. Body is markdown with literal newlines
(no escape sequences). Confirm exact param names with `mcp({ describe:
"linear_save_comment" })` before the first write of a session.

## Scenario: post a project or initiative status update

```
linear_save_status_update({
  type: "project",            # or "initiative"
  project: "<name>",          # or initiative: "<name>"
  body: "<markdown>",
  health: "onTrack"           # onTrack | atRisk | offTrack
})
```

Write the body as a short changelog-style narrative (what shipped, what
scope changed, why), and reference issue IDs/commit subjects concretely so a
reader doesn't need to open every issue. Don't restate milestone
progress-percentage deltas manually — Linear appends `diffMarkdown`
automatically once the update is saved.

## Scenario: milestones

```
linear_list_milestones(project: "<project>")
linear_save_milestone({ project: "<project>", name: "...", description: "..." })
```

Attach issues to a milestone by name or ID via `linear_save_issue`'s
`milestone` field (see above). Milestone names are only unique within a
project — don't assume a name is globally unique when resolving across
projects.

## Scenario: labels

- List before creating: labels are cheap to duplicate by accident across the
  three pools (project/issue/initiative) if you guess instead of checking.
- Issue labels: `linear_list_issue_labels()` → `linear_create_issue_label()`
  if missing, then pass names in `linear_save_issue({ labels: [...] })`
  (full-replace semantics — see above).
- Initiative labels: `linear_list_initiative_labels()` →
  `linear_create_initiative_label()`.
- Project labels: list-only in normal use; treat as a workspace-curated
  taxonomy the user maintains, not something to add to ad hoc.

## Scenario: initiatives

Mostly read-heavy in practice — initiatives are long-lived scope containers
(e.g. "Blog / Publishing", "Agents (tools & configs)") that projects live
under. Use `linear_list_initiatives()` / `linear_get_initiative(query:)` to
understand where a project sits and what else shares its initiative before
proposing scope changes. `linear_save_initiative` exists for create/update
but is a rarer, higher-stakes operation — confirm with the user before
creating a new initiative.

## Other tool families

This skill covers the common flows. For cycles, releases, diffs, documents,
teams, and users, list what's available with `mcp({ server: "linear" })` and
`mcp({ describe: "<tool>" })` rather than assuming they're out of reach.

## Safety

Most individual footguns are covered inline in their scenario. The net-new,
non-obvious rules:

- Never create a new project or initiative without explicit user
  confirmation — these are structural, long-lived containers.
- When a name matches more than one record, list and disambiguate with the
  user before any write — never guess which match was intended.
- After a workspace has exposed a field-name mismatch this session, describe
  the tool instead of guessing again.
- Never treat issue `state` and status-update `health` as interchangeable —
  they are unrelated fields on unrelated objects (see glossary).
