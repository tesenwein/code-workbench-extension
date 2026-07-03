// Type-escape detection over a workspace.
//
// Surfaces the four most common ways TypeScript's type safety gets bypassed —
// patterns AI-generated code leans on to silence the compiler rather than fix
// the underlying type error:
//   1. as-cast    — `expr as T` assertions (excluding `as const`)
//   2. any-type   — explicit `any` type annotations
//   3. non-null   — non-null `!` assertions (`expr!`)
//   4. ts-ignore  — `@ts-ignore` / `@ts-expect-error` directive comments
//
// Purely syntactic: a per-file source AST (no type checker / module
// resolution), so the scan is fast and config-free. Follows the
// dead-code-detect.mjs precedent.
//
// CLI: node type-escape-detect.mjs --root <path> [--exclude-dirs a,b] [--categories as-cast,any-type,non-null,ts-ignore]

import fsPromises from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import { isCliEntry } from "./cli-entry.mjs";
import { walkFiles, MAX_FILE_BYTES } from "./file-walk.mjs";

// ── Helpers ───────────────────────────────────────────────────────────────────

const sha1 = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const norm = (p) => p.replace(/\\/g, "/");

function relPath(root, abs) {
  return norm(path.relative(root, abs));
}

// Only .ts/.tsx carry type annotations worth scanning; .js/.jsx have none.
const TS_EXTS = new Set([".ts", ".tsx", ".mts", ".cts"]);

const ALL_CATEGORIES = ["as-cast", "any-type", "non-null", "ts-ignore"];

async function collectSourceFiles(root, excludeDirs) {
  const sourceFiles = [];
  for await (const abs of walkFiles(root, excludeDirs)) {
    if (TS_EXTS.has(path.extname(abs).toLowerCase()))
      sourceFiles.push(norm(abs));
  }
  return sourceFiles;
}

// ── Enclosing-symbol resolution ─────────────────────────────────────────────
//
// Findings read far better when attributed to the function/class/variable that
// contains them than to a bare line number. Walk up the parent chain to the
// nearest named declaration.

function enclosingName(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (
      (ts.isFunctionDeclaration(n) ||
        ts.isClassDeclaration(n) ||
        ts.isMethodDeclaration(n) ||
        ts.isInterfaceDeclaration(n) ||
        ts.isTypeAliasDeclaration(n) ||
        ts.isEnumDeclaration(n)) &&
      n.name &&
      ts.isIdentifier(n.name)
    ) {
      return n.name.text;
    }
    if (
      (ts.isVariableDeclaration(n) || ts.isPropertyDeclaration(n)) &&
      n.name &&
      ts.isIdentifier(n.name)
    ) {
      return n.name.text;
    }
    if (
      (ts.isFunctionExpression(n) || ts.isArrowFunction(n)) &&
      ts.isVariableDeclaration(n.parent) &&
      ts.isIdentifier(n.parent.name)
    ) {
      return n.parent.name.text;
    }
  }
  return "<module>";
}

const snippet = (text) => text.replace(/\s+/g, " ").trim().slice(0, 80);

// ── AST visitor ───────────────────────────────────────────────────────────────

function detectInFile(sf, rel, wanted) {
  const items = [];
  const text = sf.getFullText();

  const add = (node, kind, name, detail) => {
    const start = node.getStart(sf);
    items.push({
      kind,
      file: rel,
      name,
      startLine: sf.getLineAndCharacterOfPosition(start).line + 1,
      detail,
      // Content of the offending node — fingerprint stays stable when lines shift.
      content: snippet(node.getText(sf)),
    });
  };

  const visit = (node) => {
    // `expr as T` — skip `as const`, which is a safe literal-narrowing assertion.
    if (wanted.has("as-cast") && ts.isAsExpression(node)) {
      const isConst =
        ts.isTypeReferenceNode(node.type) &&
        ts.isIdentifier(node.type.typeName) &&
        node.type.typeName.text === "const";
      if (!isConst) {
        add(
          node,
          "as-cast",
          enclosingName(node),
          `Type assertion: ${snippet(node.getText(sf))}`,
        );
      }
    }

    // Explicit `any` annotation.
    if (wanted.has("any-type") && node.kind === ts.SyntaxKind.AnyKeyword) {
      add(
        node,
        "any-type",
        enclosingName(node),
        "Explicit 'any' type annotation",
      );
    }

    // `expr!` non-null assertion.
    if (wanted.has("non-null") && ts.isNonNullExpression(node)) {
      add(
        node,
        "non-null",
        enclosingName(node),
        `Non-null assertion: ${snippet(node.getText(sf))}`,
      );
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  // ts-ignore / ts-expect-error directive comments — scanned over raw text since
  // comments are not AST nodes.
  if (wanted.has("ts-ignore")) {
    const re =
      /\/\/[/\s]*@(ts-ignore|ts-expect-error)\b([^\n]*)|\/\*[\s*]*@(ts-ignore|ts-expect-error)\b/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const directive = m[1] ?? m[3];
      const line = sf.getLineAndCharacterOfPosition(m.index).line + 1;
      items.push({
        kind: "ts-ignore",
        file: rel,
        name: `@${directive}`,
        startLine: line,
        detail: `Type-check suppressed via @${directive}`,
        content: snippet(m[0]),
      });
    }
  }

  return items;
}

// ── Fingerprint ───────────────────────────────────────────────────────────────
//
// Content-based, not line-based: a finding keeps its identity (and any ack)
// when unrelated edits shift its line number. Per the shared-scan-service
// anti-pattern, never fingerprint on startLine.

function fingerprint(item) {
  return sha1(`${item.kind}:${item.file}:${item.name}:${item.content}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function detectTypeEscapes(
  root,
  { excludeDirs = [], categories = ALL_CATEGORIES } = {},
) {
  const absRoot = norm(path.resolve(root));
  const sourceFiles = await collectSourceFiles(absRoot, excludeDirs);
  const wanted = new Set(categories);
  const items = [];

  for (const abs of sourceFiles) {
    let src;
    try {
      const buf = await fsPromises.readFile(abs);
      if (buf.length > MAX_FILE_BYTES) continue;
      src = buf.toString("utf8");
    } catch {
      continue;
    }
    const rel = relPath(absRoot, abs);
    const scriptKind = abs.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(
      abs,
      src,
      ts.ScriptTarget.Latest,
      true,
      scriptKind,
    );
    items.push(...detectInFile(sf, rel, wanted));
  }

  return items.map((item) => ({ ...item, fingerprint: fingerprint(item) }));
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (isCliEntry(import.meta.url, "type-escape-detect.mjs")) {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf("--root");
  const root = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();
  const excludeIdx = args.indexOf("--exclude-dirs");
  const excludeDirs =
    excludeIdx >= 0 ? args[excludeIdx + 1].split(",").filter(Boolean) : [];
  const catIdx = args.indexOf("--categories");
  const categories =
    catIdx >= 0 ? args[catIdx + 1].split(",").filter(Boolean) : ALL_CATEGORIES;

  detectTypeEscapes(root, { excludeDirs, categories })
    .then((items) => {
      process.stdout.write(JSON.stringify(items));
    })
    .catch((e) => {
      process.stderr.write((e?.message ?? String(e)) + "\n");
      process.exit(1);
    });
}
