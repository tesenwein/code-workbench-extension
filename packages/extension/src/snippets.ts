/* Best-effort snippet extraction for the editor-tab result pages.
 *
 * Scan/search results carry only a location (file + start/end line) or a
 * short ranking snippet; the full-page views want real code. Files are read
 * on demand with a small cache per widening pass. */

import { promises as fs } from 'fs';

export interface LineRange {
  file: string;
  startLine: number;
  endLine: number;
}

/** Read the symbol body at `range`, capped at `maxLines`. Returns `fallback`
 *  (default '') if the file can't be read. */
export async function widenSnippet(
  range: LineRange,
  maxLines: number,
  fallback = '',
  cache?: Map<string, Promise<string[] | undefined>>,
): Promise<string> {
  const lines = await readLines(range.file, cache);
  if (!lines) return fallback;
  const end = Math.min(range.endLine, range.startLine + maxLines - 1, lines.length);
  return lines.slice(range.startLine - 1, end).join('\n');
}

function readLines(
  file: string,
  cache?: Map<string, Promise<string[] | undefined>>,
): Promise<string[] | undefined> {
  const cached = cache?.get(file);
  if (cached) return cached;
  const promise = fs.readFile(file, 'utf8').then(
    (text) => text.split('\n'),
    () => undefined,
  );
  cache?.set(file, promise);
  return promise;
}
