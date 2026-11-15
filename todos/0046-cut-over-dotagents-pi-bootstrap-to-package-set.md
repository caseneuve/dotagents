---
title: adopt native Pi independent resources and extracted packages
status: done
priority: high
type: chore
labels: [pi, packaging, bootstrap]
created: 2026-07-10
parent: null
blocked-by: [0026, 0027.9]
blocks: [0047]
---

## Completed configuration/source/dependency adoption (2026-11-15)

DONE for the explicitly authorized adoption scope, applied on Linux at
**2026-11-15T16:20:48Z**, not completion of the whole migration or regular-use soak.
Lead integrated independently reviewed source trees and refreshed canonical runtime
Pi1.5.2 dependencies using offline npm ci with lifecycle scripts disabled;
Biome/typecheck/132 runtime tests passed. This closeout changes this todo only.

- [x] Exact-SHA independent review and approved source/dependency integration.
- [x] Preference-preserving settings mapping and fresh canonical native/RPC proof.
- [x] Record exact refs, enabled selections, UTC cutover/soak clock and rollback baseline.

Seven native local registrations preserve actual normal preferences: conversation
outline+notes (2 entries), workbench diff-review+attach-screenshot (2), runtime
branch/editor/footer (3), Emacs bridge (1); usage remains disabled. Dotagents exposes
only be-concise+handoff prompts in normal settings, with zero owned skills enabled;
both package themes remain available. Selected modus-operandi/modus-vivendi theme,
all skill overrides and every setting outside packages/extensions/prompts/themes
are unchanged. Separate typesafe-ai and global Herdr-managed integration bytes are
preserved; new independent skill availability was not silently enabled.

| Package | Approved executable/resource source ref |
| --- | --- |
| conversation-tools | `6d357a27a25a1fc06357ba1ab576266b492df01b` |
| workbench skill handoff | `60fd4a6004ecd9042e1b61da81d1f8ad94ccf6e4` |
| runtime-ui | `8b3d4de4fa7396d10caea0149c3c05fb32093eee` |
| usage (disabled) | `14aafe7891111c64327634be8c65e618b3e70e46` |
| Emacs bridge | `496ab4b0db99de5919a7e7abe5f3277cb0fd794e` |
| themes | `a8c5500d437e03e162d6b1df0e3a8886a8bb66c6` |
| dotagents native resources + three helper archives | `7610d0529021fd5e8f6f4854e5065f458518c822` |

Fresh-proof canonical HEADs include only reviewed todo differences from these
behavior refs: runtime `254efa513d762c4e5edc1d08e5f720d1b9ed1e1f`, workbench
`7bd4220ffd2800d0427b64042340d09fa2612d7c`, dotagents
`48228e49cb12949da13948e56933b3c9e0edcebf`. No executable/resource delta is claimed.

Independent t3y post-operation proof PASS: 62 structural checks; fresh native load
from actual canonical paths yields exactly 8 selected retained entries, 10 extension
commands, 2 prompts, 2 themes, no owned skills, errors or warnings. RPC exited0 with
no messages/model/network/API calls or auth files read/copied. The private-HOME proof
used labeled source-byte mirrors for outside-owned typesafe discovery/excluded
Agent skills; real Herdr/typesafe files were separately hash-verified unchanged.
This was not a launch of the real user profile or authenticated provider validation.
Caches, hooks, ten original untracked workbench todos and preferences were preserved.

Authoritative evidence under `~/.cache/pi-migration/`:
`evidence/cutover-20261115.md` and
`evidence/composition/post-operation/{summary.json,native-discovery.json,native-rpc.json,structural.json}`.
Fresh rollback baseline: `preservation/cutover-20261115T161304Z/` (settings before/after,
refs/indexes/hooks/patches and scoped user artifacts; not an auth/full-filesystem backup).
The cutover ledger records bounded recovery: preserve new work, restore only the
four resource fields while retaining later preferences, and use reviewed rollback
branches/dependency state rather than destructive reset/clean or cache deletion.

**Running user Pi sessions were deliberately NOT restarted or reloaded. New defaults
apply on the next normal Pi launch.** The all-enabled preview remains separate and
unchanged; its 12-entry surface is not the normal eight-entry selection or a soak
session. Zero ordinary post-cutover sessions and zero ordinary projects are recorded.
The configuration soak clock starts at the UTC timestamp above; #0047 remains OPEN
until at least seven calendar days AND five sessions across two projects per active
OS, plus separately approved retirement. Earliest calendar eligibility alone is
2026-11-22T16:20:48Z, not automatic completion or scheduled cleanup.

#0051 publication/remote immutable-ref validation remains OPEN. Real authenticated
usage APIs, all-OS/minimum-Node certification, prompt human audit, further resource
enablement and substantive product/coverage work are not completed by this proof.
No new tests, code, settings/auth access, lifecycle operation or runtime restart is
performed by this one-file metadata closeout.

## Earlier staging policy (historical snapshot; current status above)

The former custom Pi bootstrap/settings-reconciliation plan below is superseded:
there is NO Pi bootstrap or replacement custom installer. #0046.1 removes Pi
actions (including implicit default/all writes) and exposes independent skills
and prompts via the root native manifest in a dedicated worktree.
Use native `pi install [-l] <path>` only.

Live adoption into the active checkout and user settings requires later explicit
live-setup approval; #0046 stays open until that integration and package-selection
verification is authorized and complete. Do not clean up broad user loaders,
set themes, remove workbench copies, or start soak implicitly.

## Earlier adoption checklist (historical snapshot; delivered/pending status above)

- [ ] Independently review #0046.1's exact SHA and isolated native handoff.
- [ ] Obtain explicit approval for active-root integration/live setup.
- [ ] Select native personal/project-local package declarations and remove duplicate
      broad loaders using the approved native workflow, preserving unrelated settings.
- [ ] Verify resource ownership, trust, filters, no duplicates and chosen theme.
- [ ] Record exact package refs, cutover date/platforms and explicit soak start.
- [ ] Retain all source/history until separately approved #0047 archive work.

## Historical proposal (superseded; do not execute)

## Context

Adopt the validated local package checkouts in dotagents bootstrap. This is an atomic settings
migration, not an extension redesign and not source retirement. Migrated sources remain dormant in
dotagents as rollback material until follow-up `0047` completes after explicit soak evidence.

Bootstrap owns settings reconciliation only. It does not clone, update, or otherwise manage the Git
lifecycle of `~/git/pi/*`. It verifies required local package paths and reports missing repositories
actionably. Portable project settings use immutable Git sources and Pi's normal trusted-project
missing-package installation.

## Acceptance Criteria

- [ ] Define the exact intended global package paths and selective/project-local package guidance from `0026`/`0027.9`.
- [ ] Bootstrap directly reconciles `settings.json` package entries idempotently; it does not invoke `pi install` and then also edit the same settings.
- [ ] Bootstrap verifies required `~/git/pi/*` paths and fails or warns with actionable clone/setup guidance; it never silently clones or updates them.
- [ ] Add validated package entries and remove the active broad dotagents extension/theme/prompt settings paths atomically, preserving unrelated settings and packages such as `pi-emacs-bridge`.
- [ ] Retain `pi/extensions`, `pi/themes`, and `pi/prompts` as dormant rollback sources; only `0047` may remove them.
- [ ] Verify selected theme and intended resources load without duplicates using the package refs/results approved in `0027.9`.
- [ ] Update bootstrap tests and docs for local defaults, portable Git project settings, ownership under `caseneuve`, and rollback to dormant paths.
- [ ] Record cutover date, tested machines/platforms, package refs, and the start of the soak evidence consumed by `0047`.

## Affected Files

- `scripts/bootstrap.clj`
- `test/unit/bootstrap_pure_test.clj`
- `test/e2e/cases.edn`
- `README.md` and `pi/README.md`
- Pi settings merge policy

## Notes

No npm publication or source deletion occurs here. Extension improvements remain separate follow-ups.
