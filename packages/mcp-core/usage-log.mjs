// Shared MCP tool-usage counter.
//
// Every workbench MCP server calls `recordToolUse(server, tool)` once per
// `tools/call`. Counts are aggregated into a single machine-wide JSON file at
// `~/.code-workbench/local/mcp-usage.json` — gitignored, per-user state.
//
// Best-effort by design: failures are swallowed so tool calls never break, and
// cross-process writes use atomic rename. Aggregate counters tolerate the rare
// lost increment from a concurrent read-modify-write.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

function usageFilePath() {
  const override = process.env.CODE_WORKBENCH_HOME;
  const home = override && override.trim() ? override.trim() : os.homedir();
  return path.join(home, ".code-workbench", "local", "mcp-usage.json");
}

// Serialize writes within this process so concurrent calls don't clobber.
let writeChain = Promise.resolve();

/**
 * Record one MCP tool invocation. Fire-and-forget — never throws.
 * @param {string} server  MCP server key, e.g. 'cw-arch'
 * @param {string} tool    Tool name, e.g. 'arch_list'
 */
export function recordToolUse(server, tool) {
  if (!server || !tool) return;
  writeChain = writeChain.then(() => bumpCount(server, tool)).catch(() => {});
}

async function bumpCount(server, tool) {
  const file = usageFilePath();

  let data = { version: 1, counts: {} };
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.counts &&
      typeof parsed.counts === "object"
    ) {
      data = parsed;
    }
  } catch {
    // Missing or malformed file — start fresh.
  }

  if (!data.counts[server] || typeof data.counts[server] !== "object")
    data.counts[server] = {};
  data.counts[server][tool] = (Number(data.counts[server][tool]) || 0) + 1;
  data.updatedAt = new Date().toISOString();

  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}
