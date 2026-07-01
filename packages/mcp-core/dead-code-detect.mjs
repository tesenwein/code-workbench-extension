// Dead-code detection over a workspace.
//
// Detects three categories:
//   1. Unused exports  — exported symbols with no references outside their declaration
//   2. Unused locals   — declared variables / imports / params never read
//   3. Commented-out code blocks — contiguous comment runs that look like code
//
// Unused exports and locals use the TypeScript compiler API (real module
// resolution + type checker) — far fewer false positives than regex scanning.
// Commented-out code stays a line-based heuristic (the compiler ignores comments).
//
// CLI: node dead-code-detect.mjs --root <path> [--exclude-dirs a,b] [--categories exports,locals,comments]

import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { walkFiles, MAX_FILE_BYTES, SKIP_DIRS } from "./file-walk.mjs";

// ── Helpers ───────────────────────────────────────────────────────────────────

const sha1 = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const norm = (p) => p.replace(/\\/g, "/");

function relPath(root, abs) {
  return norm(path.relative(root, abs));
}

const TS_EXTS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

// ── File collection ───────────────────────────────────────────────────────────

async function collectSourceFiles(root, excludeDirs) {
  const sourceFiles = [];
  for await (const abs of walkFiles(root, excludeDirs)) {
    if (TS_EXTS.has(path.extname(abs).toLowerCase()))
      sourceFiles.push(norm(abs));
  }
  return sourceFiles;
}

// walkFiles only yields code files; tsconfig.json / package.json need a
// dedicated walk so per-project config and entry points can be discovered.
async function collectConfigFiles(root, excludeDirs) {
  const skip = new Set([...SKIP_DIRS, ...excludeDirs]);
  const packageJsons = [];
  const tsconfigs = [];

  async function walk(dir, depth) {
    if (depth > 20) return;
    let entries;
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name)) await walk(full, depth + 1);
      } else if (e.isFile()) {
        if (e.name === "package.json") packageJsons.push(norm(full));
        else if (/^tsconfig.*\.json$/.test(e.name)) tsconfigs.push(norm(full));
      }
    }
  }
  await walk(root, 0);
  return { packageJsons, tsconfigs };
}

// ── Entry-point detection ─────────────────────────────────────────────────────
//
// Exports of a package's public entry points are *meant* to have no in-repo
// importer — flagging them is the single biggest false-positive source. We
// collect entry files from every package.json plus conventional index files.

// A package's `main`/`module` usually points at built output (dist/extension.js)
// whereas we scan source (src/extension.ts). Register both the literal path and
// plausible source counterparts so runtime-only entry exports aren't flagged.
function entryVariants(absFile) {
  const variants = new Set([absFile]);
  const bases = new Set([absFile]);
  for (const dir of ["/dist/", "/out/", "/lib/", "/build/"]) {
    if (absFile.includes(dir)) bases.add(absFile.split(dir).join("/src/"));
  }
  for (const b of bases) {
    const ext = path.extname(b);
    const stem = ext ? b.slice(0, -ext.length) : b;
    for (const e of [
      "",
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
    ]) {
      variants.add(e ? stem + e : b);
    }
  }
  return variants;
}

function addEntry(set, file) {
  if (!file) return;
  for (const v of entryVariants(norm(path.resolve(file)))) set.add(v);
}

function collectEntryFromExportsField(set, dir, value) {
  if (typeof value === "string") {
    addEntry(set, path.join(dir, value));
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value))
      collectEntryFromExportsField(set, dir, v);
  }
}

async function collectEntryPoints(root, packageJsons) {
  const entries = new Set();
  const pkgDirs = new Set([root]);
  for (const f of packageJsons) pkgDirs.add(path.dirname(f));

  for (const dir of pkgDirs) {
    let pkg;
    try {
      pkg = JSON.parse(
        await fsPromises.readFile(path.join(dir, "package.json"), "utf8"),
      );
    } catch {
      continue;
    }
    for (const field of ["main", "module", "browser", "types", "typings"]) {
      if (typeof pkg[field] === "string")
        addEntry(entries, path.join(dir, pkg[field]));
    }
    if (typeof pkg.bin === "string") addEntry(entries, path.join(dir, pkg.bin));
    else if (pkg.bin && typeof pkg.bin === "object") {
      for (const v of Object.values(pkg.bin)) {
        if (typeof v === "string") addEntry(entries, path.join(dir, v));
      }
    }
    if (pkg.exports) collectEntryFromExportsField(entries, dir, pkg.exports);

    // Conventional source entries — dist paths above rarely match source files.
    for (const rel of ["index", "src/index", "src/main", "main"]) {
      for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) {
        addEntry(entries, path.join(dir, rel + ext));
      }
    }
  }
  return entries;
}

// ── TypeScript program / language service ─────────────────────────────────────
//
// A workspace can hold several TS projects (a monorepo, or one tsconfig per
// package), each with its own compilerOptions — crucially its own `paths`
// aliases. A single program with one set of options cannot resolve them all,
// so we build one language service per tsconfig.json, plus a fallback service
// for any source file no tsconfig claims.

function createService(projectDir, fileNames, projectOptions) {
  const options = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
    skipLibCheck: true,
    ...projectOptions,
    // Forced regardless of the project's own config:
    noEmit: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
  };

  const versions = new Map(fileNames.map((f) => [f, "1"]));
  const host = {
    getScriptFileNames: () => fileNames,
    getScriptVersion: (f) => versions.get(f) ?? "1",
    getScriptSnapshot: (f) => {
      const text = ts.sys.readFile(f);
      return text === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => projectDir,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  };
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

// Build one service per tsconfig, plus a fallback service for orphan files.
function loadProjects(absRoot, tsconfigs, sourceFiles) {
  const projects = [];
  const covered = new Set();

  for (const cfg of tsconfigs) {
    try {
      const { config, error } = ts.readConfigFile(cfg, ts.sys.readFile);
      if (error || !config) continue;
      const dir = path.dirname(cfg);
      const parsed = ts.parseJsonConfigFileContent(config, ts.sys, dir);
      const fileNames = parsed.fileNames.map(norm);
      if (!fileNames.length) continue;
      projects.push(createService(dir, fileNames, parsed.options ?? {}));
      for (const f of fileNames) covered.add(f);
    } catch {
      // skip malformed tsconfig
    }
  }

  const orphans = sourceFiles.filter((f) => !covered.has(f));
  if (orphans.length) projects.push(createService(absRoot, orphans, {}));
  return projects;
}

// ── Unused exports ────────────────────────────────────────────────────────────

function collectExportedNames(sourceFile) {
  // → [{ name, pos, startLine }]
  const out = [];
  const sf = sourceFile;

  for (const stmt of sf.statements) {
    const flags = ts.getCombinedModifierFlags(stmt);
    const isExported = (flags & ts.ModifierFlags.Export) !== 0;
    const isDefault = (flags & ts.ModifierFlags.Default) !== 0;

    if (isExported && !isDefault) {
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) pushName(out, sf, decl.name);
        }
      } else if (
        ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt) ||
        ts.isModuleDeclaration(stmt)
      ) {
        if (stmt.name && ts.isIdentifier(stmt.name))
          pushName(out, sf, stmt.name);
      }
    }

    // `export { a, b }` with no module specifier (re-exports are pass-through).
    if (
      ts.isExportDeclaration(stmt) &&
      !stmt.moduleSpecifier &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const spec of stmt.exportClause.elements) {
        pushName(out, sf, spec.name);
      }
    }
  }
  return out;
}

function pushName(out, sf, nameNode) {
  const pos = nameNode.getStart(sf);
  out.push({
    name: nameNode.text,
    pos,
    startLine: sf.getLineAndCharacterOfPosition(pos).line + 1,
  });
}

function detectUnusedExports(projects, reportSet, root, entryPoints) {
  // A symbol can be exported by one project's file and consumed by another's,
  // so collect every export candidate and mark it used if ANY project's
  // language service finds a reference to it.
  const candidates = new Map();
  const used = new Set();

  for (const service of projects) {
    const program = service.getProgram();
    if (!program) continue;

    for (const sf of program.getSourceFiles()) {
      if (sf.isDeclarationFile) continue;
      const fileName = norm(sf.fileName);
      if (!reportSet.has(fileName) || entryPoints.has(fileName)) continue;

      for (const { name, pos, startLine } of collectExportedNames(sf)) {
        const key = `${fileName} ${name} ${startLine}`;
        if (!candidates.has(key)) {
          candidates.set(key, {
            kind: "unused-export",
            file: relPath(root, fileName),
            name,
            startLine,
            detail: `Exported '${name}' has no references anywhere in the workspace`,
          });
        }
        if (used.has(key)) continue;
        for (const r of service.getReferencesAtPosition(fileName, pos) ?? []) {
          if (norm(r.fileName) !== fileName || r.textSpan.start !== pos) {
            used.add(key);
            break;
          }
        }
      }
    }
  }

  const items = [];
  for (const [key, item] of candidates) {
    if (!used.has(key)) items.push(item);
  }
  return items;
}

// ── Unused locals / imports / parameters ──────────────────────────────────────

// TS diagnostic codes emitted under noUnusedLocals / noUnusedParameters.
const UNUSED_CODES = new Map([
  [6133, "declared but never read"],
  [6196, "declared but never used"],
  [6198, "all destructured elements are unused"],
  [6199, "all variables are unused"],
  [6205, "all type parameters are unused"],
]);

function detectUnusedLocals(projects, reportSet, root) {
  const items = [];
  const seen = new Set();

  for (const service of projects) {
    const program = service.getProgram();
    if (!program) continue;

    for (const sf of program.getSourceFiles()) {
      if (sf.isDeclarationFile) continue;
      const fileName = norm(sf.fileName);
      if (!reportSet.has(fileName) || seen.has(fileName)) continue;
      seen.add(fileName);

      for (const d of program.getSemanticDiagnostics(sf)) {
        if (!UNUSED_CODES.has(d.code) || d.start == null) continue;
        const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
        const nameMatch = msg.match(/'([^']+)'/);
        const name = nameMatch ? nameMatch[1] : UNUSED_CODES.get(d.code);
        items.push({
          kind: "unused-local",
          file: relPath(root, fileName),
          name,
          startLine: sf.getLineAndCharacterOfPosition(d.start).line + 1,
          detail: msg,
        });
      }
    }
  }
  return items;
}

// ── Commented-out code ────────────────────────────────────────────────────────

const CODE_SIGNALS = [
  /^\s*(const|let|var|function|class|import|export|return|if|for|while|switch)\b/,
  /[{};]\s*$/,
  /\w+\s*\([^)]*\)\s*[{;]/,
  /=>\s*\{/,
  /^\s*<\/?[A-Z][a-zA-Z]+/, // JSX
];

function looksLikeCode(line) {
  const stripped = line.replace(/^\s*\/\/+\s?/, "").replace(/^\s*#\s?/, "");
  return CODE_SIGNALS.some((re) => re.test(stripped));
}

async function detectCommentedCode(root, sourceFiles) {
  const items = [];
  for (const abs of sourceFiles) {
    let src;
    try {
      const buf = await fsPromises.readFile(abs);
      if (buf.length > MAX_FILE_BYTES) continue;
      let isBinary = false;
      const check = Math.min(buf.length, 8000);
      for (let bi = 0; bi < check; bi++) {
        if (buf[bi] === 0) {
          isBinary = true;
          break;
        }
      }
      if (isBinary) continue;
      src = buf.toString("utf8");
    } catch {
      continue;
    }

    const rel = relPath(root, abs);
    const lines = src.split("\n");
    let blockStart = -1;
    let blockLines = [];

    const flush = () => {
      if (
        blockLines.length >= 3 &&
        blockLines.filter(looksLikeCode).length >= 2
      ) {
        items.push({
          kind: "commented-code",
          file: rel,
          name: blockLines[0].trim().slice(0, 60),
          startLine: blockStart + 1,
          detail: `${blockLines.length}-line commented-out code block`,
        });
      }
      blockStart = -1;
      blockLines = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const isComment = trimmed.startsWith("//") || trimmed.startsWith("#");
      if (isComment) {
        if (blockStart === -1) blockStart = i;
        blockLines.push(lines[i]);
      } else {
        flush();
      }
    }
    flush();
  }
  return items;
}

// ── Fingerprint ───────────────────────────────────────────────────────────────

function fingerprint(item) {
  return sha1(`${item.kind}:${item.file}:${item.name}:${item.startLine}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function detectDeadCode(
  root,
  { excludeDirs = [], categories = ["exports", "locals", "comments"] } = {},
) {
  const absRoot = norm(path.resolve(root));
  const sourceFiles = await collectSourceFiles(absRoot, excludeDirs);
  const items = [];

  const wantExports = categories.includes("exports");
  const wantLocals = categories.includes("locals");

  if ((wantExports || wantLocals) && sourceFiles.length) {
    try {
      const { packageJsons, tsconfigs } = await collectConfigFiles(
        absRoot,
        excludeDirs,
      );
      const projects = loadProjects(absRoot, tsconfigs, sourceFiles);
      const reportSet = new Set(sourceFiles);
      if (wantExports) {
        const entryPoints = await collectEntryPoints(absRoot, packageJsons);
        items.push(
          ...detectUnusedExports(projects, reportSet, absRoot, entryPoints),
        );
      }
      if (wantLocals) {
        items.push(...detectUnusedLocals(projects, reportSet, absRoot));
      }
      for (const service of projects) service.dispose();
    } catch (e) {
      process.stderr.write(
        `dead-code: TS analysis failed — ${e?.message ?? e}\n`,
      );
    }
  }

  if (categories.includes("comments")) {
    items.push(...(await detectCommentedCode(absRoot, sourceFiles)));
  }

  return items.map((item) => ({ ...item, fingerprint: fingerprint(item) }));
}

// ── CLI ───────────────────────────────────────────────────────────────────────

// Resolve symlinks on the invoked path: when spawned via a pnpm-symlinked
// node_modules path, process.argv[1] is the symlink while import.meta.url is
// node's canonicalised real path — a raw compare would skip the CLI entirely.
const __entry = process.argv[1] ? fs.realpathSync(process.argv[1]) : "";
// Basename guard: when this file is bundled into another script (e.g.
// dead-code-server) both __entry and import.meta.url resolve to the bundle,
// so the raw URL check below would falsely match — the CLI block would run
// on server startup, write JSON to stdout, and corrupt the MCP protocol.
if (
  __entry &&
  path.basename(__entry) === "dead-code-detect.mjs" &&
  pathToFileURL(__entry).href === import.meta.url
) {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf("--root");
  const root = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();
  const excludeIdx = args.indexOf("--exclude-dirs");
  const excludeDirs =
    excludeIdx >= 0 ? args[excludeIdx + 1].split(",").filter(Boolean) : [];
  const catIdx = args.indexOf("--categories");
  const categories =
    catIdx >= 0
      ? args[catIdx + 1].split(",").filter(Boolean)
      : ["exports", "locals", "comments"];

  detectDeadCode(root, { excludeDirs, categories })
    .then((items) => {
      process.stdout.write(JSON.stringify(items));
    })
    .catch((e) => {
      process.stderr.write((e?.message ?? String(e)) + "\n");
      process.exit(1);
    });
}
