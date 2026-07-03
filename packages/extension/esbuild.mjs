// Build the VS Code extension and its MCP servers with esbuild.
//
// The MCP servers live in the @code-workbench/mcp-core workspace package.
// esbuild resolves them through the package's `exports` map and bundles each
// into a self-contained file — so the packaged .vsix consumes the shared
// package directly, with no synced copy and no node_modules shipped.

import esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const watch = process.argv.includes('--watch');

// The clone detector parses code with tree-sitter, whose grammar `.wasm`
// files and the `web-tree-sitter` runtime `.wasm` are loaded at runtime
// relative to the bundled detector (see mcp-core/ast-core.mjs). esbuild only
// bundles JS, so without this copy step the packaged extension has no
// grammars — the duplicate scan then silently returns no results.
function copyTreeSitterAssets() {
  const coreDir = path.dirname(
    fileURLToPath(import.meta.resolve('@code-workbench/mcp-core/clone-detect.mjs')),
  );
  const destDir = fileURLToPath(new URL('dist/mcp-server/grammars/', import.meta.url));
  mkdirSync(destDir, { recursive: true });
  const grammarsDir = path.join(coreDir, 'grammars');
  for (const file of readdirSync(grammarsDir)) {
    if (file.endsWith('.wasm')) {
      cpSync(path.join(grammarsDir, file), path.join(destDir, file));
    }
  }
  cpSync(
    path.join(coreDir, 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm'),
    path.join(destDir, 'web-tree-sitter.wasm'),
  );
  console.log(`[esbuild] copied tree-sitter wasm assets to ${destDir}`);
}

// The sidebar Sessions panel renders each session's codicon in its row, so the
// webview needs the codicon font. esbuild only bundles JS; copy the stylesheet
// and its .ttf into dist/codicon/ so the webview can load them via asWebviewUri
// (the css's relative url(./codicon.ttf) then resolves alongside).
function copyCodiconAssets() {
  const cssPath = require.resolve('@vscode/codicons/dist/codicon.css');
  const srcDir = path.dirname(cssPath);
  const destDir = fileURLToPath(new URL('dist/codicon/', import.meta.url));
  mkdirSync(destDir, { recursive: true });
  for (const file of ['codicon.css', 'codicon.ttf']) {
    cpSync(path.join(srcDir, file), path.join(destDir, file));
  }
  console.log(`[esbuild] copied codicon font assets to ${destDir}`);
}

const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  logLevel: 'info',
};

const configs = [
  // Extension host entry — CommonJS, `vscode` is provided by the runtime.
  {
    ...common,
    entryPoints: { extension: 'src/extension.ts' },
    outdir: 'dist',
    format: 'cjs',
    sourcemap: true,
    external: ['vscode'],
  },
  // MCP servers — spawned as standalone `node <file>.mjs` processes.
  // Some mcp-core modules are CommonJS (.cjs); bundling them into an ESM
  // output needs a real `require` in scope for their `require('node:*')`
  // calls — esbuild otherwise emits a stub that throws at runtime.
  // The bundled `typescript` library also references `__filename` /
  // `__dirname`, which don't exist in ESM scope — shim those too.
  {
    ...common,
    entryPoints: {
      // Unified aggregator — the single MCP endpoint the extension registers.
      // It imports every server module (notify/tasks/arch/ast/dead-code/
      // type-safety) and their dynamic detector imports are inlined (splitting
      // is off), so the one bundle is self-contained at runtime.
      'mcp-server/code-server': require.resolve('@code-workbench/mcp-core/servers/code'),
      // Detector scripts spawned by scan-runner — not the wrapping MCP servers.
      'mcp-server/dead-code-detect': fileURLToPath(
        import.meta.resolve('@code-workbench/mcp-core/dead-code-detect.mjs'),
      ),
      'mcp-server/clone-detect': fileURLToPath(
        import.meta.resolve('@code-workbench/mcp-core/clone-detect.mjs'),
      ),
      'mcp-server/type-escape-detect': fileURLToPath(
        import.meta.resolve('@code-workbench/mcp-core/type-escape-detect.mjs'),
      ),
      // Code-search CLI spawned by scan-runner's runCodeSearch.
      'mcp-server/code-search': require.resolve('@code-workbench/mcp-core/servers/code-search'),
      // Semantic arch-card search CLI spawned by scan-runner's runArchSearch.
      'mcp-server/arch-search': fileURLToPath(
        import.meta.resolve('@code-workbench/mcp-core/arch-search.mjs'),
      ),
    },
    // @xenova/transformers is an optional, heavy dependency used only for
    // semantic reranking — code-search.mjs imports it dynamically and falls
    // back to BM25 if it's absent. The .vsix ships with --no-dependencies, so
    // leave it external: the dynamic import fails gracefully at runtime.
    external: ['@xenova/transformers'],
    outdir: 'dist',
    outExtension: { '.js': '.mjs' },
    format: 'esm',
    banner: {
      js: [
        "import { createRequire as __cwbCreateRequire } from 'node:module';",
        "import { fileURLToPath as __cwbFileURLToPath } from 'node:url';",
        "import { dirname as __cwbDirname } from 'node:path';",
        'const require = __cwbCreateRequire(import.meta.url);',
        'const __filename = __cwbFileURLToPath(import.meta.url);',
        'const __dirname = __cwbDirname(__filename);',
      ].join(' '),
    },
  },
];

// Sidebar webview React bundles. Each panel (Tasks, Dead Code, Duplicates)
// is a React app that renders the shared @code-workbench/ui components, so
// the extension's panels look identical to the Electron app's. Built for the
// browser (the webview runtime); React is bundled in, and the imported
// `@code-workbench/ui/styles.css` is emitted alongside as a sibling .css.
configs.push({
  bundle: true,
  logLevel: 'info',
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  jsx: 'automatic',
  sourcemap: true,
  minify: !watch,
  loader: { '.css': 'css' },
  // Force a SINGLE React copy into the bundle. pnpm can install two versions
  // (e.g. react@19.2.6 + 19.2.7) when workspace packages declare different
  // ranges; esbuild would then bundle the entry's React and @code-workbench/ui's
  // React separately. react-dom installs the hook dispatcher on one copy while
  // the ui components read it off the other (null) → "Cannot read properties of
  // null (reading 'useState')" and every panel mounts blank. Pinning every
  // react entry point to one resolved path guarantees one shared dispatcher.
  alias: {
    react: path.dirname(require.resolve('react/package.json')),
    'react-dom': path.dirname(require.resolve('react-dom/package.json')),
  },
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  entryPoints: {
    'webview/tasks': 'webview/tasks.tsx',
    'webview/deadcode': 'webview/deadcode.tsx',
    'webview/duplicates': 'webview/duplicates.tsx',
    'webview/typeescapes': 'webview/typeescapes.tsx',
    'webview/arch': 'webview/arch.tsx',
    'webview/search': 'webview/search.tsx',
  },
  outdir: 'dist',
});

for (const config of configs) {
  if (watch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
  } else {
    await esbuild.build(config);
  }
}

copyTreeSitterAssets();
copyCodiconAssets();
