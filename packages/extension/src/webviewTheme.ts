/* Shared design-token block for every Code Workbench webview.
 *
 * All panels consume the same token names (--bg-*, --fg-*, --clay*, --border,
 * …). Instead of hardcoding the Paper & Clay palette, each token derives from
 * the active VS Code theme's --vscode-* variables — elevation and fade steps
 * via color-mix() — so the panels adapt to whatever theme the user selected
 * (light themes included). The former Paper & Clay values remain as fallbacks
 * for the rare theme that doesn't define a source variable. */

/** Which VS Code surface the webview sits on — decides the base background. */
export type ThemeSurface = 'sidebar' | 'editor';

/** CSS custom-property declarations (no `:root` wrapper) for one surface. */
export function themeTokenDecls(surface: ThemeSurface): string {
  const bg0 =
    surface === 'sidebar'
      ? 'var(--vscode-sideBar-background, var(--vscode-editor-background, #1c1b19))'
      : 'var(--vscode-editor-background, #1c1b19)';
  return `
  color-scheme: light dark;
  --bg-0: ${bg0};
  --bg-1: color-mix(in srgb, var(--fg-0) 4%, var(--bg-0));
  --bg-2: color-mix(in srgb, var(--fg-0) 8%, var(--bg-0));
  --bg-3: color-mix(in srgb, var(--fg-0) 13%, var(--bg-0));
  --bg-card: color-mix(in srgb, var(--fg-0) 2%, var(--bg-0));
  --fg-0: var(--vscode-foreground, #f3f0e7);
  --fg-1: color-mix(in srgb, var(--fg-0) 82%, var(--bg-0));
  --fg-2: var(--vscode-descriptionForeground, color-mix(in srgb, var(--fg-0) 58%, var(--bg-0)));
  --fg-3: color-mix(in srgb, var(--fg-0) 40%, var(--bg-0));
  --fg-4: color-mix(in srgb, var(--fg-0) 27%, var(--bg-0));
  --clay: var(--vscode-button-background, var(--vscode-focusBorder, #d97757));
  --clay-bright: color-mix(in srgb, var(--clay) 78%, var(--fg-0));
  --clay-deep: color-mix(in srgb, var(--clay) 72%, var(--bg-0));
  --clay-ghost: color-mix(in srgb, var(--clay) 12%, transparent);
  --clay-line: color-mix(in srgb, var(--clay) 32%, transparent);
  --border: var(--vscode-widget-border, var(--vscode-panel-border, color-mix(in srgb, var(--fg-0) 16%, var(--bg-0))));
  --border-soft: color-mix(in srgb, var(--fg-0) 10%, var(--bg-0));
  --rule: var(--border-soft);
  --ok: var(--vscode-charts-green, #7faa6e);
  --warn: var(--vscode-editorWarning-foreground, var(--vscode-charts-yellow, #cf9f4f));
  --danger: var(--vscode-errorForeground, #e0705e);
  --conflict: var(--vscode-errorForeground, #e85a4f);
  --conflict-bg: color-mix(in srgb, var(--conflict) 13%, transparent);
  --font-ui: var(--vscode-font-family, 'Hanken Grotesk', system-ui, -apple-system, sans-serif);
  --font-mono: var(--vscode-editor-font-family, 'JetBrains Mono', Menlo, Consolas, monospace);
  --font-serif: 'Newsreader', 'Iowan Old Style', Georgia, serif;
  --radius: 7px;
  --radius-sm: 5px;`;
}
