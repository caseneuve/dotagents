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
    prompt: run tmux-run.sh to execute commands in tmux and return output
  - tool: Bash
    prompt: run tmux helper scripts (tmux-status.sh, tmux-create.sh, tmux-wait.sh)
  - tool: Bash
    prompt: send commands to tmux session
  - tool: Bash
    prompt: capture tmux pane output
---

# pk-tmux — Session Management Skill

## tmux-run.sh — Preferred for all commands needing output

One call handles session/window creation, execution, polling, and clean output extraction. Exits with the command's exit code.

```bash
~/.claude/skills/pk-tmux/tmux-run.sh <window> '<command>' [--timeout SECONDS] [--cd DIR] [--sock PATH] [--session NAME]
```

```bash
~/.claude/skills/pk-tmux/tmux-run.sh test 'npm test'
~/.claude/skills/pk-tmux/tmux-run.sh build 'make all' --timeout 600
~/.claude/skills/pk-tmux/tmux-run.sh lint 'ruff check .' --cd ~/myproject
~/.claude/skills/pk-tmux/tmux-run.sh deploy 'kubectl apply -f .' --sock /tmp/claude-app.sock --session app
```

Default timeout: 300s. Use `run_in_background: true` for long commands.

On first call, stderr shows the attach command — show it to the user so they can watch if they want. Skip if user says "just do it".

Use **unique window names** (`build`, `test`, `server`, `lint`). Filter verbose output with `| grep` or `| tail`.

## Helper Scripts

```bash
~/.claude/skills/pk-tmux/tmux-status.sh [project] [cwd]   # session state, windows, processes
~/.claude/skills/pk-tmux/tmux-create.sh [project] [cwd]   # ensure session exists
~/.claude/skills/pk-tmux/tmux-wait.sh <project> <window>  # poll until shell returns (for send-keys flows)
```

## Manual tmux Commands

```bash
# Send command
tmux -S /tmp/claude-<project>.sock send-keys -t <project>:<window> '<command>' Enter

# Capture output
tmux -S /tmp/claude-<project>.sock capture-pane -t <project>:<window> -p -S -20

# Check if busy
tmux -S /tmp/claude-<project>.sock display-message -t <project>:<window> -p "#{pane_current_command}"

# List windows
tmux -S /tmp/claude-<project>.sock list-windows -t <project> -F "#{window_index}: #{window_name}"

# Kill window / session
tmux -S /tmp/claude-<project>.sock kill-window -t <project>:<window>
tmux -S /tmp/claude-<project>.sock kill-session -t <project>
```
