// Project-local companion to Herdr's bundled Pi integration.
//
// Mirrors Pi session metadata into Herdr's sidebar for this pane. It
// deliberately lives beside (rather than modifies) herdr-agent-state.ts,
// which Herdr manages and may overwrite on update.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import net from "node:net";

const SESSION_NAME_SOURCE = "custom:pi-session-name";
const MODEL_SOURCE = "custom:pi-model";
const HERDR_ENV = process.env.HERDR_ENV;
const socketPath = process.env.HERDR_SOCKET_PATH;
const socketEndpoint =
  process.platform === "win32" && socketPath
    ? `\\\\.\\pipe\\${socketPath}`
    : socketPath;
const paneId = process.env.HERDR_PANE_ID;

let requestSequence = 0;
let lastReportedName: string | undefined;
let lastReportedModel: string | undefined;

function enabled(): boolean {
  return HERDR_ENV === "1" && Boolean(socketEndpoint) && Boolean(paneId);
}

function sendRequest(request: unknown): Promise<void> {
  return new Promise((resolve) => {
    if (!enabled()) {
      resolve();
      return;
    }

    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const socket = net.createConnection(socketEndpoint!);
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      socket.destroy();
      resolve();
    };

    socket.on("error", finish);
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", finish);
    socket.on("end", finish);

    timeout = setTimeout(finish, 1_500);
    timeout.unref?.();
  });
}

function reportSessionName(name: string | undefined): void {
  const normalized = name?.trim() || undefined;
  if (normalized === lastReportedName) return;
  lastReportedName = normalized;

  void sendRequest({
    id: `${SESSION_NAME_SOURCE}:${Date.now()}:${++requestSequence}`,
    method: "pane.report_metadata",
    params: {
      pane_id: paneId,
      source: SESSION_NAME_SOURCE,
      agent: "pi",
      ...(normalized
        ? { display_agent: normalized }
        : { clear_display_agent: true }),
    },
  });
}

function sidebarModelName(model: string | undefined): string | undefined {
  const claude = model?.match(/(?:^|[/.])claude-((?:sonnet|opus)-.+)$/)?.[1];
  return claude ?? model;
}

function reportModel(model: string | undefined): void {
  const name = sidebarModelName(model);
  if (name === lastReportedModel) return;
  lastReportedModel = name;

  void sendRequest({
    id: `${MODEL_SOURCE}:${Date.now()}:${++requestSequence}`,
    method: "pane.report_metadata",
    params: {
      pane_id: paneId,
      source: MODEL_SOURCE,
      agent: "pi",
      tokens: { model: name ?? null },
    },
  });
}

type SessionInfoChangedEvent = { name: string | undefined };
type SessionEventContext = { hasUI: boolean };

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.hasUI) {
      reportSessionName(pi.getSessionName());
      reportModel(ctx.model?.id);
    }
  });

  pi.on("model_select", (event, ctx) => {
    if (ctx.hasUI) {
      reportModel(event.model.id);
    }
  });

  // session_info_changed was added after this repository's initially pinned
  // Pi API types. Current Pi runtimes emit it whenever /name changes.
  const onSessionInfoChanged = pi.on as unknown as (
    event: "session_info_changed",
    handler: (event: SessionInfoChangedEvent, ctx: SessionEventContext) => void,
  ) => void;
  onSessionInfoChanged("session_info_changed", (event, ctx) => {
    if (ctx.hasUI) {
      reportSessionName(event.name);
    }
  });
}
