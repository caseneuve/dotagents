# Pi Emacs Bridge (v1)

Local, editor-first attach bridge for running interactive Pi sessions.

## Session artifacts

For each session with `pi/extensions/emacs-bridge.ts` loaded:

- socket: `~/.cache/pi-emacs-bridge/<session-id>.sock`
- metadata: `~/.cache/pi-emacs-bridge/<session-id>.json`

Directory/file permissions:

- dir: `0700`
- metadata + socket: `0600`

## Wire format

NDJSON (one JSON object per line), UTF-8.

Request:

```json
{"id":"emacs-1","method":"insert","params":{"text":"...","mode":"append"}}
```

Response:

```json
{"id":"emacs-1","ok":true,"result":{"inserted":123,"mode":"append"}}
```

Error:

```json
{"id":"emacs-1","ok":false,"error":{"code":"invalid_params","message":"..."}}
```

## Methods

- `ping` → protocol + pong
- `get_state` → `{ protocol, isIdle, cwd, editorText, timestamp }`
- `insert` with params:
  - `text` (required, non-empty string)
  - `mode` (`append` default, or `replace`)
- `send_return` → submits current Pi editor text as user message (idle: normal turn, busy: steer), then clears editor
- `send_escape` → aborts active turn if Pi is currently streaming; otherwise clears editor
- `clear_editor` → clears Pi editor text

`insert` writes to Pi editor (not directly to model turn submission).

## Emacs convenience commands

- `pi-emacs-bridge-send-position-dwim` → sends `path:start-end` when region is active, otherwise `path:line`
- `pi-emacs-bridge-clear-editor` → clears editor text (C-c equivalent)
