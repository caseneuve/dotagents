---
name: pk-tmux
triggers:
  - tmux
  - run in background
  - start server
  - run dev server
  - background task
  - persistent session
  - terminal session
allowedPrompts:
  - tool: Bash
    prompt: ag-tmux
---

# pk-tmux — Session Management Skill

## ag-tmux run — Preferred for all commands needing output

One call handles session/window creation, execution, polling, and clean output extraction. Exits with the command's exit code.

```bash
ag-tmux run <window> '<command>' [--timeout SECONDS] [--cd DIR] [--sock PATH] [--session NAME]
```

```bash
ag-tmux run test 'npm test'
ag-tmux run build 'make all' --timeout 600
ag-tmux run lint 'ruff check .' --cd ~/myproject
ag-tmux run deploy 'kubectl apply -f .' --sock /tmp/custom.sock --session app
```

Default timeout: 300s. Default socket: `/tmp/mux.sock`. Use `run_in_background: true` for long commands.

On first call, stderr shows the attach command — show it to the user so they can watch if they want. Skip if user says "just do it".

Use **unique window names** (`build`, `test`, `server`, `lint`). Filter verbose output with `| grep` or `| tail`.

## Other Subcommands

```bash
ag-tmux status [PROJECT] [CWD]        # session state, windows, processes
ag-tmux create [PROJECT] [CWD]        # ensure session exists
ag-tmux wait [PROJECT] [WINDOW] [N]   # poll until shell returns
```

## Manual tmux Commands

Default socket is `/tmp/mux.sock`:

```bash
# Send command
tmux -S /tmp/mux.sock send-keys -t <session>:<window> '<command>' Enter

# Capture output
tmux -S /tmp/mux.sock capture-pane -t <session>:<window> -p -S -20

# Check if busy
tmux -S /tmp/mux.sock display-message -t <session>:<window> -p "#{pane_current_command}"

# List windows
tmux -S /tmp/mux.sock list-windows -t <session> -F "#{window_index}: #{window_name}"

# Kill window / session
tmux -S /tmp/mux.sock kill-window -t <session>:<window>
tmux -S /tmp/mux.sock kill-session -t <session>
```
