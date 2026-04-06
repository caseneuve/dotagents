import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Type } from "@sinclair/typebox";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

const EXTENSION_KEY = "subagents";
const STATUS_KEY = "subagents";
const WIDGET_MAX_ROWS = 6;
const UPDATE_THROTTLE_MS = 250;
const OUTPUT_PREVIEW_LIMIT = 900;

type JobStatus =
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

type SubagentJob = {
  id: string;
  label: string;
  task: string;
  paths: string[];
  model?: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  origin: {
    parentEntryId: string;
    parentSessionFile?: string;
  };
  latestActivity: string;
  output: string;
  errorOutput: string;
  finalSummary?: string;
  childProcess?: ChildProcessWithoutNullStreams;
};

function formatDuration(startedAt: number, endedAt?: number): string {
  const elapsedMs = Math.max(0, (endedAt ?? Date.now()) - startedAt);
  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m${seconds % 60}s`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function shortText(value: string, limit = 70): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

function takePreview(value: string, limit = OUTPUT_PREVIEW_LIMIT): string {
  if (!value.trim()) {
    return "";
  }
  return value.slice(0, limit).trimEnd();
}

function buildChildPrompt(task: string, paths: string[]): string {
  const scopeLine =
    paths.length > 0
      ? `Preferred scope (focus first): ${paths.join(", ")}`
      : "Preferred scope: whole repository";

  return [
    "You are a delegated codebase subagent.",
    "",
    "Task:",
    task.trim(),
    "",
    scopeLine,
    "",
    "Hard rules:",
    "- Stay read-only.",
    "- Do not modify files.",
    "- Do not run destructive commands.",
    "",
    "Output format:",
    "1) concise summary",
    "2) key findings with evidence file paths",
    "3) open questions",
  ].join("\n");
}

function summarizeCompletion(job: SubagentJob): string {
  const outputPreview = shortText(job.output, 120);
  const errorPreview = shortText(job.errorOutput, 120);

  if (job.status === "completed") {
    if (outputPreview) return outputPreview;
    return "Completed with empty response";
  }

  if (job.status === "cancelled") {
    return "Cancelled by user";
  }

  if (job.status === "failed") {
    return errorPreview || "Failed";
  }

  return job.latestActivity;
}

export default function subagentsExtension(pi: ExtensionAPI) {
  let activeCtx: ExtensionContext | undefined;
  let nextId = 1;
  let refreshTimer: NodeJS.Timeout | undefined;
  const jobs = new Map<string, SubagentJob>();

  const getSortedJobs = (): SubagentJob[] =>
    [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);

  const renderStatus = (): string | undefined => {
    const all = getSortedJobs();
    if (all.length === 0) return undefined;

    const runningCount = all.filter((job) => job.status === "running").length;
    const cancellingCount = all.filter(
      (job) => job.status === "cancelling",
    ).length;

    return `subagents: ${runningCount} running${cancellingCount > 0 ? `, ${cancellingCount} stopping` : ""}, ${all.length} total`;
  };

  const renderWidgetLines = (): string[] => {
    const all = getSortedJobs();
    if (all.length === 0) return [];

    const lines = ["Subagents", "─────────"];

    for (const job of all.slice(0, WIDGET_MAX_ROWS)) {
      const elapsed = formatDuration(job.createdAt, job.finishedAt);
      lines.push(
        `${job.id} · ${job.status} · ${elapsed} · ${shortText(job.label, 36)}`,
      );
      lines.push(`  ${shortText(job.latestActivity || "idle", 72)}`);
    }

    lines.push("/subagents · /subagent <id> · /subagent-kill <id>");
    return lines;
  };

  const refreshUi = () => {
    if (!activeCtx || !activeCtx.hasUI) return;
    activeCtx.ui.setStatus(STATUS_KEY, renderStatus());
    activeCtx.ui.setWidget(EXTENSION_KEY, renderWidgetLines());
  };

  const scheduleRefresh = () => {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      refreshUi();
    }, UPDATE_THROTTLE_MS);
  };

  const updateJob = (job: SubagentJob, partial: Partial<SubagentJob>) => {
    Object.assign(job, partial);
    job.updatedAt = Date.now();
    scheduleRefresh();
  };

  const spawnJob = (job: SubagentJob, cwd: string) => {
    const prompt = buildChildPrompt(job.task, job.paths);
    const args = ["-p", "--no-session"];

    if (job.model && job.model.trim()) {
      args.push("--model", job.model.trim());
    }

    args.push(prompt);

    let child: ChildProcessWithoutNullStreams;

    try {
      child = spawn("pi", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PI_SUBAGENT_PARENT: "1",
        },
      });
    } catch (error) {
      updateJob(job, {
        status: "failed",
        finishedAt: Date.now(),
        latestActivity: `failed to spawn: ${String(error)}`,
      });
      return;
    }

    job.childProcess = child;
    updateJob(job, {
      status: "running",
      latestActivity: "started",
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      job.output += text;

      const activity = shortText(text, 60);
      if (activity) {
        updateJob(job, {
          latestActivity: `output: ${activity}`,
        });
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      job.errorOutput += text;

      const activity = shortText(text, 60);
      if (activity) {
        updateJob(job, {
          latestActivity: `stderr: ${activity}`,
        });
      }
    });

    child.on("error", (error) => {
      updateJob(job, {
        status: "failed",
        finishedAt: Date.now(),
        latestActivity: `process error: ${String(error)}`,
      });
    });

    child.on("close", (code, signal) => {
      const wasCancelling = job.status === "cancelling";
      const finishedAt = Date.now();
      const success = code === 0 && !signal;

      if (wasCancelling) {
        updateJob(job, {
          status: "cancelled",
          finishedAt,
          latestActivity: "cancelled",
        });
        return;
      }

      if (success) {
        updateJob(job, {
          status: "completed",
          finishedAt,
          latestActivity: "completed",
          finalSummary: shortText(job.output, 220) || "Completed",
        });
        return;
      }

      updateJob(job, {
        status: "failed",
        finishedAt,
        latestActivity: `exited code=${String(code)} signal=${String(signal)}`,
        finalSummary: shortText(job.errorOutput || job.output, 220) || "Failed",
      });
    });
  };

  const stopJob = (job: SubagentJob): boolean => {
    if (job.status !== "running") {
      return false;
    }

    updateJob(job, {
      status: "cancelling",
      latestActivity: "cancellation requested",
    });

    job.childProcess?.kill("SIGTERM");
    setTimeout(() => {
      if (job.status === "cancelling") {
        job.childProcess?.kill("SIGKILL");
      }
    }, 2000);

    return true;
  };

  pi.registerTool({
    name: "spawn_subagent",
    label: "Spawn Subagent",
    description:
      "Start a background delegated subagent job and return a job id immediately.",
    promptSnippet:
      "Spawn an async background subagent job and return a controllable job id",
    promptGuidelines: [
      "Use this when you want delegated async work without blocking the main flow.",
      "Do not assume subagent reasoning is visible in parent context; inspect via /subagent commands.",
    ],
    parameters: Type.Object({
      task: Type.String({
        description: "Delegated task for the child subagent",
      }),
      label: Type.Optional(
        Type.String({ description: "Optional short human-friendly label" }),
      ),
      paths: Type.Optional(
        Type.Array(Type.String(), {
          description: "Optional path hints the child should prioritize",
        }),
      ),
      model: Type.Optional(
        Type.String({
          description: "Optional model override passed to `pi --model`",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const now = Date.now();
      const jobId = `sa-${String(nextId).padStart(4, "0")}`;
      nextId += 1;

      const label =
        params.label?.trim() ||
        shortText(params.task, 42) ||
        `subagent-${jobId}`;
      const job: SubagentJob = {
        id: jobId,
        label,
        task: params.task,
        paths: params.paths ?? [],
        model: params.model,
        status: "running",
        createdAt: now,
        updatedAt: now,
        origin: {
          parentEntryId: ctx.sessionManager.getLeafId() ?? "unknown",
          parentSessionFile: ctx.sessionManager.getSessionFile(),
        },
        latestActivity: "queued",
        output: "",
        errorOutput: "",
      };

      jobs.set(job.id, job);
      scheduleRefresh();
      spawnJob(job, ctx.cwd);

      return {
        content: [
          {
            type: "text",
            text: `Spawned subagent ${job.id} (${job.label}). Inspect with /subagent ${job.id} and cancel with /subagent-kill ${job.id}.`,
          },
        ],
        details: {
          jobId: job.id,
          status: job.status,
          label: job.label,
          origin: job.origin,
          note: "Subagent runs in background. Parent context only receives this acknowledgement by default.",
        },
      };
    },
  });

  pi.registerCommand("subagents", {
    description: "List subagent jobs and statuses",
    handler: async (_args, ctx) => {
      const all = getSortedJobs();
      if (all.length === 0) {
        ctx.ui.notify("No subagent jobs yet.", "info");
        return;
      }

      const lines = all.map((job) => {
        const elapsed = formatDuration(job.createdAt, job.finishedAt);
        return `${job.id} | ${job.status} | ${elapsed} | ${shortText(job.label, 48)}`;
      });

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("subagent", {
    description: "Inspect a subagent job by id",
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!id) {
        ctx.ui.notify("Usage: /subagent <job-id>", "warning");
        return;
      }

      const job = jobs.get(id);
      if (!job) {
        ctx.ui.notify(`Unknown subagent job: ${id}`, "warning");
        return;
      }

      const details = [
        `${job.id} · ${job.status}`,
        `label: ${job.label}`,
        `origin entry: ${job.origin.parentEntryId}`,
        `origin session: ${job.origin.parentSessionFile ?? "(ephemeral)"}`,
        `model: ${job.model ?? "(default)"}`,
        `paths: ${job.paths.length > 0 ? job.paths.join(", ") : "(none)"}`,
        `elapsed: ${formatDuration(job.createdAt, job.finishedAt)}`,
        `activity: ${job.latestActivity}`,
        "",
        "Summary:",
        summarizeCompletion(job),
      ];

      const outputPreview = takePreview(job.output);
      if (outputPreview) {
        details.push("", "Output preview:", outputPreview);
      }

      const errPreview = takePreview(job.errorOutput, 400);
      if (errPreview) {
        details.push("", "Error preview:", errPreview);
      }

      ctx.ui.notify(details.join("\n"), "info");
    },
  });

  pi.registerCommand("subagent-kill", {
    description: "Cancel a running subagent by id",
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!id) {
        ctx.ui.notify("Usage: /subagent-kill <job-id>", "warning");
        return;
      }

      const job = jobs.get(id);
      if (!job) {
        ctx.ui.notify(`Unknown subagent job: ${id}`, "warning");
        return;
      }

      if (stopJob(job)) {
        ctx.ui.notify(`Cancellation requested for ${id}`, "info");
      } else {
        ctx.ui.notify(
          `${id} is ${job.status}; only running jobs can be cancelled`,
          "warning",
        );
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    activeCtx = ctx;
    refreshUi();
  });

  pi.on("session_tree", async (_event, ctx) => {
    activeCtx = ctx;
    refreshUi();
  });

  pi.on("session_shutdown", async () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
    }

    for (const job of jobs.values()) {
      if (job.status === "running") {
        stopJob(job);
      }
    }
  });
}
