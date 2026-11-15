import { INTERNAL_ALLOWED_PROTOCOLS } from "./constants";
import type { UrlPolicyConfig } from "./policy-config";

export type UrlAccessDecision = {
  allowed: boolean;
  reason: string;
  normalizedUrl?: string;
};

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = escapeRegExp(pattern).replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchRule(url: URL, rawRule: string): boolean {
  const rule = rawRule.trim();
  if (!rule) {
    return false;
  }

  if (rule.includes("*")) {
    const regex = wildcardToRegExp(rule);
    return regex.test(url.toString()) || regex.test(url.origin);
  }

  return url.toString() === rule || url.origin === rule;
}

function matchesAnyRule(url: URL, rules: string[]): boolean {
  return rules.some((rule) => matchRule(url, rule));
}

export function decideNavigationAccess(
  rawUrl: string,
  config: UrlPolicyConfig,
): UrlAccessDecision {
  const url = parseUrl(rawUrl);
  if (!url) {
    return {
      allowed: false,
      reason: `Invalid URL: ${rawUrl}`,
    };
  }

  if (matchesAnyRule(url, config.deny)) {
    return {
      allowed: false,
      reason: "Blocked by deny policy rule",
      normalizedUrl: url.toString(),
    };
  }

  if (matchesAnyRule(url, config.allow)) {
    return {
      allowed: true,
      reason: "Allowed by allow policy rule",
      normalizedUrl: url.toString(),
    };
  }

  return {
    allowed: false,
    reason: "Blocked by default policy (allowlist-only)",
    normalizedUrl: url.toString(),
  };
}

export function decideRequestAccess(
  rawUrl: string,
  config: UrlPolicyConfig,
): UrlAccessDecision {
  const url = parseUrl(rawUrl);
  if (!url) {
    return {
      allowed: false,
      reason: `Invalid request URL: ${rawUrl}`,
    };
  }

  if (INTERNAL_ALLOWED_PROTOCOLS.has(url.protocol)) {
    return {
      allowed: true,
      reason: `Allowed internal protocol ${url.protocol}`,
      normalizedUrl: url.toString(),
    };
  }

  return decideNavigationAccess(url.toString(), config);
}
