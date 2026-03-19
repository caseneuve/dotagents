import { DEV_ALLOWED_ORIGIN, INTERNAL_ALLOWED_PROTOCOLS } from "./constants";

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

function isAllowedHttpOrigin(url: URL): boolean {
  return url.origin === DEV_ALLOWED_ORIGIN;
}

export function decideNavigationAccess(rawUrl: string): UrlAccessDecision {
  const url = parseUrl(rawUrl);
  if (!url) {
    return {
      allowed: false,
      reason: `Invalid URL: ${rawUrl}`,
    };
  }

  if (isAllowedHttpOrigin(url)) {
    return {
      allowed: true,
      reason: "Allowed dev origin",
      normalizedUrl: url.toString(),
    };
  }

  return {
    allowed: false,
    reason: `Blocked by policy: only ${DEV_ALLOWED_ORIGIN} is allowed during development`,
    normalizedUrl: url.toString(),
  };
}

export function decideRequestAccess(rawUrl: string): UrlAccessDecision {
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

  return decideNavigationAccess(url.toString());
}
