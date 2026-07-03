import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { themeTokenDecls } from '../src/webviewTheme';

const stylesCss = readFileSync(resolve(__dirname, '../../ui/src/styles.css'), 'utf8');

/** Workbench tokens referenced by ui/styles.css (excludes VS Code's own --vscode-* vars). */
function tokensUsedInStyles(): string[] {
  const names = new Set<string>();
  for (const m of stylesCss.matchAll(/var\((--[a-z0-9-]+)/g)) {
    if (!m[1].startsWith('--vscode-')) names.add(m[1]);
  }
  return [...names];
}

describe('themeTokenDecls', () => {
  it('declares every token that ui/styles.css consumes', () => {
    for (const surface of ['sidebar', 'editor'] as const) {
      const decls = themeTokenDecls(surface);
      const missing = tokensUsedInStyles().filter((t) => !decls.includes(`${t}:`));
      expect(missing).toEqual([]);
    }
  });

  it('falls back to the Paper & Clay palette when theme variables are absent', () => {
    const decls = themeTokenDecls('editor');
    expect(decls).toContain('#1c1b19');
    expect(decls).toContain('#d97757');
  });
});
