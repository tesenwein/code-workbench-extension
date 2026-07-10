import { beforeEach, describe, expect, it } from 'vitest';
import { executedCommands } from './stubs/vscode';
import { applyUpdateState, compareVersions, pickVsix } from '../src/update';

const AVAILABLE_VERSION_KEY = 'codeWorkbench.update.availableVersion';

describe('applyUpdateState', () => {
  const setup = () => {
    const store = new Map<string, unknown>();
    const badges: Array<{ count: number; tooltip: string }> = [];
    const ctx = {
      globalState: {
        get: (key: string) => store.get(key),
        update: (key: string, value: unknown) => {
          if (value === undefined) store.delete(key);
          else store.set(key, value);
          return Promise.resolve();
        },
      },
    } as never;
    const brandView = {
      setBadge: (count: number, tooltip: string) => badges.push({ count, tooltip }),
    };
    return { store, badges, ctx, brandView };
  };

  beforeEach(() => {
    executedCommands.length = 0;
  });

  it('persists the tag, sets the context key and badges the view', async () => {
    const { store, badges, ctx, brandView } = setup();
    await applyUpdateState(ctx, brandView, 'v1.2.3');
    expect(store.get(AVAILABLE_VERSION_KEY)).toBe('v1.2.3');
    expect(executedCommands).toEqual([['setContext', 'codeWorkbench.updateAvailable', true]]);
    expect(badges).toEqual([{ count: 1, tooltip: 'Code Workbench v1.2.3 is available' }]);
  });

  it('clears everything when there is no available version', async () => {
    const { store, badges, ctx, brandView } = setup();
    await applyUpdateState(ctx, brandView, 'v1.2.3');
    executedCommands.length = 0;
    await applyUpdateState(ctx, brandView, undefined);
    expect(store.has(AVAILABLE_VERSION_KEY)).toBe(false);
    expect(executedCommands).toEqual([['setContext', 'codeWorkbench.updateAvailable', false]]);
    expect(badges.at(-1)).toEqual({ count: 0, tooltip: '' });
  });
});

describe('compareVersions', () => {
  it('treats a leading v as noise', () => {
    expect(compareVersions('v0.1.21', '0.1.21')).toBe(0);
  });

  it('orders by numeric segment, not lexically', () => {
    expect(compareVersions('0.1.21', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('v0.2.0', '0.10.0')).toBeLessThan(0);
  });

  it('pads missing segments with zero', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
  });

  it('ignores prerelease suffixes', () => {
    expect(compareVersions('v1.2.0-beta.1', '1.2.0')).toBe(0);
  });
});

describe('pickVsix', () => {
  const release = (names: string[]) => ({
    tag_name: 'v1.0.0',
    html_url: '',
    assets: names.map((name) => ({ name, browser_download_url: `https://x/${name}` })),
  });

  it('finds the vsix among other assets', () => {
    expect(pickVsix(release(['sha256.txt', 'code-workbench-1.0.0.vsix']))?.name).toBe(
      'code-workbench-1.0.0.vsix',
    );
  });

  it('returns undefined when the release ships no vsix', () => {
    expect(pickVsix(release(['sha256.txt']))).toBeUndefined();
  });
});
