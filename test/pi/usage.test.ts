import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { promises as fs } from "node:fs";

import * as usage from "../../pi/extensions/usage";

const FETCHED_AT = 1_788_685_700_000;
const responseFixture = {
  user_id: "test-user",
  account_id: "test-account",
  email: "test@example.invalid",
  plan_type: "pro",
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 20,
      limit_window_seconds: 18_000,
      reset_after_seconds: 3_600,
      reset_at: 1_788_689_300,
    },
    secondary_window: {
      used_percent: 89,
      limit_window_seconds: 604_800,
      reset_after_seconds: 63_000,
      reset_at: 1_788_748_700,
    },
  },
  code_review_rate_limit: null,
  additional_rate_limits: [],
  credits: {
    has_credits: false,
    unlimited: false,
    balance: "0",
    approx_local_messages: [0, 0] as [number, number],
    approx_cloud_messages: [0, 0] as [number, number],
  },
  promo: null,
};

function snapshot(resetCredits: unknown) {
  return usage.normalizeChatGptSnapshot(
    {
      ...responseFixture,
      rate_limit_reset_credits: resetCredits,
    } as Parameters<typeof usage.normalizeChatGptSnapshot>[0],
    FETCHED_AT,
  );
}

function resetCard(resetCredits: unknown) {
  return snapshot(resetCredits).cards.find(
    (card) => card.title === "Usage limit resets",
  );
}

afterEach(() => mock.restore());

describe("/usage reset credits", () => {
  test("the registered command renders and refreshes reset counts using only GET requests", async () => {
    let available = 3;
    const requests: Array<{ url: string; method: string }> = [];
    spyOn(fs, "readFile").mockImplementation(async (file) => {
      if (String(file).endsWith("/.codex/auth.json")) {
        return JSON.stringify({ tokens: { access_token: "test-codex-token" } });
      }
      if (String(file).endsWith("/.pi/agent/auth.json")) {
        return JSON.stringify({ openrouter: { key: "test-openrouter-key" } });
      }
      throw new Error(`Unexpected file read: ${file}`);
    });
    spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? "GET" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url === "https://chatgpt.com/backend-api/wham/usage") {
        return Response.json({
          ...responseFixture,
          rate_limit_reset_credits: {
            available_count: available,
            applicable_available_count: 0,
          },
        });
      }
      if (url === "https://openrouter.ai/api/v1/key") {
        return Response.json({ data: { usage_daily: 0, is_free_tier: false } });
      }
      if (url === "https://openrouter.ai/api/v1/credits") {
        return Response.json({ data: { total_credits: 10, total_usage: 2 } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    usage.default({
      registerCommand(name, command) {
        expect(name).toBe("usage");
        handler = command.handler;
      },
    } as ExtensionAPI);

    let component!: Component;
    let ready!: () => void;
    const nextReadyRender = () =>
      new Promise<void>((resolve) => {
        ready = resolve;
      });
    const theme = {
      fg: (_tone: string, text: string) => text,
      bold: (text: string) => text,
    } as Theme;
    let closed = false;
    await handler("", {
      hasUI: true,
      model: { provider: "openai-codex", id: "gpt-5" },
      ui: {
        async custom(factory) {
          const loaded = nextReadyRender();
          component = factory(
            {
              requestRender() {
                if (component?.render(120).join("\n").includes("Fetched")) {
                  ready();
                }
              },
            },
            theme,
            undefined,
            () => {
              closed = true;
            },
          );
          await loaded;
        },
      },
    } as ExtensionCommandContext);

    for (const width of [80, 120]) {
      const lines = component.render(width);
      const text = lines.join("\n");
      expect(text).toContain("Usage limit resets");
      expect(text).toContain("3 available");
      expect(text).toContain("Currently applicable: 0");
      expect(text).toContain("Credits remaining");
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }

    available = 2;
    const refreshed = nextReadyRender();
    component.handleInput?.("r");
    await refreshed;
    expect(component.render(120).join("\n")).toContain("2 available");
    expect(component.render(120).join("\n")).not.toContain("3 available");
    expect(requests).toHaveLength(6);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(
      requests.filter((request) => request.url.includes("chatgpt.com")),
    ).toEqual([
      { url: "https://chatgpt.com/backend-api/wham/usage", method: "GET" },
      { url: "https://chatgpt.com/backend-api/wham/usage", method: "GET" },
    ]);
    component.handleInput?.("q");
    expect(closed).toBe(true);
  });
});

describe("normalizeChatGptSnapshot reset credits", () => {
  test("keeps total available separate from currently applicable", () => {
    expect(
      resetCard({ available_count: 3, applicable_available_count: 0 }),
    ).toEqual({
      title: "Usage limit resets",
      value: "3 available",
      subtitle: "Currently applicable: 0",
      tone: "accent",
    });
    expect(
      resetCard({ available_count: 3, applicable_available_count: 2 })
        ?.subtitle,
    ).toBe("Currently applicable: 2");
  });

  test("shows an explicit zero rather than hiding exhausted reset credits", () => {
    expect(
      resetCard({ available_count: 0, applicable_available_count: 0 }),
    ).toEqual({
      title: "Usage limit resets",
      value: "0 available",
      subtitle: "Currently applicable: 0",
      tone: "muted",
    });
  });

  test.each([
    undefined,
    null,
    -1,
    1.5,
    "2",
    true,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    4,
  ])("does not invent applicability from invalid/missing %p", (applicable) => {
    const card = resetCard({
      available_count: 3,
      applicable_available_count: applicable,
    });
    expect(card?.value).toBe("3 available");
    expect(card?.subtitle).toBeUndefined();
  });

  test.each([
    undefined,
    null,
    {},
    3,
    [],
    { applicable_available_count: 3 },
    ...[
      null,
      -1,
      1.5,
      "3",
      true,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ].map((available_count) => ({ available_count })),
  ])(
    "omits missing or malformed reset credits %p without changing other cards",
    (credits) => {
      expect(resetCard(credits)).toBeUndefined();
      expect(snapshot(credits).cards).toEqual(snapshot(undefined).cards);
    },
  );

  test("preserves existing cards and uses the supplied fetch timestamp", () => {
    const baseline = usage.normalizeChatGptSnapshot(
      responseFixture,
      FETCHED_AT,
    );
    const result = snapshot({ available_count: 3 });
    expect(baseline.cards.map((card) => card.title)).toEqual([
      "5 hour usage limit",
      "Weekly usage limit",
      "Credits remaining",
    ]);
    expect({
      ...result,
      cards: result.cards.filter((card) => card.title !== "Usage limit resets"),
    }).toEqual(baseline);
    expect(result.fetchedAt).toBe(FETCHED_AT);
  });
});
