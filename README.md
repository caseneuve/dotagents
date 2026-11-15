# dotagents

Five independent skills and five prompt templates for [Pi](https://pi.dev/).
The root `package.json` is the explicit native resource allowlist: **no
extensions, themes, installer, lifecycle scripts, PATH shims or parallel runtime
installation**. Typesafe remains a separately owned skill; this package does not
replace or configure it.

```text
skills/   # canonical SKILL.md files, bundled helpers, tests and fixtures
prompts/  # canonical five Markdown prompt templates
test/     # layout, native loading and helper regression checks
archive/  # inactive historical sources and exact recovery index
pi/       # retired guidance; excluded legacy sources pending the separate soak gate
todos/    # work history, including unfinished and transferred work
```

## Native installation and selection

Review the source, then choose a scope (replace the example path):

```sh
pi install /absolute/path/to/dotagents       # personal
pi install -l /absolute/path/to/dotagents    # current project
```

Local packages load in place; update the checkout deliberately. Project settings
and resources require Pi project trust; trust is not an OS sandbox. Do not commit
someone else's absolute personal paths as team configuration.

Use `pi list` to inspect declarations and `pi config` to select resources (Tab
switches scope). `/reload` refreshes an intentionally changed resource selection;
installation does not require restarting another user's running Pi. `pi remove
<source>` removes a declaration. `pi update --extensions` reconciles packages;
`pi update` without a target updates Pi itself. This repository never writes user
settings or performs a live cutover automatically.

Example native filter in your chosen settings scope:

```json
{
  "packages": [{
    "source": "/absolute/path/to/dotagents",
    "skills": ["skills/add-todo"],
    "prompts": ["prompts/ans.md"]
  }]
}
```

Omitted resource types use the manifest; `[]` disables that type. Filters narrow
the allowlist and cannot expose archive/legacy resources. Enable only what you
want. Remove obsolete broad loader declarations deliberately, after reviewing
ownership and preserving local work; do not add compatibility links or install
anything into `~/.agents` or a bin directory. Existing external installations and
unrelated skills/auth/editor/model preferences are not managed here.

## Resources and helpers

| Skill | Bundled helpers / prerequisites |
| --- | --- |
| [callgraph](skills/callgraph/SKILL.md) | Python 3; Clojure/Babashka analyzer needs Babashka and clj-kondo **v2026.01.19** |
| [dataflow](skills/dataflow/SKILL.md) | Python 3 static type/purity evidence |
| [add-todo](skills/add-todo/SKILL.md) | Skill-local `ag-todo`, Babashka; invoked by agents via absolute path, not PATH |
| [org-journal](skills/org-journal/SKILL.md) | `new-entry.bb`, `update-index.el`; Babashka and Emacs/Org |
| [to-skill](skills/to-skill/SKILL.md) | Instructions for distilling verified lessons |

Resolve each helper **beside the discovered SKILL.md**, not relative to your cwd,
HOME or a fixed Git checkout. Run against the target project. For example, after
resolving the skill directories:

```sh
"<resolved-add-todo-directory>/ag-todo" list --status open
bb "<resolved-org-journal-directory>/new-entry.bb" --mkdir project-name
emacs --batch -Q -l "<resolved-org-journal-directory>/update-index.el"
```

Journal metadata defaults to agent `pi`; `ORG_JOURNAL_AGENT` overrides identity.
Entries/index default to `~/org/agent-journal/`. `ORG_JOURNAL_HOME` overrides only
the metadata helper; set the Emacs helper's `shared-journal-base-dir` explicitly
if using a different index root. Never point tests at the real journal.

Prompts: [ans](prompts/ans.md), [be-concise](prompts/be-concise.md),
[handoff](prompts/handoff.md), [speak-human](prompts/speak-human.md),
[style](prompts/style.md). Invoke them as `/ans`, `/handoff`, etc. Loading tests
are not a substitute for the still-open human prompt-content audit.

## Testing

Run from this checkout. Tests mount source read-only and use private HOME and
non-Git project/copy paths outside `/home`, without credentials or network:

```sh
bb build:test-image
bb test:unit       # todo core, Python callgraph and dataflow
bb test:native     # exact 5+5 layout, archive blobs/modes, actual portable helpers
PI_PACKAGE_DIR=/path/to/node_modules/@earendil-works/pi-coding-agent bb test:pi

bb build:callgraph-image
bb test:callgraph # pinned analyzer-backed Clojure suite
bb test           # unit + native/helpers + pinned Clojure suite
```

`test:pi` uses the installed Pi SDK resource loader and prompt expansion, including
exact positive filters and empty selections, from a non-Git package copy. It
mounts that installation's `node_modules` read-only in a Node 22 container; no npm
or Pi installation/lifecycle runs. No AgentSession, auth or provider API calls.
It is separate from `bb test` because Pi is externally installed, not a root
dependency. `bb test:ci` runs all suites directly only in an already isolated CI
with tools, private HOME and `PI_PACKAGE_DIR` supplied; there are no active CI
workflows in this repository.

The inherited Clojure analyzer contract remains pinned: another clj-kondo version
does **not** satisfy it. If the pinned download is unavailable, helper/native
checks can still run, but report the analyzer/aggregate gate as blocked rather
than repinning it or claiming all tests passed. No npm/TypeScript tooling is
needed for this resource-only package.

## Ownership and historical recovery

Retained extensions belong to `pi-conversation-tools`, `pi-workbench`,
`pi-runtime-ui`, `pi-usage` and `pi-emacs-bridge`; themes belong to
`pi-dotagents-resources`. Select those native packages separately. None of the
old dotagents implementations should be loaded alongside them.

[Archive index and recovery](archive/README.md) preserve obsolete Claude/Agents,
bootstrap and unused shared resources, including unfinished skills/product work.
Remaining excluded `pi/extensions`, `pi/themes` and their historical tests have
**not** been retired on this branch. Their reversible moves are prepared on a
separate reviewed branch and remain gated by seven calendar days AND five normal
sessions across two projects per active OS, then explicit exact-scope approval.
The three previously approved helper archives are unchanged. Do not infer soak
completion, publication or live handoff from this source simplification.
