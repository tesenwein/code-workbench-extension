import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DuplicatesPanel } from '../src/components/DuplicatesPanel';
import type { DuplicateGroup, ScanPaneApi } from '../src/types';

const GROUP_WITH_SNIPPETS: DuplicateGroup = {
  cloneType: 'renamed',
  similarity: 0.94,
  count: 2,
  fingerprint: 'fp-1',
  members: [
    {
      file: '/repo/src/a.ts',
      name: 'parseOne',
      kind: 'function',
      startLine: 10,
      endLine: 20,
      lines: 11,
      snippet: 'function parseOne(x) {\n  return x;',
    },
    {
      file: '/repo/src/b.ts',
      name: 'parseTwo',
      kind: 'function',
      startLine: 30,
      endLine: 40,
      lines: 11,
      snippet: 'function parseTwo(y) {\n  return y;',
    },
  ],
};

function mockApi(groups: DuplicateGroup[]): ScanPaneApi<DuplicateGroup> {
  return {
    scan: vi.fn(async () => ({ items: groups, ackedFingerprints: [] })),
    listAck: vi.fn(async () => []),
    listExclude: vi.fn(async () => []),
    ack: vi.fn(async () => []),
    excludeDir: vi.fn(async () => []),
  };
}

describe('DuplicatesPanel', () => {
  it('renders members side by side with snippets and line numbers when present', async () => {
    render(<DuplicatesPanel repoPath="/repo" api={mockApi([GROUP_WITH_SNIPPETS])} />);
    // trigger a scan via the pane-header refresh, then expand the group row
    await userEvent.click(screen.getByTitle('Scan for duplicate code'));
    await userEvent.click(await screen.findByText(/parseOne/, { selector: '.dup-group-title' }));
    // both member snippets visible, with real start line numbers
    expect(screen.getByText('function parseOne(x) {')).toBeInTheDocument();
    expect(screen.getByText('function parseTwo(y) {')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    // snippets shorter than the member body show the truncation hint
    expect(screen.getAllByText(/more line\(s\)/).length).toBe(2);
  });

  it('opens the file when a member snippet card is clicked (whole card is clickable)', async () => {
    const onOpenFile = vi.fn();
    render(
      <DuplicatesPanel
        repoPath="/repo"
        api={mockApi([GROUP_WITH_SNIPPETS])}
        onOpenFile={onOpenFile}
      />,
    );
    await userEvent.click(screen.getByTitle('Scan for duplicate code'));
    await userEvent.click(await screen.findByText(/parseOne/, { selector: '.dup-group-title' }));
    // Click the snippet code body — not a link — the whole card should open.
    await userEvent.click(screen.getByText('function parseOne(x) {'));
    expect(onOpenFile).toHaveBeenCalledWith('/repo//repo/src/a.ts', 'a.ts', 10);
  });

  it('falls back to the compact member list when no snippets are attached', async () => {
    const group: DuplicateGroup = {
      ...GROUP_WITH_SNIPPETS,
      members: GROUP_WITH_SNIPPETS.members.map(({ snippet: _snippet, ...m }) => m),
    };
    render(<DuplicatesPanel repoPath="/repo" api={mockApi([group])} />);
    await userEvent.click(screen.getByTitle('Scan for duplicate code'));
    await userEvent.click(await screen.findByText(/parseOne/, { selector: '.dup-group-title' }));
    expect(screen.getByText('parseTwo')).toBeInTheDocument();
    expect(document.querySelector('.dup-snippets')).toBeNull();
    expect(document.querySelector('.dup-members')).not.toBeNull();
  });
});
