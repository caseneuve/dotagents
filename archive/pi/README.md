# Historical Pi sources — prepared retirement branch

**#0069.1 PREPARED ONLY; NOT LANDABLE before the separate soak gate and explicit
scope approval.** This is not an installation package. Nothing here is exposed by
the native manifest or executed by active tasks. No source/API modernization is
part of the archive moves.

## Remaining 49 files

[`retirement-index.json`](retirement-index.json) records source snapshot
7a592f9c9290b6f670eda23662da2f52f60187bc, approved core parent
2dc662c7f1f8ae250266490822b0fac5bf800def, all 49 original paths/blobs/modes and
archive destinations, and canonical successor package/path/reviewed-ref where one
exists. Historical source is NOT asserted byte-identical to maintained successors.
Playwright/Tree-sitter sources and tests have no maintained replacement; unfinished
work, design/lockfile bytes and history remain preserved, not falsely DONE.

The files stay at original paths on the approved core branch. Landing this
prepared descendant requires at least seven calendar days AND five normal sessions
across two projects per active OS, followed by explicit exact-scope approval.
Cutover:2026-11-15T16:20:48Z; earliest calendar date:2026-11-22T16:20:48Z.
`completed:false` and `waived:false` are intentional. Tests/previews do not prove soak.

## Three previously approved helper archives (UNCHANGED)

These are independently approved/adopted #0047.1 archives, not evidence that the
remaining-source gate passed. The source files and modes are unchanged by either
#0069 or #0069.1; [root index](../index.json) includes their original blob/mode and
per-row source_ref3751a530ac8943478b573fbdcb60f6874fc7032b.

| File under `extensions/` | Original path | Disposition / last original file-change commit |
| --- | --- | --- |
| `bookmark.ts` | `pi/extensions/bookmark.ts` | Retired picker/label utility, not exact native UX parity. `a6cf387645176331b9e9dbaa3a6cf23960b3618c` |
| `herdr-pi-session-name.ts` | `pi/extensions/herdr-pi-session-name.ts` | Retired `HERDR_*`/pane companion; managed Herdr integration remains separately owned, no external model-token parity claim. `270c55624963b70b8c1b428e5d1c3e4956912fcd` |
| `bedrock-empty-response-mitigation.ts` | `pi/extensions/bedrock-empty-response-mitigation.ts` | Retired opt-in successful-empty continuation workaround, not claimed equivalent to native retry. `db17a09e77850c459eee3cf007580057c592ddb6` |

Original Bedrock trigger: amazon-bedrock/Opus, successful `stop`, empty content
array, all-zero usage; at most three user-role continuations. No real AWS recovery
or modernization claim is made. Earlier provenance evidence remains under
`~/.cache/pi-migration/evidence/{retirement-audit,legacy-helper-archive}/`.

## Recovery

Use the recorded original ref/path/blob/mode to inspect a source, e.g.:

```sh
git show 7a592f9c9290b6f670eda23662da2f52f60187bc:pi/extensions/runtime-footer.ts
git show 3751a530ac8943478b573fbdcb60f6874fc7032b:pi/extensions/bookmark.ts
```

After explicit recovery approval, restore only selected bytes/modes on a new
branch, reviewing current APIs and preserving later work. Never reset/clean,
overwrite live settings, register archive loaders or disturb a running Pi. See
[root recovery policy](../README.md). Restoring bytes alone does not load a resource.
