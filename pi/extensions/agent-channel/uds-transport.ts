// ─── UdsTransport: push-based via Unix Domain Socket ────────────────────
// Connects to relay server. Uses Node.js net module — works in both
// Node and Bun runtimes. subscribe() receives pushed messages in
// real-time — no polling.
import * as net from "node:net";
import type { ChannelMessage, FilterOpts } from "./core";
import type { MessageTransport } from "./interfaces";

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
