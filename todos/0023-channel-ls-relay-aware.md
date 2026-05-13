---
title: /channel-ls relay-aware; remove /channel-clear
status: open
priority: medium
type: bug
labels: [pi, agent-channel]
created: 2026-04-26
parent: null
blocked-by: [0021]
blocks: []
---

## Context

The `agent-channel` pi extension registers two **slash commands** (human-
driver surface, distinct from the agent-facing `channel_list` /
`channel_send` *tools*) that are both broken in the current relay-primary
runtime.

This todo is the slash-command counterpart to #0021. #0021 makes the
`channel_list` *tool* transport-aware by adding `listChannels()` to
`MessageTransport` and a `LIST_CHANNELS` RPC to the relay. Once that lands,
the slash commands can trivially reuse the same plumbing. Everything here
consumes #0021's API; we only add a small refinement (subscriber
**identities**, not just a count).

### `/channel-ls` — doubly broken

1. **Wrong source.** Hardcodes `fs.readdirSync(DEFAULT_CHANNEL_DIR)` (i.e.
   `~/.agent-channels/*.json`) regardless of the active transport. When
   the relay is up (the default), channel state lives in the relay's
   in-memory `ChannelStore`; the file dir holds only orphaned snapshots
   from past `FileTransport` sessions. On the current dev machine: 51
   stale JSONs from Apr 14–25, while today's live channels
   (`ueeg/review-0022`, `EEB2F4AD-…/lobby`) have no correct file
   representation. Same root cause class as #0021 — just in the slash
   command instead of the tool.
2. **Wrong output method.** Emits N `ctx.ui.notify(line, "info")` calls
   in a loop. In interactive mode those route to `showStatus(...)`
   which deliberately coalesces consecutive status updates in-place
   ("we update the previous status line instead of appending new ones
   to avoid log spam" —
   `pi-coding-agent/dist/modes/interactive/interactive-mode.js:2420`).
   So 51 lines collapse to one flicker of a single dim statusline.
   User-visible effect: "`/channel-ls` does nothing."

### `/channel-clear` — not-worth-fixing

1. Same wrong source: writes `{messages: []}` to
   `~/.agent-channels/<channel>.json` and ignores the active transport,
   so channels on the live relay are untouched. Success toast is a lie.
2. No existence check: typoing the channel name silently creates a
   permanent empty JSON stub (a significant chunk of the 51 orphan files
   likely came from this).
3. No relay-side CLEAR op exists: `shared/relay/server.ts` exposes only
   `publish` / `read` / `ack`. `ChannelStore.clear()` is internal.
4. In a relay-primary world the command has **no real use case**:
   - `bb relay:restart` already wipes all channels (AGENTS.md).
   - Dotagents convention is "new task, new channel" (AGENTS.md:
     *"A closed channel is dead — new task, new channel."*). A cleared
     channel is the same as an abandoned one.

Rather than fix it, we remove it.

## Proposed behavior

### `/channel-ls`

**No args:** open a scrollable overlay via `ctx.ui.custom` (same pattern
as `repo-todos.ts`, `agent-journal.ts`, `session-notes.ts`, already in
`pi/extensions/`). One row per channel:

```
  channel                                   msgs  unacked  last       sub-agents              watching
▸ EEB2F4AD-…-B5955B726D6E                    47     3      12s ago    3s38, ueeg, pqdw        ● lobby
  ueeg/review-0022                           12     0      3m ago     ueeg, 3s38              ●
  pqdw/review-0042                            8     2      5m ago     pqdw, ueeg
  agentic-stuff_review-final                  —      —     (file)     —                       ⚠ stale
```

Columns: channel id (middle-ellipsized if UUID-shaped), total message
count from live store, unacked count for *this agent*
(`from !== me && !acked`), relative last-activity timestamp,
comma-separated list of currently-subscribed agent identities, and
`●` / `lobby` / `⚠ stale` tags. `⚠ stale` marks channels present only in
the file backend with no relay counterpart — makes orphan accumulation
visible at a glance.

Interactions in the overlay (most important for human driver):

- `Enter` on a row → **peek**: read last N messages of that channel and
  dump them into chat, read-only, no subscription. Covers the "let me
  see what's on ueeg/review-0022 before I jump in" use case.
- `/` → filter rows by substring.
- `q` / `Esc` → close.

**With arg:** `/channel-ls <substring>` — non-interactive, dumps
filtered list to chat as one multiline message; good for logs and
scripting.

**Under file-only transport** (relay down): same overlay, source is
`~/.agent-channels/*.json`, `sub-agents` and `watching` columns omitted.

### `/channel-clear`

**Removed.** Delete the handler, the registration, and the row from
`pi/extensions/agent-channel/README.md`. Rationale goes in the commit
message.

## Relationship to #0021

#0021 already delivers:

- `MessageTransport.listChannels()` on the interface.
- Implementations on all three transports (`FileTransport`,
  `UdsTransport`, `HttpTransport`).
- `LIST_CHANNELS` RPC on the relay (UDS + HTTP).
- Store-side channel iterator.
- Transport-aware rewrite of the `channel_list` *tool*.

This todo **depends on** that work and adds on top of it:

1. **Subscriber identities, not just count.** #0021's proposed payload
   is `{channel, messageCount, subscriberCount}`. This todo needs the
   relay to also return the *identity* of each subscriber (agent name
   + `since` timestamp), so the `sub-agents` column can show who is
   actually watching. Two options — coordinate with the #0021 author:
   - **a.** Amend #0021's payload shape to
     `{channel, messageCount, subscribers: [{agent, since}]}`
     up front (cleaner, one RPC change).
   - **b.** Land #0021 as specced, add a second field / second RPC
     here (less churn on #0021, slightly more code).

   Recommend (a). Either way, the relay already has this data — it
   maintains a per-channel subscriber table to do push-fanout.
2. **Slash-command overlay.** `ctx.ui.custom`-based UI with peek,
   filter, stale-tagging. No equivalent in #0021 (that's a tool, not a
   UI).
3. **Removal of `/channel-clear`.** Unrelated to #0021 mechanically,
   but belongs in the same branch since it touches the same file and
   has the same "slash commands are transport-unaware" root cause.

## Acceptance Criteria

- [ ] #0021 has landed (or is landing in the same branch) with
      `MessageTransport.listChannels()` available and the relay's
      `LIST_CHANNELS` RPC serving subscriber identities.
- [ ] `/channel-ls` with no args opens a `ctx.ui.custom` overlay with
      the columns and interactions above. `Enter` on a row peeks the
      last N messages of that channel into chat.
- [ ] `/channel-ls <substring>` dumps a filtered list to chat as one
      multiline message (single `notify`/chat write, not N calls —
      must not trigger the `showStatus` coalescing behavior).
- [ ] Under UDS transport on the dev machine, `/channel-ls` shows
      today's live channels with non-zero subscriber counts (manual
      verification — this is the regression).
- [ ] `⚠ stale` tag correctly appears on file-only channels that the
      relay does not know about.
- [ ] `/channel-clear` is removed: handler deleted, registration
      deleted, README entry deleted.
- [ ] `pi/extensions/agent-channel/README.md` command table reflects
      the new surface.
- [ ] Existing unit test suites for the extension still pass
      (`core.test.ts`, `transports.test.ts`, `uds.test.ts`,
      `http-transport.test.ts`).
- [ ] `bb relay:restart` called in the fix commit (relay caches at
      startup).

## Affected Files

Extension-side (this todo's primary scope):

- `pi/extensions/agent-channel/index.ts` — rewrite `/channel-ls`
  handler; delete `/channel-clear` registration + handler.
- `pi/extensions/agent-channel/README.md` — command table update.
- Possibly new: `pi/extensions/agent-channel/channel-ls-overlay.ts`
  (or inline if short) — the `ctx.ui.custom` component.

If #0021's payload shape needs amending (option (a) above):

- `shared/relay/server.ts`, `shared/relay/store.ts` — subscribers with
  identity, not just count.
- `pi/extensions/agent-channel/interfaces.ts` — `ChannelInfo.subscribers`
  shape.
- `uds-transport.ts`, `http-transport.ts`, `file-transport.ts` — return
  subscribers (empty for file).
- Tests in `shared/relay/*.test.ts` and `pi/extensions/agent-channel/*.test.ts`.

## E2E Spec

GIVEN a running relay with two non-empty channels and a subscriber on
each
WHEN the user opens `/channel-ls`
THEN the overlay lists both channels with correct totals, correct
     subscriber identities in the `sub-agents` column, and no stale-file
     orphans mixed into the live rows (orphans appear tagged `⚠ stale`).

GIVEN the relay is down (file-only transport)
WHEN the user opens `/channel-ls`
THEN the overlay lists `~/.agent-channels/*.json` channels with correct
     totals, and the `sub-agents` / `watching` columns are absent or
     empty.

GIVEN a user types `/channel-clear <any-name>`
WHEN the command is dispatched
THEN they get "Unknown command" (the command no longer exists) — no
     file is written, no toast claims success.

## Notes

### Deferred (YAGNI)

- `/channel-peek <channel> [N]` — covered by Enter-on-row in the
  overlay; no separate command.
- `/channel-gc` — cleanup of orphan `~/.agent-channels/*.json` files
  that have no relay counterpart. File as a separate todo only if the
  accumulation becomes a real pain; 51 files today is ugly but
  harmless.
- Bulk operations (`--all`, glob clears). Use `bb relay:restart` for
  the nuclear option.
- Optional `/channel-ls` flags (`--unacked`, `--mine`, `--stale`) —
  easy to add later once the overlay exists.

### Why remove `/channel-clear` rather than fix it

The only remaining legitimate use case for a per-channel clear is
tidying orphan files, which is a GC concern, not a clear concern.
Dotagents convention already treats closed channels as abandoned
(new task → new channel), and `bb relay:restart` covers the "start
fresh globally" case. Keeping a half-working destructive command is
worse than not having it.

### Prior art for the overlay

`ctx.ui.custom` overlays already shipped in the extensions tree:
`pi/extensions/agent-journal.ts:1130`, `bookmark.ts:132`,
`repo-todos.ts:1647`, `session-notes.ts:819`, `usage.ts:951`. Use
one as the structural template.

### Sequencing

If working on this alongside #0021, either:
1. Land #0021 first with its specced payload, then add subscriber
   identities here (option (b) — extra RPC churn).
2. Expand #0021's payload in-place to include subscriber identities
   (option (a) — cleaner). Either land together or land #0021 first
   with the expanded shape.

Recommend option (a), coordinated with whoever owns #0021.
