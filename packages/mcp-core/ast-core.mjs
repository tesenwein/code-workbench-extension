// Shared tree-sitter parser state and symbol extraction, used by ast-server.mjs
// and code-search.mjs.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Not named `__dirname`: this module is bundled into the ESM MCP server
// outputs, whose esbuild banner already injects a `__dirname` shim — a bare
// `const __dirname` here collides with it ("already been declared").
const __astCoreDir = path.dirname(fileURLToPath(import.meta.url));
export const GRAMMARS_DIR = path.join(__astCoreDir, "grammars");
const WEB_TREE_SITTER_DIR = path.join(
  __astCoreDir,
  "node_modules",
  "web-tree-sitter",
);

// ── Language map ──────────────────────────────────────────────────────────────

export const EXT_TO_LANG = /** @type {Record<string,string>} */ ({
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
});

export const LANG_TO_WASM = /** @type {Record<string,string>} */ ({
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
});

// ── Parser state ──────────────────────────────────────────────────────────────

let Parser = null;
let Language = null;
/** @type {Promise<void>|null} */
let initPromise = null;
/** @type {Map<string,{parser:any,lang:any}>} */
const parserCache = new Map();

export async function loadTreeSitter() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const mod = await import("web-tree-sitter");
      // 0.26.x: named exports; 0.24.x: default export is the Parser class
      // 0.26.x exports named { Parser, Language }; 0.24.x has default export = Parser class
      const ParserClass =
        mod.Parser ?? mod.default?.Parser ?? mod.default ?? mod;
      const LanguageClass =
        mod.Language ?? mod.default?.Language ?? ParserClass.Language;
      // The runtime wasm sits in node_modules when running from the source
      // tree, but is copied next to the grammars when bundled into the
      // packaged VS Code extension — check both.
      await ParserClass.init({
        locateFile: (name) => {
          for (const dir of [WEB_TREE_SITTER_DIR, GRAMMARS_DIR, __astCoreDir]) {
            const candidate = path.join(dir, name);
            if (existsSync(candidate)) return candidate;
          }
          return path.join(WEB_TREE_SITTER_DIR, name);
        },
      });
      Parser = ParserClass;
      Language = LanguageClass;
    } catch (err) {
      initPromise = null;
      process.stderr.write(
        `[ast-core] tree-sitter init failed: ${err?.message ?? err}\n`,
      );
      throw err;
    }
  })();
  return initPromise;
}

export async function getParser(language) {
  if (parserCache.has(language)) return parserCache.get(language);

  const wasmFile = LANG_TO_WASM[language];
  if (!wasmFile) return null;

  const wasmPath = path.join(GRAMMARS_DIR, wasmFile);
  if (!existsSync(wasmPath)) return null;

  try {
    await loadTreeSitter();
    const lang = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(lang);
    const entry = { parser, lang };
    parserCache.set(language, entry);
    return entry;
  } catch (err) {
    process.stderr.write(
      `[ast-core] failed to load grammar for "${language}": ${err?.message ?? err}\n`,
    );
    return null;
  }
}

export function detectLanguage(filePath) {
  return EXT_TO_LANG[path.extname(filePath).toLowerCase()] ?? null;
}

// ── AST helpers ───────────────────────────────────────────────────────────────

export function nodeRange(node) {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
}

export function isAsync(node, _source) {
  for (const c of node.children) if (c.type === "async") return true;
  return false;
}

export function isExported(node) {
  return node.parent?.type === "export_statement";
}

// ── TypeScript / JavaScript extraction ───────────────────────────────────────

export function hasChildOfType(node, type) {
  for (const c of node.children) if (c.type === type) return true;
  return false;
}

export function extractClassMembers(bodyNode, source) {
  if (!bodyNode) return [];
  const members = [];

  for (const child of bodyNode.namedChildren) {
    const type = child.type;
    if (type === "method_definition" || type === "abstract_method_signature") {
      const nameNode = child.childForFieldName("name");
      const access =
        child.children.find((c) => c.type === "accessibility_modifier")?.text ??
        "public";
      members.push({
        kind: "method",
        name: nameNode?.text ?? "<anonymous>",
        ...nodeRange(child),
        static: hasChildOfType(child, "static"),
        async: hasChildOfType(child, "async"),
        access,
      });
    } else if (
      type === "field_definition" ||
      type === "public_field_definition"
    ) {
      const nameNode = child.childForFieldName("name");
      if (nameNode) {
        members.push({
          kind: "property",
          name: nameNode.text,
          ...nodeRange(child),
        });
      }
    }
  }
  return members;
}

export function extractTsSymbols(rootNode, source) {
  const symbols = [];
  const imports = [];

  function visitDeclaration(node) {
    switch (node.type) {
      case "import_statement": {
        const fromNode = node.namedChildren.find(
          (n) => n.type === "string" || n.type === "string_fragment",
        );
        const from = fromNode?.text?.replace(/^['"`]|['"`]$/g, "") ?? "?";
        const names = [];
        const clause = node.namedChildren.find(
          (n) => n.type === "import_clause",
        );
        if (clause) {
          for (const imp of clause.namedChildren) {
            if (imp.type === "identifier") names.push(imp.text);
            else if (imp.type === "named_imports") {
              for (const spec of imp.namedChildren) {
                if (spec.type === "import_specifier") {
                  names.push(spec.namedChildren[0]?.text ?? "?");
                }
              }
            } else if (imp.type === "namespace_import") {
              const id = imp.namedChildren[0];
              if (id) names.push(`* as ${id.text}`);
            }
          }
        }
        imports.push({ from, names });
        break;
      }

      case "function_declaration":
      case "generator_function_declaration": {
        const nameNode = node.childForFieldName("name");
        symbols.push({
          kind: "function",
          name: nameNode?.text ?? "<anonymous>",
          ...nodeRange(node),
          exported: isExported(node),
          async: isAsync(node, source),
        });
        break;
      }

      case "lexical_declaration":
      case "variable_declaration": {
        for (const decl of node.namedChildren) {
          if (decl.type !== "variable_declarator") continue;
          const nameNode = decl.childForFieldName("name");
          const value = decl.childForFieldName("value");
          if (
            value?.type === "arrow_function" ||
            value?.type === "function_expression"
          ) {
            symbols.push({
              kind: "function",
              name: nameNode?.text ?? "<anonymous>",
              ...nodeRange(decl),
              exported: isExported(node),
              async: isAsync(value, source),
            });
          }
        }
        break;
      }

      case "class_declaration":
      case "abstract_class_declaration": {
        const nameNode = node.childForFieldName("name");
        const bodyNode = node.childForFieldName("body");
        symbols.push({
          kind: "class",
          name: nameNode?.text ?? "<anonymous>",
          ...nodeRange(node),
          exported: isExported(node),
          abstract: node.type === "abstract_class_declaration",
          members: extractClassMembers(bodyNode, source),
        });
        break;
      }

      case "interface_declaration": {
        const nameNode = node.childForFieldName("name");
        symbols.push({
          kind: "interface",
          name: nameNode?.text ?? "<anonymous>",
          ...nodeRange(node),
          exported: isExported(node),
        });
        break;
      }

      case "type_alias_declaration": {
        const nameNode = node.childForFieldName("name");
        symbols.push({
          kind: "type",
          name: nameNode?.text ?? "<anonymous>",
          ...nodeRange(node),
          exported: isExported(node),
        });
        break;
      }

      case "enum_declaration": {
        const nameNode = node.childForFieldName("name");
        symbols.push({
          kind: "enum",
          name: nameNode?.text ?? "<anonymous>",
          ...nodeRange(node),
          exported: isExported(node),
        });
        break;
      }

      case "export_statement": {
        const decl = node.childForFieldName("declaration");
        if (decl) visitDeclaration(decl);
        break;
      }
    }
  }

  for (const child of rootNode.namedChildren) {
    visitDeclaration(child);
  }
  return { symbols, imports };
}

// ── Python extraction ─────────────────────────────────────────────────────────

export function extractPythonSymbols(rootNode, source) {
  const symbols = [];
  const imports = [];

  function visitTopLevel(node) {
    switch (node.type) {
      case "import_statement": {
        const names = node.namedChildren
          .filter(
            (n) => n.type === "dotted_name" || n.type === "aliased_import",
          )
          .map((n) =>
            n.type === "aliased_import"
              ? `${n.namedChildren[0]?.text} as ${n.namedChildren[1]?.text}`
              : n.text,
          );
        imports.push({ from: "", names });
        break;
      }

      case "import_from_statement": {
        const modNode = node.namedChildren.find(
          (n) => n.type === "dotted_name" || n.type === "relative_import",
        );
        const from = modNode?.text ?? "?";
        const names = node.namedChildren
          .filter(
            (n) =>
              n !== modNode &&
              (n.type === "dotted_name" || n.type === "aliased_import"),
          )
          .map((n) =>
            n.type === "aliased_import"
              ? `${n.namedChildren[0]?.text} as ${n.namedChildren[1]?.text}`
              : n.text,
          );
        if (node.namedChildren.some((n) => n.type === "wildcard_import"))
          names.push("*");
        imports.push({ from, names });
        break;
      }

      case "function_definition": {
        const nameNode = node.childForFieldName("name");
        symbols.push({
          kind: "function",
          name: nameNode?.text ?? "<anonymous>",
          ...nodeRange(node),
          async: isAsync(node, source),
          exported: !nameNode?.text?.startsWith("_"),
        });
        break;
      }

      case "class_definition": {
        const nameNode = node.childForFieldName("name");
        const bodyNode = node.childForFieldName("body");
        const members = [];
        if (bodyNode) {
          for (const child of bodyNode.namedChildren) {
            if (child.type === "function_definition") {
              const mn = child.childForFieldName("name");
              members.push({
                kind: "method",
                name: mn?.text ?? "<anonymous>",
                ...nodeRange(child),
                async: isAsync(child, source),
              });
            }
          }
        }
        symbols.push({
          kind: "class",
          name: nameNode?.text ?? "<anonymous>",
          ...nodeRange(node),
          exported: !nameNode?.text?.startsWith("_"),
          members,
        });
        break;
      }

      case "decorated_definition": {
        const inner = node.namedChildren.find(
          (n) =>
            n.type === "function_definition" || n.type === "class_definition",
        );
        if (inner) visitTopLevel(inner);
        break;
      }
    }
  }

  for (const child of rootNode.namedChildren) {
    visitTopLevel(child);
  }
  return { symbols, imports };
}
