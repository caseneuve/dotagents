import { describe, test, expect } from "bun:test";
import {
  resolveIdentity,
  setLabel,
  identityToData,
  identityFromData,
  type AgentIdentity,
} from "./identity";

// ─── resolveIdentity ────────────────────────────────────────────────────

describe("resolveIdentity", () => {
  test("env takes highest priority", () => {
    expect(
      resolveIdentity({ id: "ab12", label: "reviewer", env: "agent-x" }),
    ).toBe("agent-x");
  });

  test("label takes priority over id", () => {
    expect(resolveIdentity({ id: "ab12", label: "reviewer" })).toBe("reviewer");
  });

  test("falls back to id", () => {
    expect(resolveIdentity({ id: "ab12" })).toBe("ab12");
  });

  test("env wins even when label is set", () => {
    expect(resolveIdentity({ id: "x", label: "y", env: "z" })).toBe("z");
  });

  test("undefined label is skipped", () => {
    expect(resolveIdentity({ id: "ab12", label: undefined })).toBe("ab12");
  });

  test("empty string env is falsy, skipped", () => {
    expect(resolveIdentity({ id: "ab12", env: "" })).toBe("ab12");
  });
});

// ─── setLabel ───────────────────────────────────────────────────────────

describe("setLabel", () => {
  test("returns new identity with label set", () => {
    const original: AgentIdentity = { id: "ab12" };
    const updated = setLabel(original, "reviewer");
    expect(updated.label).toBe("reviewer");
    expect(updated.id).toBe("ab12");
  });

  test("does not mutate original", () => {
    const original: AgentIdentity = { id: "ab12", label: "old" };
    setLabel(original, "new");
    expect(original.label).toBe("old");
  });

  test("overwrites existing label", () => {
    const result = setLabel({ id: "x", label: "old" }, "new");
    expect(result.label).toBe("new");
  });
});

// ─── identityToData / identityFromData roundtrip ────────────────────────

describe("identityToData", () => {
  test("serializes id and label", () => {
    expect(identityToData({ id: "ab12", label: "rev" })).toEqual({
      id: "ab12",
      label: "rev",
    });
  });

  test("omits env from serialization", () => {
    const data = identityToData({ id: "ab12", env: "agent-x" });
    expect(data).toEqual({ id: "ab12", label: undefined });
    expect("env" in data).toBe(false);
  });
});

describe("identityFromData", () => {
  test("restores from persisted data", () => {
    const identity = identityFromData({ id: "ab12", label: "rev" });
    expect(identity.id).toBe("ab12");
    expect(identity.label).toBe("rev");
    expect(identity.env).toBeUndefined();
  });

  test("injects env when provided", () => {
    const identity = identityFromData({ id: "ab12" }, "agent-x");
    expect(identity.env).toBe("agent-x");
  });

  test("generates id when missing from data", () => {
    const identity = identityFromData({});
    expect(identity.id).toBeTruthy();
    expect(identity.id.length).toBe(4);
  });
});
