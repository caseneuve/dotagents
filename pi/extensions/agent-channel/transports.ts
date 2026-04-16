// ─── Transport implementations ──────────────────────────────────────────
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as net from "node:net";
import {
  channelPath,
  filterMessages,
  ackMessages,
  type ChannelMessage,
  type ChannelFile,
  type FilterOpts,
} from "./core";
import type { MessageTransport } from "./interfaces";

export const DEFAULT_CHANNEL_DIR = path.join(os.homedir(), ".agent-channels");
const DEFAULT_UDS_SOCKET = "/tmp/agent-channels.sock";

export async function createTransport(): Promise<MessageTransport> {
  const udsPath = process.env.AGENT_UDS_SOCKET || DEFAULT_UDS_SOCKET;
  // Probe UDS socket: try to connect and immediately disconnect
  if (fs.existsSync(udsPath)) {
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("probe timeout")),
          500,
        );
        const sock = net.createConnection({ path: udsPath }, () => {
          clearTimeout(timeout);
          sock.destroy();
          resolve();
        });
        sock.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
      return new UdsTransport(udsPath);
    } catch {
      // Socket file exists but relay is not running — fall through
    }
  }
  return new FileTransport(DEFAULT_CHANNEL_DIR);
}

// ─── File I/O helpers ───────────────────────────────────────────────────

export function readChannelFile(
  channelDir: string,
  channel: string,
): ChannelFile {
  const p = channelPath(channelDir, channel);
  if (!fs.existsSync(p)) return { messages: [] };
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (err) {
    console.error(
      `[agent-channel] failed to parse ${p}: ${err instanceof Error ? err.message : err}`,
    );
    return { messages: [] };
  }
}

export function writeChannelFile(
  channelDir: string,
  channel: string,
  data: ChannelFile,
): void {
  fs.mkdirSync(channelDir, { recursive: true });
  fs.writeFileSync(
    channelPath(channelDir, channel),
    JSON.stringify(data, null, 2),
  );
}

// ─── FileTransport ──────────────────────────────────────────────────────
// Poll-based transport using JSON files in a directory.
// subscribe() uses an internal poller — the only transport that needs one.

export class FileTransport implements MessageTransport {
  readonly name = "file";
  readonly channelDir: string;

  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private lastSeen: Map<string, number> = new Map();

  constructor(channelDir: string) {
    this.channelDir = channelDir;
  }

  async publish(msg: ChannelMessage): Promise<void> {
    const file = readChannelFile(this.channelDir, msg.channel);
    file.messages.push(msg);
    writeChannelFile(this.channelDir, msg.channel, file);
  }

  async read(channel: string, opts?: FilterOpts): Promise<ChannelMessage[]> {
    const file = readChannelFile(this.channelDir, channel);
    return filterMessages(file.messages, opts);
  }

  async ack(
    channel: string,
    messageId: string,
  ): Promise<{ ackedCount: number }> {
    const original = readChannelFile(this.channelDir, channel);
    const result = ackMessages(original, messageId);
    if (result.ackedCount > 0) {
      writeChannelFile(this.channelDir, channel, result.file);
    }
    return { ackedCount: result.ackedCount };
  }

  subscribe(
    channel: string,
    callback: (msgs: ChannelMessage[]) => void,
    opts?: { intervalMs?: number },
  ): void {
    this.unsubscribe(channel);

    const intervalMs = opts?.intervalMs ?? 3000;
    this.lastSeen.set(channel, Date.now());

    const timer = setInterval(async () => {
      const since = this.lastSeen.get(channel) || 0;
      const msgs = await this.read(channel, { since });
      if (msgs.length > 0) {
        this.lastSeen.set(channel, Math.max(...msgs.map((m) => m.timestamp)));
        callback(msgs);
      }
    }, intervalMs);

    this.timers.set(channel, timer);
  }

  unsubscribe(channel: string): void {
    const timer = this.timers.get(channel);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(channel);
      this.lastSeen.delete(channel);
    }
  }

  unsubscribeAll(): void {
    for (const [ch] of this.timers) {
      this.unsubscribe(ch);
    }
  }
}

// ─── UdsTransport ────────────────────────────────────────────────────────
// Push-based transport via Unix Domain Socket. Connects to relay server.
// Uses Node.js net module — works in both Node and Bun runtimes.
// subscribe() receives pushed messages in real-time — no polling.

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
}

export class UdsTransport implements MessageTransport {
  readonly name = "uds";
  private socketPath: string;
  private socket: net.Socket | null = null;
  private connected: boolean = false;
  private connectPromise: Promise<void> | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private subscriptions: Map<string, (msgs: ChannelMessage[]) => void> =
    new Map();
  private reqCounter = 0;
  private buffer = "";

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  private nextReqId(): string {
    return `r-${++this.reqCounter}-${Date.now()}`;
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected && this.socket) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const transport = this;
      const sock = net.createConnection({ path: this.socketPath }, () => {
        transport.socket = sock;
        transport.connected = true;
        transport.connectPromise = null;
        // Re-subscribe all active subscriptions after reconnect
        for (const [channel] of transport.subscriptions) {
          sock.write(JSON.stringify({ action: "subscribe", channel }) + "\n");
        }
        resolve();
      });

      sock.setEncoding("utf-8");

      sock.on("data", (data: string) => {
        transport.buffer += data;
        const lines = transport.buffer.split("\n");
        transport.buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const frame = JSON.parse(trimmed);
            transport.handleFrame(frame);
          } catch (err) {
            console.error(
              `[uds-transport] parse error: ${err instanceof Error ? err.message : err}`,
            );
          }
        }
      });

      sock.on("close", () => {
        transport.connected = false;
        transport.socket = null;
        transport.connectPromise = null;
        transport.buffer = "";
        for (const [, pending] of transport.pendingRequests) {
          pending.reject(new Error("Connection closed"));
        }
        transport.pendingRequests.clear();
      });

      sock.on("error", (err) => {
        transport.connected = false;
        transport.connectPromise = null;
        reject(err);
      });
    });

    return this.connectPromise;
  }

  private handleFrame(frame: any): void {
    if (frame.type === "message") {
      const cb = this.subscriptions.get(frame.channel);
      if (cb) cb([frame.msg]);
    } else if (frame.type === "response" && frame.reqId) {
      const pending = this.pendingRequests.get(frame.reqId);
      if (pending) {
        this.pendingRequests.delete(frame.reqId);
        pending.resolve(frame.data);
      }
    }
  }

  private send(obj: any): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.write(JSON.stringify(obj) + "\n");
  }

  private async request(obj: any): Promise<any> {
    await this.ensureConnected();
    const reqId = this.nextReqId();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(reqId, { resolve, reject });
      this.send({ ...obj, reqId });
      setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error(`Request ${reqId} timed out`));
        }
      }, 5000);
    });
  }

  async publish(msg: ChannelMessage): Promise<void> {
    await this.ensureConnected();
    this.send({ action: "publish", channel: msg.channel, msg });
  }

  async read(channel: string, opts?: FilterOpts): Promise<ChannelMessage[]> {
    return this.request({ action: "read", channel, opts });
  }

  async ack(
    channel: string,
    messageId: string,
  ): Promise<{ ackedCount: number }> {
    return this.request({ action: "ack", channel, messageId });
  }

  subscribe(channel: string, callback: (msgs: ChannelMessage[]) => void): void {
    this.subscriptions.set(channel, callback);
    this.ensureConnected().then(() => {
      this.send({ action: "subscribe", channel });
    });
  }

  unsubscribe(channel: string): void {
    this.subscriptions.delete(channel);
    if (this.connected) {
      try {
        this.send({ action: "unsubscribe", channel });
      } catch {
        /* connection may be gone */
      }
    }
  }

  unsubscribeAll(): void {
    for (const [ch] of this.subscriptions) {
      this.unsubscribe(ch);
    }
  }
}
