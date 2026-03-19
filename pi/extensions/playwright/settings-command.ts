import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  COMMAND_NAMES,
  POLICY_ACTIONS,
  POLICY_FILE_RELATIVE_PATH,
  SETTINGS_ACTIONS,
} from "./constants";
import {
  addRule,
  clonePolicyConfig,
  removeRule,
  summarizePolicy,
  type PolicyAction,
  type UrlPolicyConfig,
} from "./policy-config";
import { savePolicyConfig } from "./policy-storage";

type PolicyStateAccessor = {
  get(): UrlPolicyConfig;
  set(next: UrlPolicyConfig): void;
};

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

async function chooseAction(ctx: ExtensionContext, config: UrlPolicyConfig) {
  const choices = [
    SETTINGS_ACTIONS.showSummary,
    SETTINGS_ACTIONS.addAllowRule,
    SETTINGS_ACTIONS.addDenyRule,
    SETTINGS_ACTIONS.removeAllowRule,
    SETTINGS_ACTIONS.removeDenyRule,
    SETTINGS_ACTIONS.setDefaultAction,
    SETTINGS_ACTIONS.saveAndExit,
    SETTINGS_ACTIONS.exitWithoutSaving,
  ];

  const summary = createSettingsMenuSummary(config);
  ctx.ui.notify(summary, "info");
  return ctx.ui.select("Playwright settings", choices);
}

async function promptAddRule(
  ctx: ExtensionContext,
  typeLabel: "allow" | "deny",
): Promise<string | undefined> {
  return ctx.ui.input(
    `Add ${typeLabel} rule`,
    "https://example.com or https://*.example.com",
    {
      timeout: 120_000,
    },
  );
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

async function promptDefaultAction(
  ctx: ExtensionContext,
): Promise<PolicyAction | undefined> {
  return ctx.ui.select("Set default action", [
    POLICY_ACTIONS.deny,
    POLICY_ACTIONS.allow,
  ]);
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
          const summary = [
            summarizePolicy(workingCopy),
            "",
            formatRuleList("Allow rules", workingCopy.allow),
            "",
            formatRuleList("Deny rules", workingCopy.deny),
          ].join("\n");
          ctx.ui.notify(summary, "info");
          continue;
        }

        if (action === SETTINGS_ACTIONS.addAllowRule) {
          const rule = await promptAddRule(ctx, "allow");
          if (rule) {
            workingCopy = {
              ...workingCopy,
              allow: addRule(workingCopy.allow, rule),
            };
            updateStatus(ctx, workingCopy);
          }
          continue;
        }

        if (action === SETTINGS_ACTIONS.addDenyRule) {
          const rule = await promptAddRule(ctx, "deny");
          if (rule) {
            workingCopy = {
              ...workingCopy,
              deny: addRule(workingCopy.deny, rule),
            };
            updateStatus(ctx, workingCopy);
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

        if (action === SETTINGS_ACTIONS.setDefaultAction) {
          const defaultAction = await promptDefaultAction(ctx);
          if (defaultAction) {
            workingCopy = {
              ...workingCopy,
              defaultAction,
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
