---
name: pk-tmux
description: Run commands in persistent per-project tmux sessions and retrieve clean output through helper scripts.
---

# PK Tmux

Use this skill when commands should keep running in a persistent tmux session or when you need repeatable access to command output.

## Preferred entrypoint

Use `tmux-run.sh` for most cases. It handles session creation, window creation, execution, waiting, and clean output capture in one call.

```bash
~/.agents/skills/pk-tmux/tmux-run.sh <window> '<command>' [--timeout SECONDS] [--cd DIR] [--sock PATH] [--session NAME]
```

Examples:

```bash
~/.agents/skills/pk-tmux/tmux-run.sh test 'npm test'
~/.agents/skills/pk-tmux/tmux-run.sh build 'make all' --timeout 600
~/.agents/skills/pk-tmux/tmux-run.sh lint 'ruff check .' --cd ~/myproject
~/.agents/skills/pk-tmux/tmux-run.sh deploy 'kubectl apply -f .' --sock /tmp/claude-app.sock --session app
```

Guidance:

- Default timeout is 300 seconds unless the helper says otherwise.
- Use distinct window names such as `build`, `test`, `server`, or `lint`.
- For long-running commands, leave them in tmux and poll instead of blocking the main interaction loop.
- On first creation, the helper may print an attach command. Share it with the user if they may want to observe the session.

## Helper scripts

Use these when you need lower-level control than `tmux-run.sh`:

```bash
~/.agents/skills/pk-tmux/tmux-status.sh [project] [cwd]
~/.agents/skills/pk-tmux/tmux-create.sh [project] [cwd]
~/.agents/skills/pk-tmux/tmux-wait.sh <project> <window>
```

Typical uses:

- `tmux-status.sh`: inspect session state, windows, and current processes
- `tmux-create.sh`: ensure the project session exists before manual tmux commands
- `tmux-wait.sh`: poll until a shell is idle again after `send-keys` flows

## Manual tmux commands

If the helper scripts are insufficient, operate directly against the project socket.
The shared helpers still use the legacy socket naming convention under `/tmp/claude-<project>.sock`, so keep manual commands aligned with that:

```bash
tmux -S /tmp/claude-<project>.sock send-keys -t <project>:<window> '<command>' Enter
tmux -S /tmp/claude-<project>.sock capture-pane -t <project>:<window> -p -S -20
tmux -S /tmp/claude-<project>.sock display-message -t <project>:<window> -p "#{pane_current_command}"
tmux -S /tmp/claude-<project>.sock list-windows -t <project> -F "#{window_index}: #{window_name}"
tmux -S /tmp/claude-<project>.sock kill-window -t <project>:<window>
tmux -S /tmp/claude-<project>.sock kill-session -t <project>
```

Prefer helpers first. Drop to raw tmux only when you need behavior the wrappers do not expose.
