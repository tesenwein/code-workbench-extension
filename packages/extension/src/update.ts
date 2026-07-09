/* Self-update for the sideloaded VSIX.
 *
 * The extension ships as a .vsix asset on each GitHub release rather than
 * through the Marketplace, so VS Code never updates it on its own. This module
 * is that missing updater: compare the installed version against the latest
 * release, download the asset, and hand it to the built-in installer. */

import * as vscode from 'vscode';

/** packageJSON.repository points at the old monorepo path; releases live here. */
const REPO = 'tesenwein/code-workbench-extension';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

const LAST_CHECK_KEY = 'codeWorkbench.update.lastCheck';
const SKIPPED_VERSION_KEY = 'codeWorkbench.update.skippedVersion';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Unauthenticated GitHub API allows 60 requests/hour per IP — keep it snappy. */
const REQUEST_TIMEOUT_MS = 15_000;

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

/** Numeric-segment comparison; returns >0 when `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const av = parse(a);
  const bv = parse(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const d = (av[i] ?? 0) - (bv[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'code-workbench-extension',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export function pickVsix(release: Release): ReleaseAsset | undefined {
  return release.assets.find((a) => a.name.endsWith('.vsix'));
}

async function downloadVsix(
  ctx: vscode.ExtensionContext,
  asset: ReleaseAsset,
): Promise<vscode.Uri> {
  const res = await fetch(asset.browser_download_url, {
    headers: { 'User-Agent': 'code-workbench-extension' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await vscode.workspace.fs.createDirectory(ctx.globalStorageUri);
  const target = vscode.Uri.joinPath(ctx.globalStorageUri, asset.name);
  await vscode.workspace.fs.writeFile(target, bytes);
  return target;
}

async function installVsix(uri: vscode.Uri): Promise<void> {
  await vscode.commands.executeCommand('workbench.extensions.installExtension', uri);
  await vscode.workspace.fs.delete(uri).then(undefined, () => undefined);
}

async function downloadAndInstall(
  ctx: vscode.ExtensionContext,
  release: Release,
  asset: ReleaseAsset,
): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Installing ${release.tag_name}…` },
    async () => {
      const vsix = await downloadVsix(ctx, asset);
      await installVsix(vsix);
    },
  );
  const reload = await vscode.window.showInformationMessage(
    `Code Workbench ${release.tag_name} installed. Reload to activate it.`,
    'Reload Window',
  );
  if (reload) await vscode.commands.executeCommand('workbench.action.reloadWindow');
}

/**
 * Compare against the latest release and offer to install it.
 * `silent` suppresses the up-to-date and failure notifications, and honours a
 * previously skipped version — used for the throttled check on activation.
 */
export async function checkForUpdates(
  ctx: vscode.ExtensionContext,
  opts: { silent: boolean },
): Promise<void> {
  const current = String(ctx.extension.packageJSON.version ?? '0.0.0');

  let release: Release;
  try {
    release = await fetchJson<Release>(LATEST_RELEASE_URL);
  } catch (err) {
    if (!opts.silent) {
      void vscode.window.showErrorMessage(
        `Could not check for updates: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  if (compareVersions(release.tag_name, current) <= 0) {
    if (!opts.silent) {
      void vscode.window.showInformationMessage(`Code Workbench ${current} is up to date.`);
    }
    return;
  }

  if (opts.silent && ctx.globalState.get<string>(SKIPPED_VERSION_KEY) === release.tag_name) return;

  const asset = pickVsix(release);
  if (!asset) {
    if (!opts.silent) {
      void vscode.window.showErrorMessage(
        `Release ${release.tag_name} has no .vsix asset to install.`,
      );
    }
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `Code Workbench ${release.tag_name} is available (you have ${current}).`,
    'Update Now',
    'Release Notes',
    'Skip This Version',
  );
  if (choice === 'Release Notes') {
    await vscode.env.openExternal(vscode.Uri.parse(release.html_url));
    return;
  }
  if (choice === 'Skip This Version') {
    await ctx.globalState.update(SKIPPED_VERSION_KEY, release.tag_name);
    return;
  }
  if (choice !== 'Update Now') return;

  try {
    await downloadAndInstall(ctx, release, asset);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Update failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Registers the manual command and runs a throttled background check. */
export function registerUpdateCommand(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeWorkbench.checkForUpdates', async () => {
      await ctx.globalState.update(SKIPPED_VERSION_KEY, undefined);
      await ctx.globalState.update(LAST_CHECK_KEY, Date.now());
      await checkForUpdates(ctx, { silent: false });
    }),
  );

  if (
    !vscode.workspace.getConfiguration('codeWorkbench').get<boolean>('autoCheckForUpdates', true)
  ) {
    return;
  }
  const last = ctx.globalState.get<number>(LAST_CHECK_KEY, 0);
  if (Date.now() - last < CHECK_INTERVAL_MS) return;
  void (async () => {
    await ctx.globalState.update(LAST_CHECK_KEY, Date.now());
    await checkForUpdates(ctx, { silent: true });
  })();
}
