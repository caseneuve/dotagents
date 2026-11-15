---
name: pk-tmux
description: Run commands in persistent per-project tmux sessions and retrieve clean output through subcommands.
---

# PK Tmux

Use this skill when commands should keep running in a persistent tmux session or when you need repeatable access to command output.

## Preferred entrypoint

Use `ag-tmux run` for most cases. It handles session creation, window creation, execution, waiting, and clean output capture in one call.

```bash
ag-tmux run <window> '<command>' [--timeout SECONDS] [--cd DIR] [--sock PATH] [--session NAME]
```

Examples:

```bash
ag-tmux run test 'npm test'
ag-tmux run build 'make all' --timeout 600
ag-tmux run lint 'ruff check .' --cd ~/myproject
ag-tmux run deploy 'kubectl apply -f .' --sock /tmp/custom.sock --session app
```

Guidance:

- Default timeout is 300 seconds unless the helper says otherwise.
- Default socket is `/tmp/mux.sock` (shared across sessions).
- Use distinct window names such as `build`, `test`, `server`, or `lint`.
- For long-running commands, leave them in tmux and poll instead of blocking the main interaction loop.
- On first creation, the helper may print an attach command. Share it with the user if they may want to observe the session.

## Other subcommands

Use these when you need lower-level control than `ag-tmux run`:

```bash
ag-tmux status [PROJECT] [CWD]
ag-tmux create [PROJECT] [CWD]
ag-tmux wait [PROJECT] [WINDOW] [CAPTURE-LINES]
```

Typical uses:

- `ag-tmux status`: inspect session state, windows, and current processes
- `ag-tmux create`: ensure the project session exists before manual tmux commands
- `ag-tmux wait`: poll until a shell is idle again after `send-keys` flows

## Manual tmux commands

If the subcommands are insufficient, operate directly against the project socket.
Default socket is `/tmp/mux.sock`:

```bash
tmux -S /tmp/mux.sock send-keys -t <session>:<window> '<command>' Enter
tmux -S /tmp/mux.sock capture-pane -t <session>:<window> -p -S -20
tmux -S /tmp/mux.sock display-message -t <session>:<window> -p "#{pane_current_command}"
tmux -S /tmp/mux.sock list-windows -t <session> -F "#{window_index}: #{window_name}"
tmux -S /tmp/mux.sock kill-window -t <session>:<window>
tmux -S /tmp/mux.sock kill-session -t <session>
```

Prefer subcommands first. Drop to raw tmux only when you need behavior the wrappers do not expose.
