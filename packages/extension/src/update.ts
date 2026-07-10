/* Self-update for the sideloaded VSIX.
 *
 * The extension ships as a .vsix asset on each GitHub release rather than
 * through the Marketplace, so VS Code never updates it on its own. This module
 * is that missing updater: compare the installed version against the latest
 * release, download the asset, and hand it to the built-in installer. */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { BrandViewProvider } from './brandView';

/** packageJSON.repository points at the old monorepo path; releases live here. */
const REPO = 'tesenwein/code-workbench-extension';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

const LAST_CHECK_KEY = 'codeWorkbench.update.lastCheck';
const SKIPPED_VERSION_KEY = 'codeWorkbench.update.skippedVersion';
const AVAILABLE_VERSION_KEY = 'codeWorkbench.update.availableVersion';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Unauthenticated GitHub API allows 60 requests/hour per IP — keep it snappy. */
const REQUEST_TIMEOUT_MS = 15_000;
/** The VSIX itself is a few MB — generous, but bounded. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

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

/** The state the brand view's title-bar icon and badge are derived from. */
export type UpdateStateHost = Pick<vscode.ExtensionContext, 'globalState'>;
export type UpdateBadgeTarget = Pick<BrandViewProvider, 'setBadge'>;

/**
 * Single writer for "an update is available": persists the tag, drives the
 * `codeWorkbench.updateAvailable` context key (icon swap) and the view badge.
 * Pass `undefined` to clear all three.
 */
export async function applyUpdateState(
  ctx: UpdateStateHost,
  brandView: UpdateBadgeTarget,
  tag: string | undefined,
): Promise<void> {
  await ctx.globalState.update(AVAILABLE_VERSION_KEY, tag);
  await vscode.commands.executeCommand('setContext', 'codeWorkbench.updateAvailable', Boolean(tag));
  brandView.setBadge(tag ? 1 : 0, tag ? `Code Workbench ${tag} is available` : '');
}

/**
 * VS Code's `getManifest` only accepts `file:` (or `vscode-remote:`) URIs and
 * rejects anything else with a bare `No Servers`, so the VSIX has to land on a
 * real filesystem path — `globalStorageUri` is not guaranteed to be one.
 */
async function downloadVsix(asset: ReleaseAsset, signal: AbortSignal): Promise<vscode.Uri> {
  const res = await fetch(asset.browser_download_url, {
    headers: { 'User-Agent': 'code-workbench-extension' },
    redirect: 'follow',
    signal,
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-workbench-update-'));
  try {
    const target = path.join(dir, asset.name);
    await fs.writeFile(target, bytes);
    return vscode.Uri.file(target);
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

async function installVsix(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.extensions.installExtension', uri);
  } finally {
    await fs.rm(path.dirname(uri.fsPath), { recursive: true, force: true }).catch(() => undefined);
  }
}

async function downloadAndInstall(release: Release, asset: ReleaseAsset): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Installing ${release.tag_name}…`,
      cancellable: true,
    },
    async (_progress, token) => {
      // Cap the download so a stalled connection can't spin the notification
      // forever; the cancel button aborts it too.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      const sub = token.onCancellationRequested(() => controller.abort());
      try {
        const vsix = await downloadVsix(asset, controller.signal);
        await installVsix(vsix);
      } finally {
        clearTimeout(timer);
        sub.dispose();
      }
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
  brandView: UpdateBadgeTarget,
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
    await applyUpdateState(ctx, brandView, undefined);
    if (!opts.silent) {
      void vscode.window.showInformationMessage(`Code Workbench ${current} is up to date.`);
    }
    return;
  }

  await applyUpdateState(ctx, brandView, release.tag_name);

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
    await applyUpdateState(ctx, brandView, undefined);
    return;
  }
  if (choice !== 'Update Now') return;

  try {
    await downloadAndInstall(release, asset);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const open = await vscode.window.showErrorMessage(
      `Update failed: ${message}`,
      'Open Release Page',
    );
    if (open) await vscode.env.openExternal(vscode.Uri.parse(release.html_url));
  }
}

/** Registers the manual command and runs a throttled background check. */
export function registerUpdateCommand(
  ctx: vscode.ExtensionContext,
  brandView: UpdateBadgeTarget,
): void {
  // A prior run may have found an update; the context key and badge don't
  // survive a reload, so replay the persisted state before any new check.
  // Awaited (not fire-and-forget) so a command invoked right after activation
  // can't race this write and have its result clobbered.
  const known = ctx.globalState.get<string>(AVAILABLE_VERSION_KEY);
  const current = String(ctx.extension.packageJSON.version ?? '0.0.0');
  const replayed = applyUpdateState(
    ctx,
    brandView,
    known && compareVersions(known, current) > 0 ? known : undefined,
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeWorkbench.checkForUpdates', async () => {
      await replayed;
      await ctx.globalState.update(SKIPPED_VERSION_KEY, undefined);
      await ctx.globalState.update(LAST_CHECK_KEY, Date.now());
      await checkForUpdates(ctx, brandView, { silent: false });
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
    await replayed;
    await ctx.globalState.update(LAST_CHECK_KEY, Date.now());
    await checkForUpdates(ctx, brandView, { silent: true });
  })();
}
