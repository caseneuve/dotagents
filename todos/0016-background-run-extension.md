---
title: Pi extension for non-blocking background command execution
status: open
priority: medium
type: feature
labels: []
created: 2026-04-17
parent: null
blocked-by: []
blocks: []
---

## Context

When an AI agent runs long-running commands (e.g. functional tests that take 5-10 minutes),
the `bash` tool call blocks until the command finishes. The agent sits idle, the human has
to babysit, and no useful work gets done in the meantime.

The agent should be able to fire off a long-running command, continue working (research,
planning, editing code), and get notified when the command completes — with the result
injected back into the conversation automatically.

### Concrete use case

In the PythonAnywhere project, `pat test nobrowser test_foo.py` runs a functional test in
a VM via SSH. This can take 2-10 minutes. The agent calls it via `bash`, blocks, and can't
do anything else. With this extension, the agent would call `background_run`, get back
"started", keep editing files or reading docs, and eventually receive "test PASSED" as an
injected message that triggers a new turn.

## Acceptance Criteria

- [ ] Pi extension registers a `background_run` tool the LLM can call
- [ ] The tool spawns the command as a child process and returns immediately
- [ ] When the process exits, `pi.sendMessage()` injects the result into the conversation
      with `triggerTurn: true` so the agent resumes automatically
- [ ] Output is captured (stdout + stderr) and included in the notification (truncated to
      last ~2000 chars to avoid context bloat)
- [ ] Exit code is reported and clearly labelled (PASSED/FAILED or exit code N)
- [ ] Multiple background commands can run concurrently without interfering
- [ ] Extension lives in `pi/extensions/` (auto-discovered by pi)

## Affected Files

- `pi/extensions/background-run.ts` — new extension (or `pi/extensions/background-run/index.ts`)

## Reference Implementation

```typescript
import { spawn } from "node:child_process";

export default function(pi) {
  pi.registerTool({
    name: "background_run",
    description: "Run a long-running command in background. Returns immediately. You'll be notified when it completes.",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to run" }),
      label: Type.String({ description: "Short label for this task" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const child = spawn("bash", ["-c", params.command], {
        cwd: ctx.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));

      child.on("exit", (code) => {
        const status = code === 0 ? "✅ PASSED" : "❌ FAILED";
        pi.sendMessage({
          content: `Background task "${params.label}" finished: ${status}\n\nExit code: ${code}\n\nOutput (last 2000 chars):\n${stdout.slice(-2000)}${stderr ? "\n\nStderr:\n" + stderr.slice(-500) : ""}`,
          display: true,
        }, { triggerTurn: true, deliverAs: "followUp" });
      });

      return {
        content: [{ type: "text", text: `Started "${params.label}" in background (PID ${child.pid}). Continue working — you'll be notified when it completes.` }],
      };
    },
  });
}
```

## Notes

- This is generic infrastructure — not PA-specific. Any project with long-running commands
  benefits (test suites, builds, deployments, linters on large codebases).
- `deliverAs: "followUp"` waits for the agent to finish its current tool calls before
  delivering, avoiding mid-turn interruption. `triggerTurn: true` wakes the agent if idle.
- The snippet above is a starting point — may need adjustments for pi's Type imports,
  error handling (process spawn failure), and signal/abort handling.
- Consider adding a `promptSnippet` so the tool appears in the system prompt's available
  tools section.
- Consider cmux integration: if running inside cmux, could also send a `cmux notify` so
  the human sees it in the sidebar even if not watching the agent's conversation.
