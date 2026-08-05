# Skills

Runtime-specific skills are listed separately from the shared skills that
bootstrap installs for this runtime.

## Claude-specific skills

| Skill | Description |
|-------|-------------|
| [add-todo](add-todo/SKILL.md) | Create and manage `./todos/*.md` work items with helper scripts. |
| [code-review](code-review/SKILL.md) | Review uncommitted changes or branches, run checks, and save findings to `.reviews/`. |
| [journal](journal/SKILL.md) | Record post-mortems and learnings in `~/.claude/journal/`. |
| [org-journal](org-journal/SKILL.md) | Record session logs in `~/org/agent-journal/` and rebuild a shared Org index. |
| [pk-tmux](pk-tmux/SKILL.md) | Run commands in persistent per-project tmux sessions and retrieve clean output. |
| [project-init](project-init/SKILL.md) | Generate a concise project `CLAUDE.md` from detected stack and workflow details. |
| [sandbox](sandbox/SKILL.md) | Use isolated git worktrees for ticket work and controlled merges back to the main repo. |
| [self-reflect](self-reflect/SKILL.md) | Review the session for mistakes and friction, proposing targeted doc and rule improvements. |
| [ux-review](ux-review/SKILL.md) | Review user-facing text with a two-pass check for wording and structural-context gaps. |

## Shared skills

| Skill | Description |
|-------|-------------|
| [agent-comms](../../shared/skills/agent-comms/SKILL.md) | Communicate with other agents through shared channels and backend-aware status. |
| [callgraph](../../shared/skills/callgraph/SKILL.md) | Reconstruct call graphs and validate claims through concrete forward traces. |
| [dataflow](../../shared/skills/dataflow/SKILL.md) | Visualize typed data flow and mark pure, side-effecting, and mixed boundaries. |
| [linear](../../shared/skills/linear/SKILL.md) | Manage Linear projects, issues, milestones, labels, and status updates through MCP. |
| [linear-todo](../../shared/skills/linear-todo/SKILL.md) | Claim and finish repository todo work in Linear. |
| [testmap](../../shared/skills/testmap/SKILL.md) | Statically check test presence and source/test placement without running tests. |
