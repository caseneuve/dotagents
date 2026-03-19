import fs from "node:fs/promises";
import path from "node:path";
import { POLICY_FILE_RELATIVE_PATH } from "./constants";
import {
  clonePolicyConfig,
  coercePolicyConfig,
  DEFAULT_POLICY_CONFIG,
  type UrlPolicyConfig,
} from "./policy-config";

function getPolicyPath(cwd: string): string {
  return path.join(cwd, POLICY_FILE_RELATIVE_PATH);
}

export async function loadPolicyConfig(cwd: string): Promise<UrlPolicyConfig> {
  const policyPath = getPolicyPath(cwd);

  try {
    const raw = await fs.readFile(policyPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return coercePolicyConfig(parsed);
  } catch (error) {
    const notFound =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT";

    if (notFound) {
      return clonePolicyConfig(DEFAULT_POLICY_CONFIG);
    }

    throw error;
  }
}

export async function savePolicyConfig(
  cwd: string,
  config: UrlPolicyConfig,
): Promise<string> {
  const policyPath = getPolicyPath(cwd);
  await fs.mkdir(path.dirname(policyPath), { recursive: true });
  const normalized = coercePolicyConfig(config);
  await fs.writeFile(
    `${policyPath}`,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
  return policyPath;
}
