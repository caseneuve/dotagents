#!/usr/bin/env node

/**
 * Standalone OpenRouter usage probe.
 *
 * Usage:
 *   OPENROUTER_MANAGEMENT_KEY=... node scripts/openrouter-usage-probe.mjs
 *   OPENROUTER_API_KEY=... node scripts/openrouter-usage-probe.mjs --range 7d
 *   node scripts/openrouter-usage-probe.mjs --range today --save
 *
 * Notes:
 * - Uses whichever token is present first:
 *   OPENROUTER_MANAGEMENT_KEY, OPENROUTER_API_KEY
 * - Fetches:
 *   1) /api/v1/key
 *   2) /api/v1/activity
 * - Prints lightweight shape info + optional saved raw JSON payloads.
 */

import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://openrouter.ai/api/v1";

function parseArgs(argv) {
  const args = {
    range: "current", // current | today | 7d | 30d
    save: false,
    outDir: "./tmp/openrouter-usage",
    maxRowsPreview: 5,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--save") {
      args.save = true;
    } else if (arg === "--range") {
      args.range = argv[i + 1] ?? args.range;
      i += 1;
    } else if (arg === "--out-dir") {
      args.outDir = argv[i + 1] ?? args.outDir;
      i += 1;
    } else if (arg === "--max-rows") {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.maxRowsPreview = Math.floor(parsed);
      }
      i += 1;
    } else if (arg === "-h" || arg === "--help") {
      console.log(`
OpenRouter usage probe

Options:
  --range <current|today|7d|30d>   Aggregate preview window (default: current)
  --save                           Save raw JSON payloads to disk
  --out-dir <path>                 Output directory for --save
  --max-rows <n>                   Number of activity rows to preview (default: 5)
  -h, --help                       Show this help
`);
      process.exit(0);
    }
  }

  return args;
}

function pickToken() {
  return (
    process.env.OPENROUTER_MANAGEMENT_KEY || process.env.OPENROUTER_API_KEY || ""
  );
}

async function fetchJson(endpoint, token, signal) {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal,
  });

  const text = await response.text();
  let json;
  try {
    json = text.length ? JSON.parse(text) : null;
  } catch {
    json = { parseError: true, raw: text };
  }

  return {
    url,
    status: response.status,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    body: json,
  };
}

function toTimestampRange(range) {
  const now = new Date();
  const end = now.getTime();

  if (range === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { startMs: start.getTime(), endMs: end };
  }

  const days = range === "7d" ? 7 : range === "30d" ? 30 : 0;
  if (days > 0) {
    const startMs = end - days * 24 * 60 * 60 * 1000;
    return { startMs, endMs: end };
  }

  return null;
}

function asMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  // Try to normalize seconds vs milliseconds.
  if (value > 1e12) return value; // already ms
  if (value > 1e9) return value * 1000; // seconds epoch
  return null;
}

function rowTimestampMs(row) {
  if (!row || typeof row !== "object") return null;

  // Try common timestamp field names.
  const candidates = [
    row.timestamp,
    row.created_at,
    row.createdAt,
    row.time,
    row.date,
  ];

  for (const c of candidates) {
    if (typeof c === "string") {
      const asDate = Date.parse(c);
      if (Number.isFinite(asDate)) return asDate;
    }
    const ms = asMs(c);
    if (ms) return ms;
  }

  return null;
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function aggregateActivity(rows, range) {
  const window = toTimestampRange(range);
  const filtered = window
    ? rows.filter((row) => {
        const ts = rowTimestampMs(row);
        return ts !== null && ts >= window.startMs && ts <= window.endMs;
      })
    : rows;

  const byModel = new Map();
  const byProvider = new Map();
  let totalCost = 0;

  for (const row of filtered) {
    const model = row?.model ?? row?.model_name ?? "unknown";
    const provider = row?.provider ?? row?.provider_name ?? "unknown";
    const cost =
      toNumber(row?.cost) ||
      toNumber(row?.usage?.cost?.total) ||
      toNumber(row?.total_cost);

    byModel.set(model, (byModel.get(model) ?? 0) + 1);
    byProvider.set(provider, (byProvider.get(provider) ?? 0) + 1);
    totalCost += cost;
  }

  const sortEntries = (map) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  return {
    range,
    totalRows: rows.length,
    filteredRows: filtered.length,
    approxTotalCost: totalCost,
    topModels: sortEntries(byModel),
    topProviders: sortEntries(byProvider),
  };
}

function printResponseShape(name, response, maxRowsPreview) {
  console.log(`\n=== ${name} ===`);
  console.log(`status: ${response.status} ${response.ok ? "OK" : "ERROR"}`);
  console.log(`url:    ${response.url}`);

  if (!response.ok) {
    console.log("body:", JSON.stringify(response.body, null, 2));
    return;
  }

  const body = response.body;
  const topKeys = body && typeof body === "object" ? Object.keys(body) : [];
  console.log("top-level keys:", topKeys);

  const data = body?.data;
  if (Array.isArray(data)) {
    console.log(`data: array(${data.length})`);
    if (data.length > 0) {
      const sample = data.slice(0, maxRowsPreview);
      console.log("sample row keys:", Object.keys(sample[0] ?? {}));
      console.log(
        `sample rows (first ${sample.length}):\n${JSON.stringify(sample, null, 2)}`,
      );
    }
  } else if (data && typeof data === "object") {
    console.log("data keys:", Object.keys(data));
    console.log("data preview:", JSON.stringify(data, null, 2));
  } else {
    console.log("body preview:", JSON.stringify(body, null, 2));
  }
}

async function saveJson(outDir, filename, value) {
  await fs.mkdir(outDir, { recursive: true });
  const full = path.join(outDir, filename);
  await fs.writeFile(full, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return full;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = pickToken();

  if (!token) {
    console.error(
      "Missing token. Set OPENROUTER_MANAGEMENT_KEY or OPENROUTER_API_KEY.",
    );
    process.exit(1);
  }

  const controller = new AbortController();

  const [keyRes, activityRes] = await Promise.all([
    fetchJson("/key", token, controller.signal),
    fetchJson("/activity", token, controller.signal),
  ]);

  printResponseShape("/key", keyRes, args.maxRowsPreview);
  printResponseShape("/activity", activityRes, args.maxRowsPreview);

  if (activityRes.ok && Array.isArray(activityRes.body?.data)) {
    const summary = aggregateActivity(activityRes.body.data, args.range);
    console.log("\n=== aggregated summary ===");
    console.log(JSON.stringify(summary, null, 2));
  }

  if (args.save) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const keyPath = await saveJson(args.outDir, `${stamp}-key.json`, keyRes);
    const activityPath = await saveJson(
      args.outDir,
      `${stamp}-activity.json`,
      activityRes,
    );
    console.log("\nSaved:");
    console.log(`- ${keyPath}`);
    console.log(`- ${activityPath}`);
  }
}

main().catch((error) => {
  console.error("Probe failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
