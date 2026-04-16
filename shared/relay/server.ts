// ─── Relay server: UDS + HTTP/SSE pub/sub broker ────────────────────────
import { ChannelStore, type ChannelMessage } from "./store";
import type { Socket, Server as BunServer } from "bun";
import * as fs from "node:fs";

// ─── Subscriber: abstraction over UDS socket and SSE response ───────────

interface Subscriber {
  /** Write a string to this subscriber. */
  write(data: string): void;
  /** Unique identity for dedup / removal. */
  id: number;
}

// ─── Server ─────────────────────────────────────────────────────────────

export interface RelayServerOptions {
  socketPath: string;
  httpPort?: number;
  httpHost?: string;
  maxPerChannel?: number;
  verbose?: boolean;
}

export class RelayServer {
  private store: ChannelStore;
  private subscribers: Map<string, Set<Subscriber>> = new Map();
  private udsServer: ReturnType<typeof Bun.listen> | null = null;
  private httpServer: BunServer | null = null;
  private nextSubId = 0;
  readonly socketPath: string;
  readonly httpPort: number;
  readonly httpHost: string;
  private verbose: boolean;

  constructor(opts: RelayServerOptions) {
    this.socketPath = opts.socketPath;
    this.httpPort = opts.httpPort ?? 7700;
    this.httpHost = opts.httpHost ?? "0.0.0.0";
    this.store = new ChannelStore({
      maxPerChannel: opts.maxPerChannel ?? 1000,
    });
    this.verbose = opts.verbose ?? false;
  }

  private log(msg: string): void {
    if (this.verbose) console.log(`[relay] ${msg}`);
  }

  private corsJson(data: any, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // ─── Fan-out to subscribers ───────────────────────────────────────────

  private fanOut(
    channel: string,
    msg: ChannelMessage,
    excludeId?: number,
  ): number {
    const subs = this.subscribers.get(channel);
    if (!subs) return 0;
    const frame = JSON.stringify({ type: "message", channel, msg }) + "\n";
    let count = 0;
    for (const sub of subs) {
      if (sub.id !== excludeId) {
        sub.write(frame);
        count++;
      }
    }
    return count;
  }

  private addSubscriber(channel: string, sub: Subscriber): void {
    let subs = this.subscribers.get(channel);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(channel, subs);
    }
    subs.add(sub);
    this.log(`subscribe [${channel}] total=${subs.size}`);
  }

  private removeSubscriber(channel: string, sub: Subscriber): void {
    const subs = this.subscribers.get(channel);
    if (subs) {
      subs.delete(sub);
      this.log(`unsubscribe [${channel}] remaining=${subs.size}`);
      if (subs.size === 0) this.subscribers.delete(channel);
    }
  }

  private removeSubscriberFromAll(sub: Subscriber): void {
    for (const [, subs] of this.subscribers) {
      subs.delete(sub);
    }
  }

  // ─── UDS server ──────────────────────────────────────────────────────

  start(): void {
    this.startUds();
    this.startHttp();
  }

  private startUds(): void {
    const relay = this;

    // Map UDS sockets to their subscriber wrappers
    const socketSubs = new WeakMap<Socket<{ buffer: string }>, Subscriber>();

    this.udsServer = Bun.listen<{ buffer: string }>({
      unix: this.socketPath,
      socket: {
        open(socket) {
          socket.data = { buffer: "" };
          const sub: Subscriber = {
            id: ++relay.nextSubId,
            write(data: string) {
              socket.write(data);
            },
          };
          socketSubs.set(socket, sub);
          relay.log(`uds client connected (id=${sub.id})`);
        },
        data(socket, data) {
          socket.data.buffer += data.toString();
          const lines = socket.data.buffer.split("\n");
          socket.data.buffer = lines.pop() || "";

          const sub = socketSubs.get(socket)!;
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const req = JSON.parse(trimmed);
              relay.handleNdjsonRequest(sub, req);
            } catch (err) {
              console.error(
                `[relay] failed to parse: ${err instanceof Error ? err.message : err}`,
              );
            }
          }
        },
        close(socket) {
          const sub = socketSubs.get(socket);
          if (sub) {
            relay.log(`uds client disconnected (id=${sub.id})`);
            relay.removeSubscriberFromAll(sub);
          }
        },
        error(_socket, err) {
          console.error(`[relay] uds socket error: ${err.message}`);
        },
      },
    });
  }

  // ─── HTTP/SSE server ─────────────────────────────────────────────────

  private startHttp(): void {
    const relay = this;

    this.httpServer = Bun.serve({
      port: this.httpPort,
      hostname: this.httpHost,
      fetch(req) {
        // CORS preflight
        if (req.method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          });
        }

        const url = new URL(req.url);
        const parts = url.pathname.split("/").filter(Boolean);

        // GET /channels — list
        if (
          req.method === "GET" &&
          parts[0] === "channels" &&
          parts.length === 1
        ) {
          return relay.corsJson(relay.store.list());
        }

        // GET /channels/:channel/stream — SSE subscription
        if (
          req.method === "GET" &&
          parts[0] === "channels" &&
          parts.length >= 3 &&
          parts[parts.length - 1] === "stream"
        ) {
          const channel = parts.slice(1, -1).join("/");
          return relay.handleSse(channel);
        }

        // POST /channels/:channel/messages — publish
        if (
          req.method === "POST" &&
          parts[0] === "channels" &&
          parts.length >= 3 &&
          parts[parts.length - 1] === "messages"
        ) {
          const channel = parts.slice(1, -1).join("/");
          return relay.handleHttpPublish(req, channel);
        }

        // PATCH /channels/:channel/messages/:id — ack
        if (
          req.method === "PATCH" &&
          parts[0] === "channels" &&
          parts.length >= 4 &&
          parts[parts.length - 2] === "messages"
        ) {
          const channel = parts.slice(1, -2).join("/");
          const messageId = parts[parts.length - 1];
          return relay.handleHttpAck(channel, messageId);
        }

        // GET /channels/:channel/messages — read
        if (
          req.method === "GET" &&
          parts[0] === "channels" &&
          parts.length >= 3 &&
          parts[parts.length - 1] === "messages"
        ) {
          const channel = parts.slice(1, -1).join("/");
          return relay.handleHttpRead(req, channel);
        }

        return new Response("Not Found", { status: 404 });
      },
    });
  }

  private handleSse(channel: string): Response {
    const relay = this;
    const encoder = new TextEncoder();
    const sub: Subscriber = {
      id: ++relay.nextSubId,
      write(_data: string) {
        // Will be replaced once the stream controller is available
      },
    };

    const stream = new ReadableStream({
      start(controller) {
        sub.write = (data: string) => {
          // SSE format: data: <json>\n\n
          const lines = data.trim().split("\n");
          for (const line of lines) {
            controller.enqueue(encoder.encode(`data: ${line}\n\n`));
          }
        };
        relay.addSubscriber(channel, sub);
        relay.log(`sse client connected (id=${sub.id}) [${channel}]`);
      },
      cancel() {
        relay.removeSubscriber(channel, sub);
        relay.log(`sse client disconnected (id=${sub.id}) [${channel}]`);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  private async handleHttpPublish(
    req: Request,
    channel: string,
  ): Promise<Response> {
    let body;
    try {
      body = await req.json();
    } catch {
      return this.corsJson({ error: "Invalid JSON" }, 400);
    }
    // URL is authoritative for channel
    const msg: ChannelMessage = { ...body, channel };
    this.store.publish(msg);
    const fanCount = this.fanOut(channel, msg);
    this.log(
      `http publish [${channel}] from=${msg.from} type=${msg.type} fanout=${fanCount}`,
    );
    return this.corsJson({ ok: true, id: msg.id });
  }

  private handleHttpRead(req: Request, channel: string): Response {
    const url = new URL(req.url);
    const opts: Partial<{ since: number; unacked: boolean; type: string }> = {};
    if (url.searchParams.has("since"))
      opts.since = Number(url.searchParams.get("since"));
    if (url.searchParams.has("unacked"))
      opts.unacked = url.searchParams.get("unacked") === "true";
    if (url.searchParams.has("type")) opts.type = url.searchParams.get("type")!;
    const msgs = this.store.read(channel, opts);
    this.log(`http read [${channel}] results=${msgs.length}`);
    return this.corsJson(msgs);
  }

  private handleHttpAck(channel: string, messageId: string): Response {
    const result = this.store.ack(channel, messageId);
    this.log(
      `http ack [${channel}] id=${messageId} count=${result.ackedCount}`,
    );
    return this.corsJson(result);
  }

  // ─── NDJSON request handler (used by UDS) ─────────────────────────────

  private handleNdjsonRequest(sub: Subscriber, req: any): void {
    switch (req.action) {
      case "publish": {
        this.store.publish(req.msg);
        const fanCount = this.fanOut(req.channel, req.msg, sub.id);
        this.log(
          `publish [${req.channel}] from=${req.msg.from} type=${req.msg.type} fanout=${fanCount}`,
        );
        break;
      }

      case "subscribe": {
        this.addSubscriber(req.channel, sub);
        break;
      }

      case "unsubscribe": {
        this.removeSubscriber(req.channel, sub);
        break;
      }

      case "read": {
        const msgs = this.store.read(req.channel, req.opts);
        this.log(`read [${req.channel}] results=${msgs.length}`);
        sub.write(
          JSON.stringify({ type: "response", reqId: req.reqId, data: msgs }) +
            "\n",
        );
        break;
      }

      case "ack": {
        const result = this.store.ack(req.channel, req.messageId);
        sub.write(
          JSON.stringify({
            type: "response",
            reqId: req.reqId,
            data: result,
          }) + "\n",
        );
        break;
      }

      case "list": {
        const channels = this.store.list();
        sub.write(
          JSON.stringify({
            type: "response",
            reqId: req.reqId,
            data: channels,
          }) + "\n",
        );
        break;
      }
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  stop(): void {
    this.udsServer?.stop(true);
    this.udsServer = null;
    this.httpServer?.stop(true);
    this.httpServer = null;
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      /* already gone */
    }
  }
}
