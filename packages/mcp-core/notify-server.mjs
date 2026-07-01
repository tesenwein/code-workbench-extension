#!/usr/bin/env node
// Minimal MCP stdio server that forwards notifications to the Claude Workbench
// Electron app via a localhost TCP socket. The port is injected via the env var
// CODE_WORKBENCH_NOTIFY_PORT when Claude is spawned inside the workbench PTY.
// If the env var is missing (e.g. Claude run outside the workbench), tool calls
// still succeed but are dropped silently.

import net from "node:net";
import fs from "node:fs";
import { recordToolUse } from "./usage-log.mjs";

const PORT = Number(process.env.CODE_WORKBENCH_NOTIFY_PORT) || 0;
if (!PORT) {
  process.stderr.write(
    "[notify-server] CODE_WORKBENCH_NOTIFY_PORT is not set — notifications will be dropped silently.\n",
  );
}
const SESSION_ID = process.env.CODE_WORKBENCH_SESSION_ID || "";
const NOTIFY_TOKEN = process.env.CODE_WORKBENCH_NOTIFY_TOKEN || "";

// When Claude runs inside a WSL distro the workbench's TCP server lives on the
// Windows host: `127.0.0.1` is then the distro's own loopback and never reaches
// it. Under WSL2 NAT networking the host is reachable via the resolv.conf
// nameserver or the default-route gateway; under mirrored networking plain
// `127.0.0.1` works. Probe every candidate and cache the first that connects.
function isWsl() {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(fs.readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

function wslHostCandidates() {
  const hosts = [];
  try {
    const m = /^\s*nameserver\s+([0-9.]+)/m.exec(
      fs.readFileSync("/etc/resolv.conf", "utf8"),
    );
    if (m) hosts.push(m[1]);
  } catch {
    /* no resolv.conf */
  }
  try {
    // /proc/net/route: the default route has destination 00000000; its gateway
    // column is a little-endian hex IPv4 address.
    for (const line of fs
      .readFileSync("/proc/net/route", "utf8")
      .split("\n")
      .slice(1)) {
      const c = line.trim().split(/\s+/);
      if (
        c.length > 2 &&
        c[1] === "00000000" &&
        /^[0-9A-Fa-f]{8}$/.test(c[2])
      ) {
        const gw = [6, 4, 2, 0]
          .map((i) => parseInt(c[2].slice(i, i + 2), 16))
          .join(".");
        if (gw !== "0.0.0.0") hosts.push(gw);
      }
    }
  } catch {
    /* no /proc/net/route */
  }
  return hosts;
}

// 127.0.0.1 first: correct off-WSL and under WSL mirrored networking, and it
// fails fast (ECONNREFUSED) under NAT so the fallbacks are tried right away.
const HOST_CANDIDATES = [
  "127.0.0.1",
  ...(isWsl() ? wslHostCandidates() : []),
].filter((h, i, a) => a.indexOf(h) === i);

let cachedHost = null;

function tryConnect(host, payload) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port: PORT }, () => {
      sock.end(JSON.stringify(payload) + "\n", () => resolve(true));
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(1500, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function forward(payload) {
  if (!PORT) return false;
  const order = cachedHost
    ? [cachedHost, ...HOST_CANDIDATES.filter((h) => h !== cachedHost)]
    : HOST_CANDIDATES;
  for (const host of order) {
    if (await tryConnect(host, payload)) {
      cachedHost = host;
      return true;
    }
  }
  cachedHost = null;
  return false;
}

export const TOOLS = [
  {
    name: "notify_done",
    description:
      "Notify the user in the Claude Workbench UI that the current task is finished. Use when you have completed the user's request and no further input is needed right now.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short headline shown in the toast.",
        },
        message: {
          type: "string",
          description: "Optional details about what was completed.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "notify_needs_input",
    description:
      "Notify the user in the Claude Workbench UI that you are blocked and need their input or a decision before continuing.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short question or prompt for the user.",
        },
        message: {
          type: "string",
          description: "Optional context describing what is needed.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "notify_info",
    description:
      "Send an informational notification to the Claude Workbench UI (progress update, FYI). Does not imply you are done or blocked.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short headline shown in the toast.",
        },
        message: {
          type: "string",
          description: "Optional details about the progress update.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "notify_chat_title",
    description:
      'Rename the Claude Workbench chat tab that this Claude session is running in. Use to summarize the current task (e.g. "Refactor auth middleware"). Only affects the tab label in the workbench UI; reset by clearing or renaming manually.',
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "New tab label. Empty string clears the override and restores the default title.",
        },
      },
      required: ["title"],
    },
  },
];

const KIND_BY_TOOL = {
  notify_done: "done",
  notify_needs_input: "needs_input",
  notify_info: "info",
};

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

export async function handle(req) {
  const { id, method, params } = req;
  switch (method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "code-workbench-notify", version: "0.1.0" },
      };
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (name) recordToolUse("cw-notify", name);
      if (name === "notify_chat_title") {
        if (args.title !== undefined && typeof args.title !== "string") {
          return {
            _error: {
              code: -32602,
              message: 'Invalid argument: "title" must be a string',
            },
          };
        }
        if (!SESSION_ID) {
          return {
            content: [
              {
                type: "text",
                text: "Cannot retitle: CODE_WORKBENCH_SESSION_ID is missing (not running inside a workbench chat tab).",
              },
            ],
          };
        }
        const delivered = await forward({
          type: "set_title",
          sessionId: SESSION_ID,
          title: String(args.title ?? "").slice(0, 80),
          token: NOTIFY_TOKEN,
        });
        return {
          content: [
            {
              type: "text",
              text: delivered
                ? "Tab title updated."
                : "Tab title update dropped — Claude Workbench not reachable.",
            },
          ],
        };
      }
      const kind = KIND_BY_TOOL[name];
      if (!kind) {
        return { _error: { code: -32601, message: `Unknown tool: ${name}` } };
      }
      if (args.title !== undefined && typeof args.title !== "string") {
        return {
          _error: {
            code: -32602,
            message: 'Invalid argument: "title" must be a string',
          },
        };
      }
      const delivered = await forward({
        type: "notification",
        kind,
        title: String(args.title ?? "").slice(0, 200),
        message: args.message ? String(args.message).slice(0, 2000) : "",
        ts: Date.now(),
        token: NOTIFY_TOKEN,
      });
      const text = delivered
        ? `Notification sent to Claude Workbench (${kind}).`
        : "Notification dropped — Claude Workbench not detected (CODE_WORKBENCH_NOTIFY_PORT missing or unreachable).";
      return { content: [{ type: "text", text }] };
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // no response for notifications
    default:
      return {
        _error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}
