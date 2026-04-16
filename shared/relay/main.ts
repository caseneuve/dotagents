#!/usr/bin/env bun
// ─── Relay server CLI entrypoint ────────────────────────────────────────
import { RelayServer } from "./server";
import * as fs from "node:fs";

const socketPath = process.argv[2] || "/tmp/agent-channels.sock";
const httpPort = parseInt(process.env.RELAY_HTTP_PORT || "7700", 10);
const httpHost = process.env.RELAY_HTTP_HOST || "0.0.0.0";
const quiet = process.argv.includes("--quiet");

// Clean up stale socket
try {
  fs.unlinkSync(socketPath);
} catch {
  /* doesn't exist */
}

const server = new RelayServer({
  socketPath,
  httpPort,
  httpHost,
  verbose: !quiet,
});
server.start();

console.log(`[relay] UDS listening on ${socketPath}`);
console.log(`[relay] HTTP listening on http://${httpHost}:${httpPort}`);
console.log(`[relay] logging: ${quiet ? "quiet" : "verbose"}`);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[relay] shutting down");
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.stop();
  process.exit(0);
});
