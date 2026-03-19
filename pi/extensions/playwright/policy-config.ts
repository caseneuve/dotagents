import { POLICY_ACTIONS, POLICY_DEFAULT_ALLOWED_RULE } from "./constants";

export type PolicyAction = (typeof POLICY_ACTIONS)[keyof typeof POLICY_ACTIONS];

export type UrlPolicyConfig = {
  defaultAction: PolicyAction;
  allow: string[];
  deny: string[];
};

export const DEFAULT_POLICY_CONFIG: UrlPolicyConfig = {
  defaultAction: POLICY_ACTIONS.deny,
  allow: [POLICY_DEFAULT_ALLOWED_RULE],
  deny: [],
};

export function clonePolicyConfig(config: UrlPolicyConfig): UrlPolicyConfig {
  return {
    defaultAction: config.defaultAction,
    allow: [...config.allow],
    deny: [...config.deny],
  };
}

export function normalizeRule(rule: string): string {
  return rule.trim();
}

export function addRule(rules: string[], rule: string): string[] {
  const normalized = normalizeRule(rule);
  if (!normalized) {
    return rules;
  }
  if (rules.includes(normalized)) {
    return rules;
  }
  return [...rules, normalized];
}

export function removeRule(rules: string[], rule: string): string[] {
  return rules.filter((item) => item !== rule);
}

function isValidAction(value: unknown): value is PolicyAction {
  return value === POLICY_ACTIONS.allow || value === POLICY_ACTIONS.deny;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map(normalizeRule)
    .filter(Boolean);
}

export function coercePolicyConfig(value: unknown): UrlPolicyConfig {
  if (!value || typeof value !== "object") {
    return clonePolicyConfig(DEFAULT_POLICY_CONFIG);
  }

  const raw = value as Partial<UrlPolicyConfig>;
  const defaultAction = isValidAction(raw.defaultAction)
    ? raw.defaultAction
    : DEFAULT_POLICY_CONFIG.defaultAction;

  const allow = toStringArray(raw.allow);
  const deny = toStringArray(raw.deny);

  return {
    defaultAction,
    allow:
      allow.length > 0
        ? Array.from(new Set(allow))
        : [...DEFAULT_POLICY_CONFIG.allow],
    deny: Array.from(new Set(deny)),
  };
}

export function summarizePolicy(config: UrlPolicyConfig): string {
  return `default=${config.defaultAction} allow=${config.allow.length} deny=${config.deny.length}`;
}
