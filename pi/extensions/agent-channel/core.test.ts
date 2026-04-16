import { describe, test, expect } from "bun:test";
import {
  channelPath,
  filterMessages,
  ackMessages,
  shouldTriggerTurn,
  type ChannelMessage,
  type ChannelFile,
} from "./core";

// ─── Helpers ────────────────────────────────────────────────────────────

function msg(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: "m1",
    channel: "test/ch",
    from: "agent-a",
    type: "status",
    body: "hello",
    timestamp: 1000,
    ...overrides,
  };
}

function file(...msgs: ChannelMessage[]): ChannelFile {
  return { messages: msgs };
}

// ─── channelPath ────────────────────────────────────────────────────────

describe("channelPath", () => {
  test("simple name", () => {
    expect(channelPath("/tmp/ch", "my-channel")).toBe(
      "/tmp/ch/my-channel.json",
    );
  });

  test("replaces unsafe characters with underscores", () => {
    expect(channelPath("/tmp/ch", "project/review")).toBe(
      "/tmp/ch/project_review.json",
    );
  });

  test("preserves dots and hyphens", () => {
    expect(channelPath("/tmp/ch", "a.b-c")).toBe("/tmp/ch/a.b-c.json");
  });

  test("replaces spaces and special chars", () => {
    expect(channelPath("/tmp/ch", "my channel!@#")).toBe(
      "/tmp/ch/my_channel___.json",
    );
  });
});

// ─── filterMessages ─────────────────────────────────────────────────────

describe("filterMessages", () => {
  const m1 = msg({ id: "1", timestamp: 100, acked: false, type: "status" });
  const m2 = msg({ id: "2", timestamp: 200, acked: true, type: "review" });
  const m3 = msg({ id: "3", timestamp: 300, acked: false, type: "status" });
  const all = [m1, m2, m3];

  test("no opts returns all messages", () => {
    expect(filterMessages(all)).toEqual(all);
  });

  test("filters by since", () => {
    expect(filterMessages(all, { since: 150 })).toEqual([m2, m3]);
  });

  test("filters by unacked", () => {
    expect(filterMessages(all, { unacked: true })).toEqual([m1, m3]);
  });

  test("filters by type", () => {
    expect(filterMessages(all, { type: "review" })).toEqual([m2]);
  });

  test("combines since + unacked", () => {
    expect(filterMessages(all, { since: 150, unacked: true })).toEqual([m3]);
  });

  test("combines all filters", () => {
    expect(
      filterMessages(all, { since: 50, unacked: true, type: "status" }),
    ).toEqual([m1, m3]);
  });

  test("empty input returns empty", () => {
    expect(filterMessages([], { unacked: true })).toEqual([]);
  });
});

// ─── ackMessages ────────────────────────────────────────────────────────

describe("ackMessages", () => {
  test("ack all (*) marks all unacked messages", () => {
    const m1 = msg({ id: "1", acked: false });
    const m2 = msg({ id: "2", acked: true });
    const m3 = msg({ id: "3", acked: false });
    const input = file(m1, m2, m3);

    const result = ackMessages(input, "*");

    expect(result.ackedCount).toBe(2);
    expect(result.file.messages.every((m) => m.acked)).toBe(true);
  });

  test("ack last marks only the last unacked message", () => {
    const m1 = msg({ id: "1", acked: false });
    const m2 = msg({ id: "2", acked: false });
    const input = file(m1, m2);

    const result = ackMessages(input, "last");

    expect(result.ackedCount).toBe(1);
    expect(result.file.messages[0].acked).toBe(false);
    expect(result.file.messages[1].acked).toBe(true);
  });

  test("ack specific id marks that message", () => {
    const m1 = msg({ id: "abc", acked: false });
    const m2 = msg({ id: "def", acked: false });
    const input = file(m1, m2);

    const result = ackMessages(input, "abc");

    expect(result.ackedCount).toBe(1);
    expect(result.file.messages[0].acked).toBe(true);
    expect(result.file.messages[1].acked).toBe(false);
  });

  test("returns 0 when no messages match", () => {
    const input = file(msg({ id: "1", acked: true }));
    expect(ackMessages(input, "last").ackedCount).toBe(0);
    expect(ackMessages(input, "*").ackedCount).toBe(0);
    expect(ackMessages(input, "nonexistent").ackedCount).toBe(0);
  });

  test("does not mutate the original file", () => {
    const m1 = msg({ id: "1", acked: false });
    const input = file(m1);
    const originalAcked = input.messages[0].acked;

    ackMessages(input, "*");

    expect(input.messages[0].acked).toBe(originalAcked);
  });

  test("returns new ChannelFile object", () => {
    const input = file(msg({ id: "1", acked: false }));
    const result = ackMessages(input, "*");
    expect(result.file).not.toBe(input);
    expect(result.file.messages[0]).not.toBe(input.messages[0]);
  });

  test("empty file returns 0", () => {
    const result = ackMessages(file(), "*");
    expect(result.ackedCount).toBe(0);
    expect(result.file.messages).toEqual([]);
  });
});

// ─── shouldTriggerTurn ──────────────────────────────────────────────────

describe("shouldTriggerTurn", () => {
  test("presence messages never trigger", () => {
    expect(shouldTriggerTurn(msg({ type: "presence", body: "joined" }))).toBe(
      false,
    );
  });

  test("body ending with OUT does not trigger", () => {
    expect(shouldTriggerTurn(msg({ body: "Done. OUT" }))).toBe(false);
  });

  test("body ending with out (lowercase) does not trigger", () => {
    expect(shouldTriggerTurn(msg({ body: "Done. out" }))).toBe(false);
  });

  test("body ending with OUT and trailing whitespace does not trigger", () => {
    expect(shouldTriggerTurn(msg({ body: "Done. OUT  \n" }))).toBe(false);
  });

  test("body ending with OVER triggers", () => {
    expect(shouldTriggerTurn(msg({ body: "Your turn. OVER" }))).toBe(true);
  });

  test("body with no suffix triggers", () => {
    expect(shouldTriggerTurn(msg({ body: "Please review this" }))).toBe(true);
  });

  test("OUT in the middle does not suppress trigger", () => {
    expect(shouldTriggerTurn(msg({ body: "OUT of ideas, help me" }))).toBe(
      true,
    );
  });

  test("status type triggers", () => {
    expect(shouldTriggerTurn(msg({ type: "status", body: "working" }))).toBe(
      true,
    );
  });
});
