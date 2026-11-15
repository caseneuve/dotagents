import { POLICY_DEFAULT_ALLOWED_RULE } from "./constants";

export type UrlPolicyConfig = {
  allow: string[];
  deny: string[];
};

export const DEFAULT_POLICY_CONFIG: UrlPolicyConfig = {
  allow: [POLICY_DEFAULT_ALLOWED_RULE],
  deny: [],
};

export function clonePolicyConfig(config: UrlPolicyConfig): UrlPolicyConfig {
  return {
    allow: [...config.allow],
    deny: [...config.deny],
  };
}

export function normalizeRule(rule: string): string {
  return rule.trim();
}

const SCHEME_WITH_SLASHES_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const SCHEME_ONLY_REGEX = /^(about|data|blob):/;

export function isRuleFormatSupported(rule: string): boolean {
  const normalized = normalizeRule(rule);
  if (!normalized) {
    return false;
  }

  return (
    SCHEME_WITH_SLASHES_REGEX.test(normalized) ||
    SCHEME_ONLY_REGEX.test(normalized)
  );
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
  const allow = toStringArray(raw.allow);
  const deny = toStringArray(raw.deny);

  return {
    allow:
      allow.length > 0
        ? Array.from(new Set(allow))
        : [...DEFAULT_POLICY_CONFIG.allow],
    deny: Array.from(new Set(deny)),
  };
}

export function summarizePolicy(config: UrlPolicyConfig): string {
  return `allow=${config.allow.length} deny=${config.deny.length}`;
}
