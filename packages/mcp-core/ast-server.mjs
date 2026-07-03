#!/usr/bin/env node
/**
 * code-workbench-ast  —  MCP server providing tree-sitter code-awareness tools.
 *
 * Tools:
 *   get_file_outline   – all top-level symbols + imports for a file
 *   get_symbol_source  – source code of one named symbol
 *   ast_query          – run a raw tree-sitter S-expression query
 *   search_code        – hybrid (BM25 + semantic) search over workspace symbols
 *   find_duplicates    – detect duplicate / near-duplicate code clones
 *   acknowledge_duplicate – mark a clone group as reviewed/OK so it stops reappearing
 *   exclude_directory  – skip a directory (by basename) from future scans
 *
 * Grammar WASM files must be placed in ./grammars/ by running:
 *   npm run setup:grammars
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { groupFingerprint } from "./scan-runner.mjs";
import {
  readAcks,
  writeAcks,
  readExcludeDirs,
  writeExcludeDirs,
} from "./scan-state.mjs";
import { readFindings, writeFindings } from "./findings-store.mjs";

const STALE_MS = 24 * 60 * 60 * 1000;
import { startStdioServer } from "./stdio-server.mjs";
import { recordToolUse } from "./usage-log.mjs";
import {
  EXT_TO_LANG,
  getParser,
  detectLanguage,
  nodeRange,
  isAsync,
  isExported,
  hasChildOfType,
  extractClassMembers,
  extractTsSymbols,
  extractPythonSymbols,
} from "./ast-core.mjs";
import { searchCode } from "./code-search.mjs";
import { detectClones } from "./clone-detect.mjs";
import { normalizeFingerprints } from "./scan-server-kit.mjs";

// ── Path validation ───────────────────────────────────────────────────────────

const ALLOWED_ROOTS = (() => {
  const env = process.env.CODE_WORKBENCH_AST_ROOTS;
  const roots = env
    ? env.split(path.delimiter).filter(Boolean)
    : [process.cwd()];
  return roots.map((r) => path.resolve(r));
})();

function isPathAllowed(filePath) {
  // Normalize case on Windows to handle drive-letter mismatches (e.g. C:\ vs c:\).
  const normalize =
    process.platform === "win32" ? (p) => p.toLowerCase() : (p) => p;
  const resolved = normalize(path.resolve(filePath));
  return ALLOWED_ROOTS.some((root) => {
    const rel = path.relative(normalize(root), resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

// ── Tool: get_file_outline ────────────────────────────────────────────────────

async function toolGetFileOutline({ file_path }, preloaded) {
  if (!file_path) return { error: "file_path is required" };
  if (!isPathAllowed(file_path)) {
    return { error: `Path not within allowed roots: ${file_path}` };
  }

  let source = preloaded;
  if (source === undefined) {
    try {
      source = readFileSync(file_path, "utf8");
    } catch (err) {
      return { error: `Cannot read file: ${err.message}` };
    }
  }

  const language = detectLanguage(file_path);
  if (!language) {
    return { error: `Unsupported file extension: ${path.extname(file_path)}` };
  }

  const parserEntry = await getParser(language);
  if (!parserEntry) {
    return {
      error: `Grammar not available for "${language}". Run: npm run setup:grammars`,
    };
  }

  const tree = parserEntry.parser.parse(source);

  let extracted;
  if (language === "python") {
    extracted = extractPythonSymbols(tree.rootNode, source);
  } else {
    extracted = extractTsSymbols(tree.rootNode, source);
  }

  return {
    file: file_path,
    language,
    totalLines: source.split("\n").length,
    symbols: extracted.symbols,
    imports: extracted.imports,
  };
}

// ── Tool: get_symbol_source ───────────────────────────────────────────────────

async function toolGetSymbolSource({ file_path, symbol_name }) {
  if (!file_path || !symbol_name) {
    return { error: "file_path and symbol_name are required" };
  }
  if (!isPathAllowed(file_path)) {
    return { error: `Path not within allowed roots: ${file_path}` };
  }

  let source;
  try {
    source = readFileSync(file_path, "utf8");
  } catch (err) {
    return { error: `Cannot read file: ${err.message}` };
  }

  const outline = await toolGetFileOutline({ file_path }, source);
  if (outline.error) return outline;

  function find(symbols, name) {
    for (const s of symbols) {
      if (s.name === name) return s;
      if (s.members) {
        const m = find(s.members, name);
        if (m) return { ...m, parentName: s.name };
      }
    }
    return null;
  }

  const sym = find(outline.symbols, symbol_name);
  if (!sym)
    return { error: `Symbol '${symbol_name}' not found in ${file_path}` };

  const lines = source.split("\n");
  const code = lines.slice(sym.startLine - 1, sym.endLine).join("\n");

  return {
    file: file_path,
    symbol: symbol_name,
    kind: sym.kind,
    startLine: sym.startLine,
    endLine: sym.endLine,
    source: code,
  };
}

// ── Tool: ast_query ───────────────────────────────────────────────────────────

const AST_QUERY_MAX_FILE_BYTES = 512 * 1024;
const AST_QUERY_MAX_MATCHES = 2000;

async function toolAstQuery({ file_path, query }) {
  if (!file_path || !query)
    return { error: "file_path and query are required" };
  if (!isPathAllowed(file_path)) {
    return { error: `Path not within allowed roots: ${file_path}` };
  }

  let source;
  try {
    const buf = readFileSync(file_path);
    if (buf.length > AST_QUERY_MAX_FILE_BYTES) {
      return {
        error: `File too large for ast_query (>${AST_QUERY_MAX_FILE_BYTES / 1024}KB): ${file_path}`,
      };
    }
    source = buf.toString("utf8");
  } catch (err) {
    return { error: `Cannot read file: ${err.message}` };
  }

  const language = detectLanguage(file_path);
  if (!language)
    return { error: `Unsupported file extension: ${path.extname(file_path)}` };

  const parserEntry = await getParser(language);
  if (!parserEntry) {
    return {
      error: `Grammar not available for "${language}". Run: npm run setup:grammars`,
    };
  }

  try {
    const tree = parserEntry.parser.parse(source);
    const tsQuery = parserEntry.lang.query(query);
    const allMatches = tsQuery.matches(tree.rootNode);
    const truncated = allMatches.length > AST_QUERY_MAX_MATCHES;
    const matches = truncated
      ? allMatches.slice(0, AST_QUERY_MAX_MATCHES)
      : allMatches;

    return {
      file: file_path,
      language,
      matchCount: allMatches.length,
      ...(truncated
        ? {
            truncated: true,
            note: `Results capped at ${AST_QUERY_MAX_MATCHES}`,
          }
        : {}),
      matches: matches.map((m) => ({
        patternIndex: m.patternIndex,
        captures: m.captures.map((c) => ({
          name: c.name,
          text: source.slice(c.node.startIndex, c.node.endIndex),
          startLine: c.node.startPosition.row + 1,
          endLine: c.node.endPosition.row + 1,
        })),
      })),
    };
  } catch (err) {
    return { error: `Query error: ${err.message}` };
  }
}

// ── Tool: search_code ────────────────────────────────────────────────────────

async function toolSearchCode({ query, limit, langs }) {
  if (!query) return { error: "query is required" };
  const roots = ALLOWED_ROOTS;
  const results = await searchCode({ roots, query, limit, langs });
  return { results };
}

// ── Tool: find_duplicates ─────────────────────────────────────────────────────

function postFilterGroups(
  groups,
  { minLines, similarity, includeStructural, langs, limit },
) {
  const langSet =
    Array.isArray(langs) && langs.length
      ? new Set(langs.map((l) => String(l)))
      : null;
  let filtered = groups.filter((g) => {
    if (includeStructural === false && g.cloneType === "structural")
      return false;
    if (
      typeof similarity === "number" &&
      g.cloneType === "structural" &&
      g.similarity < similarity
    ) {
      return false;
    }
    if (typeof minLines === "number") {
      const groupLines = Math.max(
        ...g.members.map((m) =>
          typeof m.lines === "number"
            ? m.lines
            : Math.max(0, (m.endLine ?? m.startLine) - m.startLine + 1),
        ),
      );
      if (groupLines < minLines) return false;
    }
    if (langSet) {
      // No language tagged on groups; infer from member file extensions.
      const matchesLang = g.members.some((m) => {
        const ext = (m.file.match(/\.([^./\\]+)$/) || [, ""])[1].toLowerCase();
        const lang = EXT_TO_LANG?.[ext];
        return lang && langSet.has(lang);
      });
      if (!matchesLang) return false;
    }
    return true;
  });
  if (typeof limit === "number" && limit > 0)
    filtered = filtered.slice(0, limit);
  return filtered;
}

async function toolFindDuplicates({
  min_lines,
  similarity,
  limit,
  langs,
  include_structural,
  force_scan,
}) {
  const root = ALLOWED_ROOTS[0];
  const acked = new Set(await readAcks(root, "duplicates"));

  if (force_scan) {
    const rawGroups = await detectClones({
      roots: ALLOWED_ROOTS,
      minLines: min_lines,
      similarity,
      langs,
      includeStructural: include_structural,
      excludeDirs: await readExcludeDirs(root, "duplicates"),
    });
    const groups = rawGroups.map((g) => ({
      cloneType: g.cloneType,
      similarity: g.similarity,
      count: g.count,
      fingerprint: groupFingerprint(g),
      members: g.members.map(({ normHash, ...m }) => m),
    }));
    await writeFindings(root, "duplicates", { root, groups });
    const postFiltered = postFilterGroups(groups, {
      minLines: min_lines,
      similarity,
      includeStructural: include_structural,
      langs,
      limit,
    });
    const visible = postFiltered.filter((g) => !acked.has(g.fingerprint));
    return {
      root,
      generatedAt: Date.now(),
      stale: false,
      count: visible.length,
      acknowledgedHidden: postFiltered.length - visible.length,
      groups: visible,
    };
  }

  const findings = await readFindings(root, "duplicates");
  if (!findings || !Array.isArray(findings.groups)) {
    return {
      error:
        "No duplicate scan yet. Open the Duplicates panel in the workbench and click Rescan, " +
        "or call find_duplicates with force_scan: true.",
    };
  }
  const postFiltered = postFilterGroups(findings.groups, {
    minLines: min_lines,
    similarity,
    includeStructural: include_structural,
    langs,
    limit,
  });
  const visible = postFiltered.filter((g) => !acked.has(g.fingerprint));
  return {
    root,
    generatedAt: findings.generatedAt,
    stale: Date.now() - findings.generatedAt > STALE_MS,
    count: visible.length,
    acknowledgedHidden: postFiltered.length - visible.length,
    groups: visible,
  };
}

async function toolAcknowledgeDuplicate({ fingerprint, fingerprints, unack }) {
  const list = normalizeFingerprints(fingerprint, fingerprints);
  if (list.length === 0) {
    throw new Error("fingerprint (or fingerprints) is required");
  }
  const root = ALLOWED_ROOTS[0];
  const current = await readAcks(root, "duplicates");
  const set = new Set(current);
  if (unack) {
    for (const f of list) set.delete(f);
  } else {
    for (const f of list) set.add(f);
  }
  const updated = [...set];
  await writeAcks(root, "duplicates", updated);
  return { acknowledged: updated, count: updated.length };
}

async function toolExcludeDirectory({ dir, unexclude }) {
  if (typeof dir !== "string" || !dir.trim()) {
    throw new Error("dir is required");
  }
  const root = ALLOWED_ROOTS[0];
  const name = dir.trim();
  const current = await readExcludeDirs(root, "duplicates");
  const updated = unexclude
    ? current.filter((d) => d !== name)
    : current.includes(name)
      ? current
      : [...current, name];
  await writeExcludeDirs(root, "duplicates", updated);
  return { excludeDirs: updated, count: updated.length };
}

// ── MCP tool definitions ──────────────────────────────────────────────────────

export const TOOLS = [
  {
    name: "get_file_outline",
    description:
      "Parse a source file with tree-sitter and return all top-level symbols " +
      "(functions, classes, interfaces, types, enums) with start/end line numbers, " +
      "plus all import statements. Use this to understand a file's structure " +
      "without reading its full content. Supports .ts, .tsx, .js, .jsx, .mjs, .py.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the source file to parse.",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "get_symbol_source",
    description:
      "Get the complete source code of one named symbol (function, class, method, etc.) " +
      "from a file, with its exact start and end line numbers. Useful for reading a " +
      "specific function without loading the entire file.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the source file.",
        },
        symbol_name: {
          type: "string",
          description:
            "Exact name of the symbol to extract (function, class, interface, type, enum, or method name).",
        },
      },
      required: ["file_path", "symbol_name"],
    },
  },
  {
    name: "ast_query",
    description:
      "Run a raw tree-sitter S-expression query against a source file and return all " +
      "matches with capture names, matched text, and line numbers. Use for structural " +
      "searches that go beyond what get_file_outline provides. " +
      'Example: "(function_declaration name: (identifier) @fn.name)" finds all function names.',
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the source file.",
        },
        query: {
          type: "string",
          description: "Tree-sitter S-expression query string.",
        },
      },
      required: ["file_path", "query"],
    },
  },
  {
    name: "search_code",
    description:
      "Hybrid search over all symbols in the workspace — identifier-aware BM25 with semantic " +
      "reranking and a fuzzy fallback. Describe what you are looking " +
      'for in plain English (e.g. "debounce git polling", "parse markdown frontmatter") and ' +
      "get back the top matching functions, classes, and types with file paths and line numbers. " +
      "Handles camelCase and fused queries. Faster than grep for concept-level searches; " +
      "works across .ts, .tsx, .js, .mjs, .py files.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Free-text description of the symbol or code fragment you are looking for.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default 20).",
        },
        langs: {
          type: "array",
          items: { type: "string" },
          description:
            'Optional language filter, e.g. ["typescript", "python"]. Omit for all languages.',
        },
      },
      required: ["query"],
    },
  },
  {
    name: "find_duplicates",
    description:
      "Return duplicate/near-duplicate clone groups from the most recent host-triggered scan. " +
      'Clone types: "exact", "renamed", and "structural". Reads the persisted findings file ' +
      "written by the Code Workbench UI (or by a force_scan call) and applies current " +
      "acknowledgements at read time plus the min_lines / similarity / include_structural / " +
      "langs / limit filters as post-filters over the persisted set. " +
      'The response includes "generatedAt" (epoch ms) and "stale" (true when older than 24h). ' +
      "If no scan has been run yet, returns an error pointing the user at the Duplicates panel. " +
      "Pass force_scan: true to run a fresh inline scan (slower) and persist its result.",
    inputSchema: {
      type: "object",
      properties: {
        min_lines: {
          type: "number",
          description:
            "Ignore symbols shorter than this many lines (default 5).",
        },
        similarity: {
          type: "number",
          description:
            'Similarity threshold 0-1 for "structural" near-duplicates (default 0.85).',
        },
        include_structural: {
          type: "boolean",
          description:
            "Include the more expensive structural (Type-3) pass (default true). " +
            "Set false for a fast exact/renamed-only scan.",
        },
        limit: {
          type: "number",
          description: "Maximum number of clone groups to return (default 30).",
        },
        langs: {
          type: "array",
          items: { type: "string" },
          description:
            'Optional language filter, e.g. ["typescript", "python"]. Omit for all languages.',
        },
        force_scan: {
          type: "boolean",
          description:
            "Run a fresh inline scan instead of reading the persisted findings file. " +
            "The result is also persisted, so later calls without force_scan are fast.",
        },
      },
    },
  },
  {
    name: "acknowledge_duplicate",
    description:
      "Mark one or more clone groups as reviewed and acceptable so they no longer appear in " +
      'find_duplicates results. Pass a single "fingerprint" or an array of "fingerprints" ' +
      "from find_duplicates groups. " +
      "Acknowledgements are shared with the desktop UI Duplicates pane. " +
      "Set unack:true to remove the acknowledgement(s).",
    inputSchema: {
      type: "object",
      properties: {
        fingerprint: {
          type: "string",
          description:
            'The "fingerprint" field of a single clone group, from find_duplicates output.',
        },
        fingerprints: {
          type: "array",
          items: { type: "string" },
          description:
            "An array of clone-group fingerprints to acknowledge in one call. " +
            "Combined with fingerprint if both are given.",
        },
        unack: {
          type: "boolean",
          description:
            "If true, remove these fingerprints from the acknowledged list instead of adding them.",
        },
      },
    },
  },
  {
    name: "exclude_directory",
    description:
      "Exclude a directory from future find_duplicates scans by its basename " +
      '(e.g. "release" or "mcp-server"). Any directory with that name is skipped ' +
      "entirely during the workspace walk, on top of built-in skips like node_modules. " +
      "Use for build outputs or synced/generated copies that produce noise duplicates. " +
      "The exclusion list is shared with the desktop UI Duplicates pane. " +
      "Set unexclude:true to remove a directory from the exclusion list.",
    inputSchema: {
      type: "object",
      properties: {
        dir: {
          type: "string",
          description:
            "Directory basename to exclude (matched anywhere in the tree).",
        },
        unexclude: {
          type: "boolean",
          description:
            "If true, remove this directory from the exclusion list instead of adding it.",
        },
      },
      required: ["dir"],
    },
  },
];

const HANDLERS = {
  get_file_outline: toolGetFileOutline,
  get_symbol_source: toolGetSymbolSource,
  ast_query: toolAstQuery,
  search_code: toolSearchCode,
  find_duplicates: toolFindDuplicates,
  acknowledge_duplicate: toolAcknowledgeDuplicate,
  exclude_directory: toolExcludeDirectory,
};

// ── MCP JSON-RPC protocol ─────────────────────────────────────────────────────

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
        serverInfo: { name: "code-workbench-ast", version: "1.0.0" },
      };

    case "tools/list":
      return { tools: TOOLS };

    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (name) recordToolUse("cw-ast", name);
      const handler = HANDLERS[name];
      if (!handler) {
        return { _error: { code: -32601, message: `Unknown tool: ${name}` } };
      }
      // Validate string args that must be strings (not objects).
      for (const key of ["file_path", "symbol_name", "query"]) {
        if (key in args && typeof args[key] !== "string") {
          return {
            _error: {
              code: -32602,
              message: `Invalid argument: "${key}" must be a string, got ${typeof args[key]}`,
            },
          };
        }
      }
      const result = await handler(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return {};

    default:
      return {
        _error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}
