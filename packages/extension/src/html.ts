/** HTML/script-embedding helpers shared by the webview panels. */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Serialize to JSON and escape characters that could break an inline script context. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '\\u002d\\u002d>');
}

/** Random CSP nonce for inline `<script>` / `<style>` tags. */
export function makeNonce(): string {
  const cs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let t = '';
  for (let i = 0; i < 24; i++) t += cs[Math.floor(Math.random() * cs.length)];
  return t;
}
