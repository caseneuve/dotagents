import {
  DynamicBorder,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Container, matchesKey, Spacer, Text } from "@mariozechner/pi-tui";
import {
  COMMAND_NAMES,
  POLICY_FILE_RELATIVE_PATH,
  SETTINGS_ACTIONS,
} from "./constants";
import {
  addRule,
  clonePolicyConfig,
  isRuleFormatSupported,
  removeRule,
  summarizePolicy,
  type UrlPolicyConfig,
} from "./policy-config";
import { savePolicyConfig } from "./policy-storage";

type PolicyStateAccessor = {
  get(): UrlPolicyConfig;
  set(next: UrlPolicyConfig): void;
};

type ProtocolSelection = "http" | "https" | "both";

const PROTOCOL_OPTIONS: ProtocolSelection[] = ["http", "https", "both"];
const HTTP_PREFIX = "http://";
const HTTPS_PREFIX = "https://";

function formatRuleList(title: string, rules: string[]): string {
  if (rules.length === 0) {
    return `${title}: (none)`;
  }

  return `${title}:\n${rules.map((rule, index) => `  ${index + 1}. ${rule}`).join("\n")}`;
}

function createSettingsMenuSummary(config: UrlPolicyConfig): string {
  return [
    `Policy file: ${POLICY_FILE_RELATIVE_PATH}`,
    `Summary: ${summarizePolicy(config)}`,
  ].join("\n");
}

function stripLeadingHttpProtocols(raw: string): string {
  let value = raw.trim();
  while (/^https?:\/\//i.test(value)) {
    value = value.replace(/^https?:\/\//i, "");
  }
  return value.trim();
}

function hasExplicitHttpProtocol(rule: string): boolean {
  return /^https?:\/\//i.test(rule.trim());
}

function withProtocol(protocol: "http" | "https", domainPart: string): string {
  const prefix = protocol === "http" ? HTTP_PREFIX : HTTPS_PREFIX;
  return `${prefix}${stripLeadingHttpProtocols(domainPart)}`;
}

async function chooseAction(ctx: ExtensionContext, config: UrlPolicyConfig) {
  const choices = [
    SETTINGS_ACTIONS.showSummary,
    SETTINGS_ACTIONS.addAllowRule,
    SETTINGS_ACTIONS.addDenyRule,
    SETTINGS_ACTIONS.removeAllowRule,
    SETTINGS_ACTIONS.removeDenyRule,
    SETTINGS_ACTIONS.saveAndExit,
    SETTINGS_ACTIONS.exitWithoutSaving,
  ];

  const summary = createSettingsMenuSummary(config);
  ctx.ui.notify(summary, "info");
  return ctx.ui.select("Playwright settings", choices);
}

async function showSummary(ctx: ExtensionContext, config: UrlPolicyConfig) {
  const summary = [
    `Summary: ${summarizePolicy(config)}`,
    "",
    formatRuleList("Allow rules", config.allow),
    "",
    formatRuleList("Deny rules", config.deny),
    "",
    "Rule input supports either:",
    "- full URL pattern with protocol (example: https://*.example.com)",
    "- domain/path only (example: localhost:3000 or *.example.com/app)",
    "",
    "When you enter domain/path only, you'll choose protocol: http, https, or both.",
    "Deny rules take precedence over allow rules.",
  ].join("\n");

  await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
    container.addChild(
      new Text(
        theme.fg("accent", theme.bold("Playwright policy summary")),
        1,
        0,
      ),
    );
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("text", summary), 1, 0));
    container.addChild(new Spacer(1));
    container.addChild(
      new Text(theme.fg("dim", "Press Enter, q, or Esc to close"), 1, 0),
    );
    container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));

    return {
      render(width: number) {
        return container.render(width);
      },
      invalidate() {
        container.invalidate();
      },
      handleInput(data: string) {
        if (
          matchesKey(data, "return") ||
          matchesKey(data, "escape") ||
          data.toLowerCase() === "q"
        ) {
          done();
          return;
        }
      },
    };
  });
}

async function promptRuleInput(
  ctx: ExtensionContext,
  typeLabel: "allow" | "deny",
): Promise<string | undefined> {
  return ctx.ui.input(
    `Add ${typeLabel} rule`,
    "localhost:3000 or https://*.example.com",
    {
      timeout: 120_000,
    },
  );
}

async function promptProtocolSelection(
  ctx: ExtensionContext,
): Promise<ProtocolSelection | undefined> {
  return ctx.ui.select("Choose protocol(s)", PROTOCOL_OPTIONS);
}

async function buildRulesFromUserInput(
  ctx: ExtensionContext,
  rawInput: string,
): Promise<string[]> {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return [];
  }

  if (hasExplicitHttpProtocol(trimmed)) {
    const protocol = trimmed.toLowerCase().startsWith(HTTPS_PREFIX)
      ? "https"
      : "http";
    const sanitized = withProtocol(protocol, trimmed);
    return [sanitized];
  }

  if (isRuleFormatSupported(trimmed)) {
    return [trimmed];
  }

  const domainPart = stripLeadingHttpProtocols(trimmed);
  if (!domainPart) {
    return [];
  }

  const selection = await promptProtocolSelection(ctx);
  if (!selection) {
    return [];
  }

  if (selection === "http") {
    return [withProtocol("http", domainPart)];
  }

  if (selection === "https") {
    return [withProtocol("https", domainPart)];
  }

  return [withProtocol("http", domainPart), withProtocol("https", domainPart)];
}

async function promptRemoveRule(
  ctx: ExtensionContext,
  rules: string[],
  kind: "allow" | "deny",
): Promise<string | undefined> {
  if (rules.length === 0) {
    ctx.ui.notify(`No ${kind} rules to remove`, "warning");
    return undefined;
  }

  return ctx.ui.select(`Remove ${kind} rule`, rules);
}

function updateStatus(ctx: ExtensionContext, config: UrlPolicyConfig) {
  ctx.ui.setStatus(
    "playwright",
    `playwright policy: ${summarizePolicy(config)}`,
  );
}

export function registerPlaywrightSettingsCommand(
  pi: ExtensionAPI,
  policyState: PolicyStateAccessor,
) {
  pi.registerCommand(COMMAND_NAMES.settings, {
    description: "Manage Playwright URL allow/deny policy",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify(
          `/${COMMAND_NAMES.settings} requires interactive mode`,
          "error",
        );
        return;
      }

      let workingCopy = clonePolicyConfig(policyState.get());

      while (true) {
        const action = await chooseAction(ctx, workingCopy);
        if (!action || action === SETTINGS_ACTIONS.exitWithoutSaving) {
          ctx.ui.notify("Playwright settings closed without saving", "info");
          return;
        }

        if (action === SETTINGS_ACTIONS.showSummary) {
          await showSummary(ctx, workingCopy);
          continue;
        }

        if (action === SETTINGS_ACTIONS.addAllowRule) {
          const rawInput = await promptRuleInput(ctx, "allow");
          if (rawInput) {
            const rules = await buildRulesFromUserInput(ctx, rawInput);
            if (rules.length === 0) {
              continue;
            }

            let nextAllow = workingCopy.allow;
            for (const rule of rules) {
              if (!isRuleFormatSupported(rule)) {
                ctx.ui.notify(`Unsupported rule format: ${rule}`, "warning");
                continue;
              }
              nextAllow = addRule(nextAllow, rule);
            }

            workingCopy = {
              ...workingCopy,
              allow: nextAllow,
            };
            updateStatus(ctx, workingCopy);
            ctx.ui.notify(`Added allow rule(s): ${rules.join(", ")}`, "info");
          }
          continue;
        }

        if (action === SETTINGS_ACTIONS.addDenyRule) {
          const rawInput = await promptRuleInput(ctx, "deny");
          if (rawInput) {
            const rules = await buildRulesFromUserInput(ctx, rawInput);
            if (rules.length === 0) {
              continue;
            }

            let nextDeny = workingCopy.deny;
            for (const rule of rules) {
              if (!isRuleFormatSupported(rule)) {
                ctx.ui.notify(`Unsupported rule format: ${rule}`, "warning");
                continue;
              }
              nextDeny = addRule(nextDeny, rule);
            }

            workingCopy = {
              ...workingCopy,
              deny: nextDeny,
            };
            updateStatus(ctx, workingCopy);
            ctx.ui.notify(`Added deny rule(s): ${rules.join(", ")}`, "info");
          }
          continue;
        }

        if (action === SETTINGS_ACTIONS.removeAllowRule) {
          const selected = await promptRemoveRule(
            ctx,
            workingCopy.allow,
            "allow",
          );
          if (selected) {
            workingCopy = {
              ...workingCopy,
              allow: removeRule(workingCopy.allow, selected),
            };
            updateStatus(ctx, workingCopy);
          }
          continue;
        }

        if (action === SETTINGS_ACTIONS.removeDenyRule) {
          const selected = await promptRemoveRule(
            ctx,
            workingCopy.deny,
            "deny",
          );
          if (selected) {
            workingCopy = {
              ...workingCopy,
              deny: removeRule(workingCopy.deny, selected),
            };
            updateStatus(ctx, workingCopy);
          }
          continue;
        }

        if (action === SETTINGS_ACTIONS.saveAndExit) {
          const savedPath = await savePolicyConfig(ctx.cwd, workingCopy);
          policyState.set(clonePolicyConfig(workingCopy));
          updateStatus(ctx, workingCopy);
          ctx.ui.notify(`Saved Playwright policy: ${savedPath}`, "info");
          return;
        }
      }
    },
  });
}
