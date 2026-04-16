// ─── HttpTransport: REST + SSE for cross-machine communication ──────────
// Publish/read/ack via fetch(). Subscribe via SSE using node:http
// (Bun's fetch doesn't stream incrementally). Works in both Node and Bun.
import * as http from "node:http";
import type { ChannelMessage, FilterOpts } from "./core";
import type { MessageTransport } from "./interfaces";

export class HttpTransport implements MessageTransport {
  readonly name = "http";
  private baseUrl: string;
  private sseConnections: Map<
    string,
    { req: http.ClientRequest; callback: (msgs: ChannelMessage[]) => void }
  > = new Map();

  constructor(baseUrl: string) {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private channelUrl(channel: string): string {
    // Channel slashes become URL path segments — don't encode them
    const encoded = channel
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/");
    return `${this.baseUrl}/channels/${encoded}`;
  }

  async publish(msg: ChannelMessage): Promise<void> {
    const res = await fetch(`${this.channelUrl(msg.channel)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg),
    });
    if (!res.ok) {
      throw new Error(`publish failed: ${res.status} ${await res.text()}`);
    }
  }

  async read(channel: string, opts?: FilterOpts): Promise<ChannelMessage[]> {
    const params = new URLSearchParams();
    if (opts?.since) params.set("since", String(opts.since));
    if (opts?.unacked) params.set("unacked", "true");
    if (opts?.type) params.set("type", opts.type);
    const query = params.toString();
    const url = `${this.channelUrl(channel)}/messages${query ? `?${query}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`read failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async ack(
    channel: string,
    messageId: string,
  ): Promise<{ ackedCount: number }> {
    const res = await fetch(
      `${this.channelUrl(channel)}/messages/${encodeURIComponent(messageId)}`,
      { method: "PATCH" },
    );
    if (!res.ok) {
      throw new Error(`ack failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  subscribe(channel: string, callback: (msgs: ChannelMessage[]) => void): void {
    // Clean up existing subscription
    this.unsubscribe(channel);

    const url = `${this.channelUrl(channel)}/stream`;
    let buffer = "";

    const req = http.get(url, (res) => {
      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        // SSE format: "data: <json>\n\n"
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          // Strip "data: " prefix
          const jsonStr = trimmed.replace(/^data:\s*/, "");
          try {
            const frame = JSON.parse(jsonStr);
            if (frame.type === "message" && frame.msg) {
              callback([frame.msg]);
            }
          } catch {
            // Ignore malformed SSE events
          }
        }
      });
    });

    req.on("error", (err) => {
      console.error(
        `[http-transport] SSE error on [${channel}]: ${err.message}`,
      );
    });

    this.sseConnections.set(channel, { req, callback });
  }

  unsubscribe(channel: string): void {
    const conn = this.sseConnections.get(channel);
    if (conn) {
      conn.req.destroy();
      this.sseConnections.delete(channel);
    }
  }

  unsubscribeAll(): void {
    for (const [ch] of this.sseConnections) {
      this.unsubscribe(ch);
    }
  }
}
