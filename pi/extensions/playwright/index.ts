import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  COMMAND_NAMES,
  EXTENSION_NAME,
  POLICY_FILE_RELATIVE_PATH,
  TOOL_NAMES,
} from "./constants";
import {
  clonePolicyConfig,
  DEFAULT_POLICY_CONFIG,
  summarizePolicy,
  type UrlPolicyConfig,
} from "./policy-config";
import { loadPolicyConfig } from "./policy-storage";
import { PlaywrightPolicyBlockedError, PlaywrightSession } from "./session";
import { registerPlaywrightSettingsCommand } from "./settings-command";

function asPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatPolicyBlockedText(details: {
  requestedUrl: string;
  reason: string;
}): string {
  return [
    `Policy blocked navigation to ${details.requestedUrl}`,
    `Reason: ${details.reason}`,
    `This is non-retryable for the same URL until policy changes.`,
    `Next step: update /${COMMAND_NAMES.settings} (stored in ${POLICY_FILE_RELATIVE_PATH}) or use an already allowed URL.`,
  ].join("\n");
}

export default function (pi: ExtensionAPI) {
  let policyConfig: UrlPolicyConfig = clonePolicyConfig(DEFAULT_POLICY_CONFIG);

  const session = new PlaywrightSession(() => policyConfig);

  registerPlaywrightSettingsCommand(pi, {
    get: () => clonePolicyConfig(policyConfig),
    set: (next) => {
      policyConfig = clonePolicyConfig(next);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      policyConfig = await loadPolicyConfig(ctx.cwd);
      ctx.ui.setStatus(
        EXTENSION_NAME,
        `playwright policy: ${summarizePolicy(policyConfig)}`,
      );
    } catch (error) {
      policyConfig = clonePolicyConfig(DEFAULT_POLICY_CONFIG);
      ctx.ui.setStatus(
        EXTENSION_NAME,
        `playwright policy: ${summarizePolicy(policyConfig)} (fallback)`,
      );
      ctx.ui.notify(
        `Failed to load /${COMMAND_NAMES.settings} policy file: ${String(error)}`,
        "warning",
      );
    }
  });

  pi.on("session_shutdown", async () => {
    await session.dispose();
  });

  pi.registerTool({
    name: TOOL_NAMES.open,
    label: "Playwright Open",
    description: "Open a URL in the Playwright browser session.",
    promptSnippet: "Open an allowed URL in a browser session",
    promptGuidelines: [
      "If this tool returns policyBlocked=true, do not retry the same URL.",
      "When blocked by policy, ask the user to update /playwright-settings or provide an already allowed URL.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "Absolute URL to open" }),
    }),
    async execute(_toolCallId, params) {
      try {
        const result = await session.open(params.url);
        return {
          content: [{ type: "text", text: `Opened ${result.finalUrl}` }],
          details: result,
        };
      } catch (error) {
        if (error instanceof PlaywrightPolicyBlockedError) {
          const result = {
            ok: false,
            nonRetryable: true as const,
            policyBlocked: true as const,
            requestedUrl: error.details.requestedUrl,
            reason: error.message,
            normalizedUrl: error.details.decision.normalizedUrl,
            allowRules: error.details.allowRules,
            denyRules: error.details.denyRules,
            nextStep: `Run /${COMMAND_NAMES.settings} to adjust allow/deny rules, then retry.`,
          };

          const message = [
            formatPolicyBlockedText({
              requestedUrl: result.requestedUrl,
              reason: result.reason,
            }),
            "",
            `NON_RETRYABLE_POLICY_BLOCK ${JSON.stringify(result)}`,
          ].join("\n");

          throw new Error(message);
        }

        throw error;
      }
    },
  });

  pi.registerTool({
    name: TOOL_NAMES.query,
    label: "Playwright Query",
    description: "Query DOM elements by CSS selector.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector" }),
      all: Type.Optional(Type.Boolean({ description: "Return all matches" })),
      attrs: Type.Optional(
        Type.Array(Type.String(), {
          description: "Attributes to read from matched elements",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const result = await session.query(params);
      return {
        content: [{ type: "text", text: asPrettyJson(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: TOOL_NAMES.computedStyle,
    label: "Playwright Computed Style",
    description: "Read computed CSS properties for a selector.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector" }),
      props: Type.Array(Type.String(), {
        description: "CSS properties (for example: opacity, display)",
      }),
    }),
    async execute(_toolCallId, params) {
      const result = await session.computedStyle(params);
      return {
        content: [{ type: "text", text: asPrettyJson(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: TOOL_NAMES.hover,
    label: "Playwright Hover",
    description: "Hover over the first element matching a selector.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector" }),
    }),
    async execute(_toolCallId, params) {
      await session.hover(params.selector);
      const result = { ok: true, selector: params.selector };
      return {
        content: [{ type: "text", text: asPrettyJson(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: TOOL_NAMES.click,
    label: "Playwright Click",
    description: "Click the first element matching a selector.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector" }),
    }),
    async execute(_toolCallId, params) {
      await session.click(params.selector);
      const result = { ok: true, selector: params.selector };
      return {
        content: [{ type: "text", text: asPrettyJson(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: TOOL_NAMES.scrollTo,
    label: "Playwright Scroll To",
    description: "Scroll the first matching element into view.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector" }),
    }),
    async execute(_toolCallId, params) {
      await session.scrollTo(params.selector);
      const result = { ok: true, selector: params.selector };
      return {
        content: [{ type: "text", text: asPrettyJson(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: TOOL_NAMES.navigateHash,
    label: "Playwright Navigate Hash",
    description: "Update location hash on the active page.",
    parameters: Type.Object({
      hash: Type.String({ description: "Hash value, with or without #" }),
    }),
    async execute(_toolCallId, params) {
      const url = await session.navigateHash(params.hash);
      const result = { ok: true, hash: params.hash, url };
      return {
        content: [{ type: "text", text: asPrettyJson(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: TOOL_NAMES.screenshot,
    label: "Playwright Screenshot",
    description: "Capture a screenshot of viewport or selector.",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "CSS selector" })),
      fullPage: Type.Optional(
        Type.Boolean({
          description: "Capture full page when selector is omitted",
        }),
      ),
      path: Type.Optional(
        Type.String({ description: "Screenshot output path" }),
      ),
    }),
    async execute(_toolCallId, params) {
      const result = await session.screenshot(params);
      return {
        content: [{ type: "text", text: `Screenshot saved to ${result.path}` }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: TOOL_NAMES.waitFor,
    label: "Playwright Wait For",
    description:
      "Wait for a selector, network idle, or timeout. If selector is set it takes precedence.",
    parameters: Type.Object({
      selector: Type.Optional(
        Type.String({ description: "Wait for this selector" }),
      ),
      networkIdle: Type.Optional(
        Type.Boolean({
          description: "Wait for Playwright networkidle load state",
        }),
      ),
      timeoutMs: Type.Optional(
        Type.Number({ description: "Custom timeout in milliseconds" }),
      ),
    }),
    async execute(_toolCallId, params) {
      const result = await session.waitFor(params);
      return {
        content: [{ type: "text", text: asPrettyJson(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: TOOL_NAMES.consoleErrors,
    label: "Playwright Console Errors",
    description: "Return captured page console errors and pageerror events.",
    parameters: Type.Object({}),
    async execute() {
      const result = session.getConsoleErrors();
      return {
        content: [{ type: "text", text: asPrettyJson(result) }],
        details: result,
      };
    },
  });
}
