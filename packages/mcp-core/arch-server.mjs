#!/usr/bin/env node
// MCP stdio server that gives Claude access to the architecture wiki.
// Component cards live in <repo-root>/.code-workbench/.arch/<slug>.json — tracked by git.
// The repo path is injected via CODE_WORKBENCH_REPO_PATH, or resolved from cwd.

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { recordToolUse } from "./usage-log.mjs";
import { archCardsDir, readArchCards } from "./arch-cards.mjs";

// ---------------------------------------------------------------------------
// Write serialization
// ---------------------------------------------------------------------------

const archLocks = new Map();
function withArchLock(key, fn) {
  const prev = archLocks.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => fn())
    .finally(() => {
      if (archLocks.get(key) === next) archLocks.delete(key);
    });
  archLocks.set(key, next);
  return next;
}
import { tokenize, bm25Rank } from "./text-rank.mjs";

// ---------------------------------------------------------------------------
// Repo-path resolution
// ---------------------------------------------------------------------------

function findRepoRootFromCwd() {
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    if (fsSync.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
}

const REPO_PATH = process.env.CODE_WORKBENCH_REPO_PATH || findRepoRootFromCwd();

function requireRepoPath() {
  if (!REPO_PATH) {
    throw new Error(
      "repo path could not be resolved — set CODE_WORKBENCH_REPO_PATH or run from within a git working tree.",
    );
  }
  return REPO_PATH;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const archDir = archCardsDir;

function assertSafeSlug(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(
      `Invalid arch card slug: «${slug}». Must match /^[a-z0-9-]+$/.`,
    );
  }
  return slug;
}

function safeArchCardPath(repoPath, slug) {
  assertSafeSlug(slug);
  const dir = archDir(repoPath);
  const resolved = path.resolve(path.join(dir, `${slug}.json`));
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error(`Path traversal detected for slug: «${slug}».`);
  }
  return resolved;
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensureArchDir(repoPath) {
  await fs.mkdir(archDir(repoPath), { recursive: true });
}

const readArch = readArchCards;

async function writeArch(repoPath, card) {
  await ensureArchDir(repoPath);
  const file = safeArchCardPath(repoPath, card.slug);
  return withArchLock(file, async () => {
    const tmp = file + "." + randomBytes(6).toString("hex") + ".tmp";
    try {
      await fs.writeFile(tmp, JSON.stringify(card, null, 2), "utf8");
      await fs.rename(tmp, file);
    } catch (err) {
      try {
        await fs.unlink(tmp);
      } catch {
        /* ignore */
      }
      throw err;
    }
  });
}

async function deleteArch(repoPath, slug) {
  const file = safeArchCardPath(repoPath, slug);
  try {
    await fs.unlink(file);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const TOOLS = [
  {
    name: "arch_list",
    description:
      "List all architecture component cards for this repo. Returns slug, name, and first line of description for each card. Use at plan-mode start to understand the system landscape.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "arch_get",
    description:
      "Get the full details of a single architecture component card by slug.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: 'Component slug (e.g. "mcp-core").',
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "arch_search",
    description:
      "Full-text BM25 search over all architecture cards (name, tags, description, guidelines, anti_patterns, decisions, file paths). Returns ranked matches.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search query." },
        limit: {
          type: "number",
          description: "Max results to return. Defaults to 5.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "arch_upsert",
    description:
      "Create or update an architecture component card. The slug is derived from the name if not provided. All array fields are replaced wholesale on update.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Stable identifier. Auto-derived from name if omitted.",
        },
        name: { type: "string", description: "Human-readable component name." },
        description: {
          type: "string",
          description: "What this component does.",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Key file paths (relative to repo root).",
        },
        guidelines: {
          type: "array",
          items: { type: "string" },
          description: "Coding or design guidelines for this component.",
        },
        anti_patterns: {
          type: "array",
          items: { type: "string" },
          description: "Things to avoid in this component.",
        },
        decisions: {
          type: "array",
          items: { type: "string" },
          description: "Key architectural decisions recorded here.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            'Search aliases / synonyms for this component (e.g. ["terminal", "blink", "activity"]). Boosts arch_search recall when the query uses different wording than the card text.',
        },
        dependsOn: {
          type: "array",
          items: { type: "string" },
          description: "Slugs of components this component depends on.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "arch_delete",
    description: "Permanently delete an architecture component card by slug.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Component slug to delete." },
      },
      required: ["slug"],
    },
  },
  {
    name: "arch_audit",
    description:
      "Drift detection: check every card's file paths against the filesystem and report cards whose referenced files no longer exist. Run before relying on arch cards for planning, and after any rename/refactor.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description:
            "Optional — audit only this card. Omit to audit all cards.",
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// MCP plumbing
// ---------------------------------------------------------------------------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

export async function handle(req) {
  const { method, params } = req;
  switch (method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "code-workbench-arch", version: "0.1.0" },
      };
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (name) recordToolUse("cw-arch", name);
      const repoPath = requireRepoPath();

      if (name === "arch_list") {
        const cards = await readArch(repoPath);
        if (cards.length === 0) {
          return {
            content: [{ type: "text", text: "No architecture cards found." }],
          };
        }
        const text = cards
          .sort((a, b) => a.slug.localeCompare(b.slug))
          .map((c) => {
            const firstLine = (c.description || "").split("\n")[0];
            return `[${c.slug}] ${c.name}${firstLine ? " — " + firstLine : ""}`;
          })
          .join("\n");
        return { content: [{ type: "text", text }] };
      }

      if (name === "arch_get") {
        if (!args.slug)
          return {
            content: [{ type: "text", text: "Error: slug is required." }],
          };
        const cards = await readArch(repoPath);
        const card = cards.find((c) => c.slug === args.slug);
        if (!card) {
          return {
            content: [
              {
                type: "text",
                text: `Error: no card with slug "${args.slug}".`,
              },
            ],
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(card, null, 2) }],
        };
      }

      if (name === "arch_search") {
        if (!args.query || !String(args.query).trim()) {
          return {
            content: [{ type: "text", text: "Error: query is required." }],
          };
        }
        const limit = Math.max(1, Math.min(50, Number(args.limit) || 5));
        const cards = await readArch(repoPath);
        const docs = cards.map((c) => ({
          card: c,
          tokens: [
            ...tokenize(c.name),
            ...tokenize(c.name),
            ...(c.tags ?? []).flatMap(tokenize),
            ...(c.tags ?? []).flatMap(tokenize),
            ...tokenize(c.description),
            ...(c.guidelines ?? []).flatMap(tokenize),
            ...(c.anti_patterns ?? []).flatMap(tokenize),
            ...(c.decisions ?? []).flatMap(tokenize),
            ...(c.files ?? []).flatMap(tokenize),
          ],
        }));
        const ranked = bm25Rank(docs, String(args.query)).slice(0, limit);
        if (ranked.length === 0) {
          return { content: [{ type: "text", text: "No matches." }] };
        }
        const text = ranked
          .map(({ card, score }) => {
            const firstLine = (card.description || "").split("\n")[0];
            return `[${card.slug}] score=${score.toFixed(2)} ${card.name}${firstLine ? " — " + firstLine : ""}`;
          })
          .join("\n");
        return { content: [{ type: "text", text }] };
      }

      if (name === "arch_upsert") {
        if (!args.name)
          return {
            content: [{ type: "text", text: "Error: name is required." }],
          };
        const slug = args.slug ? String(args.slug) : slugify(String(args.name));
        if (!slug) {
          return {
            content: [
              {
                type: "text",
                text: "Error: could not derive a slug from the name.",
              },
            ],
          };
        }
        const existing = (await readArch(repoPath)).find(
          (c) => c.slug === slug,
        );
        const card = {
          ...(existing ?? {}),
          slug,
          name: String(args.name),
          description:
            args.description != null
              ? String(args.description)
              : (existing?.description ?? ""),
          files: Array.isArray(args.files)
            ? args.files
            : (existing?.files ?? []),
          guidelines: Array.isArray(args.guidelines)
            ? args.guidelines
            : (existing?.guidelines ?? []),
          anti_patterns: Array.isArray(args.anti_patterns)
            ? args.anti_patterns
            : (existing?.anti_patterns ?? []),
          decisions: Array.isArray(args.decisions)
            ? args.decisions
            : (existing?.decisions ?? []),
          tags: Array.isArray(args.tags) ? args.tags : (existing?.tags ?? []),
          dependsOn: Array.isArray(args.dependsOn)
            ? args.dependsOn
            : (existing?.dependsOn ?? []),
          updatedAt: new Date().toISOString(),
        };
        if (!existing) card.createdAt = card.updatedAt;
        await writeArch(repoPath, card);
        const verb = existing ? "updated" : "created";
        return {
          content: [
            { type: "text", text: `Card ${verb}: [${slug}] ${card.name}` },
          ],
        };
      }

      if (name === "arch_delete") {
        if (!args.slug)
          return {
            content: [{ type: "text", text: "Error: slug is required." }],
          };
        const removed = await deleteArch(repoPath, String(args.slug));
        if (!removed) {
          return {
            content: [
              {
                type: "text",
                text: `Error: no card with slug "${args.slug}".`,
              },
            ],
          };
        }
        return {
          content: [{ type: "text", text: `Card deleted: ${args.slug}` }],
        };
      }

      if (name === "arch_audit") {
        let cards = await readArch(repoPath);
        if (args.slug) {
          cards = cards.filter((c) => c.slug === String(args.slug));
          if (cards.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: no card with slug "${args.slug}".`,
                },
              ],
            };
          }
        }
        const lines = [];
        let cardsWithDrift = 0;
        let missingTotal = 0;
        for (const card of cards.sort((a, b) => a.slug.localeCompare(b.slug))) {
          const files = Array.isArray(card.files) ? card.files : [];
          const repoAbs = path.resolve(repoPath) + path.sep;
          const missing = files.filter((f) => {
            const abs = path.resolve(path.join(repoPath, String(f)));
            // Reject entries that escape the repo root (traversal).
            if (!abs.startsWith(repoAbs)) return true;
            return !fsSync.existsSync(abs);
          });
          if (missing.length > 0) {
            cardsWithDrift += 1;
            missingTotal += missing.length;
            lines.push(`[${card.slug}] ${missing.length} missing:`);
            for (const m of missing) lines.push(`  - ${m}`);
          } else if (files.length === 0) {
            lines.push(`[${card.slug}] no files listed — cannot verify`);
          }
        }
        const header =
          missingTotal === 0
            ? `arch_audit: OK — all referenced files exist (${cards.length} card(s) checked).`
            : `arch_audit: DRIFT — ${missingTotal} missing file(s) across ${cardsWithDrift} card(s) of ${cards.length} checked.`;
        const text =
          lines.length > 0 ? `${header}\n\n${lines.join("\n")}` : header;
        return { content: [{ type: "text", text }] };
      }

      return { _error: { code: -32601, message: `Unknown tool: ${name}` } };
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    default:
      return {
        _error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}
