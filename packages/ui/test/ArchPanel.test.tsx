import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
