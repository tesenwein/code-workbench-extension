import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchPanel } from '../src/components/SearchPanel';
import type { CodeSearchResult, SearchApi } from '../src/types';

const RESULT: CodeSearchResult = {
  name: 'debounceGitPoll',
  kind: 'function',
  file: '/repo/src/git/poll.ts',
  startLine: 12,
  endLine: 40,
  score: 9.5,
  snippet: 'function debounceGitPoll() {\n  let timer;\n  return schedule;',
};

function mockApi(results: CodeSearchResult[]): SearchApi {
  return {
    search: vi.fn(async () => results),
    openFile: vi.fn(async () => {}),
  };
}

describe('SearchPanel', () => {
  it('runs the host-pushed query and renders result cards with snippet lines', async () => {
    const api = mockApi([RESULT]);
    render(
      <SearchPanel repoPath="/repo" api={api} externalQuery="debounce git" externalQueryKey={1} />,
    );
    expect(api.search).toHaveBeenCalledWith('debounce git');
    // repo-relative path with line, and a snippet line with its line number
    expect(await screen.findByText('src/git/poll.ts:12')).toBeInTheDocument();
    // the symbol name is present (split into highlight spans by the query match)
    expect(document.body.textContent).toContain('debounceGitPoll');
    expect(screen.getByText('12')).toBeInTheDocument();
    // snippet is truncated to endLine 40 → "more line(s)" indicator
    expect(screen.getByText(/more line\(s\)/)).toBeInTheDocument();
  });

  it('opens the file at the symbol line when a card is clicked', async () => {
    const api = mockApi([RESULT]);
    // query with no token overlapping the name, so the label is not split by highlighting
    render(<SearchPanel repoPath="/repo" api={api} externalQuery="zzz" externalQueryKey={1} />);
    await userEvent.click(await screen.findByText('debounceGitPoll'));
    expect(api.openFile).toHaveBeenCalledWith('/repo/src/git/poll.ts', 12);
  });

  it('shows an empty state when nothing matches', async () => {
    const api = mockApi([]);
    render(<SearchPanel repoPath="/repo" api={api} externalQuery="nope" externalQueryKey={1} />);
    expect(await screen.findByText(/No code matches for/)).toBeInTheDocument();
  });
});
