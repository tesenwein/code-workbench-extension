import { describe, expect, it } from 'vitest';
import { sumTranscriptUsage } from '../src/sessionLaunch';

const line = (id: string, input: number, output: number, cacheRead = 0, cacheCreate = 0) =>
  JSON.stringify({
    type: 'assistant',
    message: {
      id,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreate,
      },
    },
  });

describe('sumTranscriptUsage', () => {
  it('sums every assistant usage block', () => {
    const raw = [line('a', 10, 5, 100, 20), line('b', 1, 2), '{"type":"user"}', 'not json'].join('\n');
    expect(sumTranscriptUsage(raw)).toEqual({ input: 11, output: 7, cacheRead: 100, cacheCreate: 20 });
  });

  it('counts a re-written streamed turn once (last entry wins)', () => {
    const raw = [line('a', 10, 1), line('a', 10, 9)].join('\n');
    expect(sumTranscriptUsage(raw)).toEqual({ input: 10, output: 9, cacheRead: 0, cacheCreate: 0 });
  });

  it('returns zeros for an empty transcript', () => {
    expect(sumTranscriptUsage('')).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });
  });
});
