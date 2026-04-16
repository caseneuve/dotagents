import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { RelayServer } from "../../../shared/relay/server";
import { UdsTransport, createTransport, FileTransport } from "./transports";
import type { ChannelMessage } from "./core";

function tmpSocket(): string {
  return path.join(os.tmpdir(), `agent-test-${Date.now()}.sock`);
}

function msg(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    channel: "test/ch",
    from: "agent-a",
    type: "status",
    body: "hello",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("UdsTransport + RelayServer", () => {
  let socketPath: string;
  let server: RelayServer;
  let transport: UdsTransport;

  beforeEach(() => {
    socketPath = tmpSocket();
    server = new RelayServer({ socketPath });
    server.start();
    transport = new UdsTransport(socketPath);
  });

  afterEach(() => {
    transport.unsubscribeAll();
    server.stop();
  });

  // ── publish + read ──

  test("publish then read returns message", async () => {
    const m = msg({ channel: "test/rw" });
    await transport.publish(m);

    // Small delay for server to process
    await new Promise((r) => setTimeout(r, 50));

    const msgs = await transport.read("test/rw");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe(m.id);
    expect(msgs[0].body).toBe("hello");
  });

  test("read with filters", async () => {
    await transport.publish(msg({ channel: "test/f", type: "status" }));
    await transport.publish(msg({ channel: "test/f", type: "review" }));
    await new Promise((r) => setTimeout(r, 50));

    const msgs = await transport.read("test/f", { type: "review" });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe("review");
  });

  test("read empty channel", async () => {
    const msgs = await transport.read("nonexistent");
    expect(msgs).toEqual([]);
  });

  // ── ack ──

  test("ack marks message", async () => {
    const m = msg({ channel: "test/ack" });
    await transport.publish(m);
    await new Promise((r) => setTimeout(r, 50));

    const result = await transport.ack("test/ack", m.id);
    expect(result.ackedCount).toBe(1);

    const unacked = await transport.read("test/ack", { unacked: true });
    expect(unacked).toHaveLength(0);
  });

  // ── subscribe (push delivery) ──

  test("subscribe receives pushed messages", async () => {
    const received: ChannelMessage[] = [];
    transport.subscribe("test/push", (msgs) => received.push(...msgs));

    // Wait for subscription to register
    await new Promise((r) => setTimeout(r, 100));

    // Publish via a second transport (simulates another agent)
    const t2 = new UdsTransport(socketPath);
    await t2.publish(msg({ channel: "test/push", body: "from-t2" }));

    // Wait for push delivery
    await new Promise((r) => setTimeout(r, 100));

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].body).toBe("from-t2");

    t2.unsubscribeAll();
  });

  test("unsubscribe stops delivery", async () => {
    const received: ChannelMessage[] = [];
    transport.subscribe("test/unsub", (msgs) => received.push(...msgs));
    await new Promise((r) => setTimeout(r, 50));

    transport.unsubscribe("test/unsub");
    await new Promise((r) => setTimeout(r, 50));

    // Publish after unsubscribe — should not arrive
    const t2 = new UdsTransport(socketPath);
    await t2.publish(msg({ channel: "test/unsub" }));
    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(0);
    t2.unsubscribeAll();
  });

  // ── name ──

  test("name is 'uds'", () => {
    expect(transport.name).toBe("uds");
  });

  // ── self-skip in fan-out ──

  test("publisher does not receive its own message via subscription", async () => {
    const received: ChannelMessage[] = [];
    transport.subscribe("test/self", (msgs) => received.push(...msgs));
    await new Promise((r) => setTimeout(r, 100));

    // Publish on the same transport that is subscribed
    await transport.publish(msg({ channel: "test/self", body: "self-msg" }));
    await new Promise((r) => setTimeout(r, 100));

    // Should NOT receive own message
    expect(received).toHaveLength(0);
  });

  // ── reconnect + re-subscribe ──

  test("re-subscribes after relay restart", async () => {
    const received: ChannelMessage[] = [];
    transport.subscribe("test/recon", (msgs) => received.push(...msgs));
    await new Promise((r) => setTimeout(r, 100));

    // Restart the relay (simulates crash + recovery)
    server.stop();
    await new Promise((r) => setTimeout(r, 100));
    server = new RelayServer({ socketPath });
    server.start();

    // Give transport time to notice disconnect + reconnect on next operation
    await new Promise((r) => setTimeout(r, 100));

    // Publish from a second transport — should arrive via re-subscription
    const t2 = new UdsTransport(socketPath);
    await t2.publish(msg({ channel: "test/recon", body: "after-restart" }));
    await new Promise((r) => setTimeout(r, 200));

    // The first transport needs to reconnect — trigger via a read
    try {
      await transport.read("test/recon");
    } catch {
      // Connection may fail first time
    }
    await new Promise((r) => setTimeout(r, 100));

    // Now publish again — subscription should be re-registered
    await t2.publish(msg({ channel: "test/recon", body: "after-reconnect" }));
    await new Promise((r) => setTimeout(r, 200));

    const afterReconnect = received.filter((m) => m.body === "after-reconnect");
    expect(afterReconnect.length).toBeGreaterThanOrEqual(1);

    t2.unsubscribeAll();
  });
});

// ── Stale socket / createTransport fallback ────────────────────────────

describe("createTransport", () => {
  test("returns FileTransport when no socket exists", async () => {
    const prev = process.env.AGENT_UDS_SOCKET;
    process.env.AGENT_UDS_SOCKET = "/tmp/nonexistent-test.sock";
    try {
      const t = await createTransport();
      expect(t.name).toBe("file");
      expect(t).toBeInstanceOf(FileTransport);
    } finally {
      if (prev !== undefined) process.env.AGENT_UDS_SOCKET = prev;
      else delete process.env.AGENT_UDS_SOCKET;
    }
  });

  test("returns FileTransport when socket file exists but relay is down", async () => {
    // Create a stale socket file (not a real socket)
    const stalePath = path.join(os.tmpdir(), `stale-test-${Date.now()}.sock`);
    fs.writeFileSync(stalePath, "");
    const prev = process.env.AGENT_UDS_SOCKET;
    process.env.AGENT_UDS_SOCKET = stalePath;
    try {
      const t = await createTransport();
      expect(t.name).toBe("file");
    } finally {
      if (prev !== undefined) process.env.AGENT_UDS_SOCKET = prev;
      else delete process.env.AGENT_UDS_SOCKET;
      fs.unlinkSync(stalePath);
    }
  });

  test("returns UdsTransport when relay is running", async () => {
    const sockPath = path.join(os.tmpdir(), `probe-test-${Date.now()}.sock`);
    const srv = new RelayServer({ socketPath: sockPath });
    srv.start();
    const prev = process.env.AGENT_UDS_SOCKET;
    process.env.AGENT_UDS_SOCKET = sockPath;
    try {
      const t = await createTransport();
      expect(t.name).toBe("uds");
      expect(t).toBeInstanceOf(UdsTransport);
      t.unsubscribeAll();
    } finally {
      if (prev !== undefined) process.env.AGENT_UDS_SOCKET = prev;
      else delete process.env.AGENT_UDS_SOCKET;
      srv.stop();
    }
  });
});
