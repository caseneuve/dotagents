# AGENTS.md

## Scope and layout

Dotagents is **Pi only**. `package.json` explicitly exposes five `skills/`
directories (with helpers/tests) and five `prompts/` files; no extensions/themes.
Native Pi packages are the only installation path. No bootstrap, PATH shim,
settings writer, parallel Claude/Agents tree or `~/.agents` installation.
Typesafe is separately owned and stays untouched.

- `skills/`: canonical callgraph, dataflow, add-todo, org-journal and to-skill.
- `prompts/`: canonical ans, be-concise, handoff, speak-human and style.
- `test/`: maintained skill/helper/native resource tests.
- `archive/`: inactive history; consult `archive/index.json` for source blob/mode,
  original path and replacement. Historical instructions are not current policy.
- No active `pi/` root remains, not even an empty directory or compatibility link.
  `archive/pi/retirement-index.json` covers 50 preserved source/theme/test/pointer
  files; the master2dc662c README pointer is historical, not current guidance.
- `todos/`: durable task history; archival never means unfinished work shipped.

Read the relevant **installed Pi documentation and examples in full** before
changing package discovery, skills, prompts or SDK tests. Keep README/manifest,
helper examples and active tasks/tests aligned. Do not update another repository
or live settings/installations as an incidental path fix: provide a lead handoff.

## Engineering

Prefer FCIS: pure transformations/planning, small I/O/CLI boundaries, direct tests
of pure logic. Keep helpers beside SKILL.md and resolve them by discovered absolute
skill path. No helper should need the caller's Git root, a fixed HOME, a root
config or an `ag-todo` PATH installation. Avoid duplicate implementations and
compatibility shims. Preserve skill responsibility unless scope explicitly changes.

Testable changes use RED → GREEN → REFACTOR. Keep meaningful RED/GREEN checkpoint
commits separate; fixes and later review findings use new commits, never rewriting
reviewed/pushed history. Tests must use actual helpers, not substitutes.

## Validation

Prefer the `bb.edn` tasks documented in README:

```sh
bb build:test-image
bb test:unit
bb test:native
PI_PACKAGE_DIR=/path/to/node_modules/@earendil-works/pi-coding-agent bb test:pi
bb build:callgraph-image
bb test:callgraph
```

Containers are the default: source read-only, private HOME/project ancestors
outside `/home`, network disabled for execution, no credential/provider API calls.
`test:ci` is only for an already isolated CI. Native resource tests must exercise
the explicit allowlist and real package loader, including selective loading.
Pinned clj-kondo v2026.01.19 is required for the analyzer suite; missing/different
versions are a disclosed baseline blocker, not permission to repin or fake green.
Keep only dependencies actually needed by maintained tests/skills.

## Preservation and gate

Archive only explicitly inventoried tracked files, preserving bytes/modes with
an original-path/blob/mode/replacement recovery index. Do not sweep ignored
node_modules, secrets, local settings, sessions or untracked/dirty user work.
Never register archive directories as resources. Preserve unfinished testmap,
review/Linear and other product work honestly; do not mark those todos done.

For #0069.2 the user explicitly approved archiving the entire dotagents/pi and
removing it after being told nothing active remains. Per lead t16, that reply
waives the old seven-day AND five-normal-session/two-project-per-active-OS gate
ONLY for this reversible source-retirement scope. Index flags are `waived:true`,
`completed:false`; tests/previews do not prove ordinary-use soak. #0069.1 remains
historical completed preparation. The 49 reviewed payloads plus exact live
master2dc662c README pointer have recovery rows; the entire pi root must be absent.
Earlier helper archives and unfinished product/API/publication work remain unchanged.
Exact-ref review is still required; lead alone integrates and verifies the host.

## Work tracking and commits

Every non-trivial change has a focused `todos/NNNN-*.md`; sub-tasks use `NNNN.M`.
Mark open → in_progress in the first branch commit:
`[chore] mark #NNNN in_progress`. Use frontmatter `blocked-by`/`blocks` for real
sequencing. Reference the ID in every later subject, e.g.
`[test(#NNNN)] RED portable helper regression`. The final task commit marks only
its completed scope done: `[chore] mark #NNNN done`. Trivial typo/whitespace chores
need no todo. Invoke `skills/add-todo/ag-todo` by resolved absolute path.

Non-trivial multi-commit work uses a flat `NNNN-slug` feature branch off clean
`master` (sub-task `NNNN.M-slug`), preferably a standalone clone or dedicated task
worktree. **Never run npm lifecycle scripts in a linked worktree.** Never edit
canonical master, merge, push, tag or change live user installations without
explicit human authorization. Approved integrations use `git merge --ff-only`;
rebase first if needed, then re-review any changed source.

## Independent review

Implementation is incomplete until another agent reviews the **exact final ref**.
Coordinate with the assigned independent reviewer through available agent
messaging; do not require retired channel tools/daemons or install a replacement.
If no transport/reviewer is available, notify the human instead of claiming review.
No subagent spawning when the task forbids it.

1. Send the lead/reviewer branch, clone location, base and candidate SHA, problem,
   acceptance checklist, commit list, test commands/results and limitations.
2. Acknowledge requests promptly; keep the review conversation active. Re-ping
   around two minutes and notify the human around five if no response.
3. Reviewer runs relevant tests and walks manifest, helper paths, archive inventory,
   docs/tasks/references and safety boundaries; replies APPROVED or concrete
   CHANGES-REQUESTED. Address findings in new commits and request exact-ref review.
4. No source changes after approval without renewed review. Close with mutual
   acknowledgment; approval is not merge/live-handoff authorization.

Before finishing, verify one canonical implementation, current docs, actual native
and helper proof, unchanged historical payloads/user work, honest unfinished/gated
scope, exact-ref approval and a bounded lead handoff. Clearly separate completed
source retirement from historical preparation, actual live adoption and uncompleted soak.
