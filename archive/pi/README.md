# Archived Pi helpers

These sources are historical recovery material, **not supported or installed
resources**. They are excluded by the unchanged root manifest (`extensions: []`).
Do not add this directory as a Pi extension loader.

## Approval and scope

On 2026-11-15 the user explicitly approved archiving these three helpers;
lead t16 relayed that approval for #0047.1. The separate staging branch starts
at `3751a530ac8943478b573fbdcb60f6874fc7032b` (approved native-resource integration).
Only these files move, byte-for-byte with their original `100644` modes:

| Archived file under `extensions/` | Rationale | Last original file-change commit |
| --- | --- | --- |
| `bookmark.ts` | Intentionally drop the custom branch-prompt picker/label utility, not a claim of identical native UX. | `a6cf387645176331b9e9dbaa3a6cf23960b3618c` |
| `herdr-pi-session-name.ts` | Legacy `HERDR_*`/`pane.report_metadata` companion does not speak hc's terminal protocol. Pi native title/status cover only part of name visibility; the external sidebar model token is **not** natively replaced. | `270c55624963b70b8c1b428e5d1c3e4956912fcd` |
| `bedrock-empty-response-mitigation.ts` | Already excluded in the audited live selection. Preserve the opt-in synthetic-continuation workaround rather than porting/re-enabling it. Its exact successful-empty signature is **not** known fixed or equivalent to native error retry. | `db17a09e77850c459eee3cf007580057c592ddb6` |

Original paths were `pi/extensions/<filename>` at source snapshot
`3751a530ac8943478b573fbdcb60f6874fc7032b`. Bedrock's trigger was selected
amazon-bedrock/Opus, successful `stop`, empty content array and all-zero usage;
it injected at most three consecutive user-role continuations, not transparent
request retries. No real AWS recovery claim or modernization is made here.

Retirement investigations and this exact-source audit are preserved separately
under `~/.cache/pi-migration/evidence/{retirement-audit,legacy-helper-archive}/`.
Lead coordinates separately preserved named copies/history. No active-user source,
settings, global Herdr-managed extension, loaded process, or other retired source
is modified by staging this archive. Adoption requires later approved cutover;
this is not general #0047 retirement/soak completion.

## Recovery (review first; not an installation recipe)

Read the archived source here, or inspect the exact original Git object:

```sh
git show 3751a530ac8943478b573fbdcb60f6874fc7032b:pi/extensions/bookmark.ts
```

Substitute either other filename to inspect its original source. After explicit
recovery approval, copy the required archived file back to its original path (or
restore that exact path from the source commit), retaining mode and reviewing
current API/transport compatibility. Restoring bytes alone does not expose a
resource through the native manifest or change any already-running Pi session.
Do not restore broad legacy loaders or overwrite the separate managed
`herdr-agent-state.ts` integration as part of recovery.
