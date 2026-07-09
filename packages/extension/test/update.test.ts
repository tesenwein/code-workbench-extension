import { describe, expect, it } from 'vitest';
import { compareVersions, pickVsix } from '../src/update';

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
