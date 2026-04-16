#!/usr/bin/env bun
// ─── Relay server CLI entrypoint ────────────────────────────────────────
import { RelayServer } from "./server";

const socketPath = process.argv[2] || "/tmp/agent-channels.sock";

// Clean up stale socket
import * as fs from "node:fs";
try {
  fs.unlinkSync(socketPath);
} catch {
  /* doesn't exist */
}

const server = new RelayServer({ socketPath });
server.start();

console.log(`[relay] listening on ${socketPath}`);

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
