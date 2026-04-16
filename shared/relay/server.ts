// ─── Relay server: UDS pub/sub broker ───────────────────────────────────
import { ChannelStore, type ChannelMessage } from "./store";
import type { Socket } from "bun";
import * as fs from "node:fs";

// ─── NDJSON protocol types ──────────────────────────────────────────────

interface PublishRequest {
  action: "publish";
  channel: string;
  msg: ChannelMessage;
}

interface SubscribeRequest {
  action: "subscribe";
  channel: string;
}

interface UnsubscribeRequest {
  action: "unsubscribe";
  channel: string;
}

interface ReadRequest {
  action: "read";
  channel: string;
  opts?: { since?: number; unacked?: boolean; type?: string };
  reqId: string;
}

interface AckRequest {
  action: "ack";
  channel: string;
  messageId: string;
  reqId: string;
}

interface ListRequest {
  action: "list";
  reqId: string;
}

type ClientRequest =
  | PublishRequest
  | SubscribeRequest
  | UnsubscribeRequest
  | ReadRequest
  | AckRequest
  | ListRequest;

// ─── Server ─────────────────────────────────────────────────────────────

export interface RelayServerOptions {
  socketPath: string;
  maxPerChannel?: number;
  verbose?: boolean;
}

export class RelayServer {
  private store: ChannelStore;
  private subscribers: Map<string, Set<Socket<{ buffer: string }>>> = new Map();
  private server: ReturnType<typeof Bun.listen> | null = null;
  readonly socketPath: string;

  private verbose: boolean;

  constructor(opts: RelayServerOptions) {
    this.socketPath = opts.socketPath;
    this.store = new ChannelStore({
      maxPerChannel: opts.maxPerChannel ?? 1000,
    });
    this.verbose = opts.verbose ?? false;
  }

  private log(msg: string): void {
    if (this.verbose) console.log(`[relay] ${msg}`);
  }

  start(): void {
    const relay = this;

    this.server = Bun.listen<{ buffer: string }>({
      unix: this.socketPath,
      socket: {
        open(socket) {
          socket.data = { buffer: "" };
          relay.log("client connected");
        },
        data(socket, data) {
          // Accumulate data and process complete NDJSON lines
          socket.data.buffer += data.toString();
          const lines = socket.data.buffer.split("\n");
          // Keep incomplete last line in buffer
          socket.data.buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const req = JSON.parse(trimmed) as ClientRequest;
              relay.handleRequest(socket, req);
            } catch (err) {
              console.error(
                `[relay] failed to parse: ${err instanceof Error ? err.message : err}`,
              );
            }
          }
        },
        close(socket) {
          relay.log("client disconnected");
          // Remove from all subscription sets
          for (const [, sockets] of relay.subscribers) {
            sockets.delete(socket);
          }
        },
        error(_socket, err) {
          console.error(`[relay] socket error: ${err.message}`);
        },
      },
    });
  }

  stop(): void {
    this.server?.stop(true);
    this.server = null;
    // Clean up socket file
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      /* already gone */
    }
  }

  private handleRequest(
    socket: Socket<{ buffer: string }>,
    req: ClientRequest,
  ): void {
    switch (req.action) {
      case "publish": {
        const msg = this.store.publish(req.msg);
        const subs = this.subscribers.get(req.channel);
        const fanCount = subs
          ? [...subs].filter((s) => s !== socket).length
          : 0;
        this.log(
          `publish [${req.channel}] from=${req.msg.from} type=${req.msg.type} fanout=${fanCount}`,
        );
        if (subs) {
          const frame =
            JSON.stringify({ type: "message", channel: req.channel, msg }) +
            "\n";
          for (const sub of subs) {
            if (sub !== socket) sub.write(frame); // skip sender
          }
        }
        break;
      }

      case "subscribe": {
        let subs = this.subscribers.get(req.channel);
        if (!subs) {
          subs = new Set();
          this.subscribers.set(req.channel, subs);
        }
        subs.add(socket);
        this.log(`subscribe [${req.channel}] total=${subs.size}`);
        break;
      }

      case "unsubscribe": {
        const subs = this.subscribers.get(req.channel);
        if (subs) {
          subs.delete(socket);
          this.log(`unsubscribe [${req.channel}] remaining=${subs.size}`);
          if (subs.size === 0) this.subscribers.delete(req.channel);
        }
        break;
      }

      case "read": {
        const msgs = this.store.read(req.channel, req.opts);
        this.log(`read [${req.channel}] results=${msgs.length}`);
        const frame =
          JSON.stringify({ type: "response", reqId: req.reqId, data: msgs }) +
          "\n";
        socket.write(frame);
        break;
      }

      case "ack": {
        const result = this.store.ack(req.channel, req.messageId);
        const frame =
          JSON.stringify({
            type: "response",
            reqId: req.reqId,
            data: result,
          }) + "\n";
        socket.write(frame);
        break;
      }

      case "list": {
        const channels = this.store.list();
        const frame =
          JSON.stringify({
            type: "response",
            reqId: req.reqId,
            data: channels,
          }) + "\n";
        socket.write(frame);
        break;
      }
    }
  }
}
