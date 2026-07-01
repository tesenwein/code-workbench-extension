/* Decode the handful of HTML entities that agents (and markdown pipelines)
 * sometimes bake into stored text — arch card names/descriptions, task titles —
 * so `&amp;` renders as `&` instead of literally. Mirrors decodeEntities() in
 * @code-workbench/mcp-core/task-format so both sides agree. `&amp;` is decoded
 * last so an already-encoded `&amp;lt;` doesn't collapse in a single pass. */
export function decodeEntities(s: string | null | undefined): string {
  if (!s || s.indexOf('&') === -1) return s ?? '';
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
