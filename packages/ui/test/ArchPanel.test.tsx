import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArchPanel } from '../src/components/ArchPanel';
import type { ArchApi, ArchCard } from '../src/types';

function card(overrides: Partial<ArchCard> & { slug: string; name: string }): ArchCard {
  return {
    description: '',
    files: [],
    guidelines: [],
    anti_patterns: [],
    decisions: [],
    dependsOn: [],
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockApi(cards: ArchCard[]): ArchApi {
  return {
    list: vi.fn(async () => cards),
    upsert: vi.fn(),
    remove: vi.fn(async () => {}),
    openCard: vi.fn(async () => {}),
  };
}

const GATEWAY = card({
  slug: 'http-gateway',
  name: 'HTTP gateway, routing &amp; OAuth',
  description: 'Owns the raw node:http entrypoint &amp; route() dispatch',
});

describe('ArchPanel', () => {
  it('decodes HTML entities in card name and description', async () => {
    render(<ArchPanel repoPath="/repo" api={mockApi([GATEWAY])} />);
    expect(await screen.findByText('HTTP gateway, routing & OAuth')).toBeInTheDocument();
    expect(
      screen.getByText('Owns the raw node:http entrypoint & route() dispatch'),
    ).toBeInTheDocument();
  });

  it('no longer renders a Graph/List toggle', async () => {
    render(<ArchPanel repoPath="/repo" api={mockApi([GATEWAY])} />);
    await screen.findByText('HTTP gateway, routing & OAuth');
    expect(screen.queryByRole('button', { name: 'Graph' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'List' })).not.toBeInTheDocument();
  });

  it('orders results by api.search ranking and shows a semantic badge', async () => {
    const auth = card({ slug: 'auth', name: 'Auth service' });
    const db = card({ slug: 'db', name: 'Database layer' });
    const cache = card({ slug: 'cache', name: 'Cache pool' });
    const api = mockApi([auth, db, cache]);
    // Rank db first — unrelated to alphabetical slug order (auth < cache < db).
    api.search = vi.fn(async () => [
      { slug: 'db', score: 0.9 },
      { slug: 'cache', score: 0.4 },
      { slug: 'auth', score: 0.1 },
    ]);

    render(<ArchPanel repoPath="/repo" api={api} />);
    await screen.findByText('Auth service');

    await userEvent.type(screen.getByPlaceholderText('Search components…'), 'storage');

    await waitFor(() => expect(api.search).toHaveBeenCalledWith('storage'));
    await screen.findByText('semantic');
    // First rendered card name should be the top-ranked one, not alphabetical.
    const names = screen.getAllByText(/Auth service|Database layer|Cache pool/);
    expect(names[0]).toHaveTextContent('Database layer');
  });

  it('shows the empty state when neither semantic nor substring matches', async () => {
    const auth = card({ slug: 'auth', name: 'Auth service' });
    const api = mockApi([auth]);
    // Model present but no card cleared the relevance floor.
    api.search = vi.fn(async () => []);

    render(<ArchPanel repoPath="/repo" api={api} />);
    await screen.findByText('Auth service');

    await userEvent.type(screen.getByPlaceholderText('Search components…'), 'zzzqq');
    await waitFor(() => expect(api.search).toHaveBeenCalledWith('zzzqq'));

    expect(await screen.findByText(/No components match/)).toBeInTheDocument();
    expect(screen.queryByText('Auth service')).not.toBeInTheDocument();
  });

  it('falls back to substring filtering when api.search returns nothing', async () => {
    const auth = card({ slug: 'auth', name: 'Auth service' });
    const db = card({ slug: 'db', name: 'Database layer' });
    const api = mockApi([auth, db]);
    api.search = vi.fn(async () => []); // model unavailable

    render(<ArchPanel repoPath="/repo" api={api} />);
    await screen.findByText('Auth service');

    await userEvent.type(screen.getByPlaceholderText('Search components…'), 'auth');
    await waitFor(() => expect(api.search).toHaveBeenCalled());

    expect(screen.getByText('Auth service')).toBeInTheDocument();
    expect(screen.queryByText('Database layer')).not.toBeInTheDocument();
    expect(screen.queryByText('semantic')).not.toBeInTheDocument();
  });
});
