import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeadCodePanel } from '../src/components/DeadCodePanel';
import type { DeadCodeItem, ScanPaneApi } from '../src/types';

const ITEM: DeadCodeItem = {
  kind: 'unused-export',
  file: 'src/util.ts',
  name: 'oldHelper',
  startLine: 12,
  detail: "Exported 'oldHelper' has no references anywhere in the workspace",
  fingerprint: 'fp-1',
  snippet: 'export function oldHelper() {\n  return 1;\n}',
};

function mockApi(items: DeadCodeItem[]): ScanPaneApi<DeadCodeItem> {
  return {
    scan: vi.fn(async () => ({ items, ackedFingerprints: [] })),
    listAck: vi.fn(async () => []),
    listExclude: vi.fn(async () => []),
    ack: vi.fn(async () => []),
    excludeDir: vi.fn(async () => []),
  };
}

describe('DeadCodePanel', () => {
  it('renders a finding as a line-numbered snippet card and opens the file when clicked anywhere', async () => {
    const onOpenFile = vi.fn();
    render(<DeadCodePanel repoPath="/repo" api={mockApi([ITEM])} onOpenFile={onOpenFile} />);
    await userEvent.click(screen.getByTitle('Scan for dead code'));

    // Snippet is shown with real line numbers — no accordion expand needed.
    expect(await screen.findByText('export function oldHelper() {')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();

    // Clicking the snippet body (not a link) opens the file at its line.
    await userEvent.click(screen.getByText('export function oldHelper() {'));
    expect(onOpenFile).toHaveBeenCalledWith('/repo/src/util.ts', 'util.ts', 12);
  });
});
