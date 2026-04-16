// ─── Transport barrel: re-exports + factory ─────────────────────────────
import * as fs from "node:fs";
import * as net from "node:net";
import type { MessageTransport } from "./interfaces";
import { FileTransport, DEFAULT_CHANNEL_DIR } from "./file-transport";
import { UdsTransport } from "./uds-transport";

export {
  FileTransport,
  DEFAULT_CHANNEL_DIR,
  readChannelFile,
  writeChannelFile,
} from "./file-transport";
export { UdsTransport } from "./uds-transport";

const DEFAULT_UDS_SOCKET = "/tmp/agent-channels.sock";

export async function createTransport(): Promise<MessageTransport> {
  const udsPath = process.env.AGENT_UDS_SOCKET || DEFAULT_UDS_SOCKET;
  // Probe UDS socket: try to connect and immediately disconnect
  if (fs.existsSync(udsPath)) {
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("probe timeout")),
          500,
        );
        const sock = net.createConnection({ path: udsPath }, () => {
          clearTimeout(timeout);
          sock.destroy();
          resolve();
        });
        sock.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
      return new UdsTransport(udsPath);
    } catch {
      // Socket file exists but relay is not running — fall through
    }
  }
  return new FileTransport(DEFAULT_CHANNEL_DIR);
}
