/** Comment-language pseudo-value: "use whatever `language` resolves to". */
export const INHERIT = 'inherit';

export interface LanguageOption {
  code: string;
  label: string;
}

/** Common natural languages offered in the settings dropdown. `auto` means
 *  "follow the user's own language" and injects no prompt clause. */
export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'auto', label: 'Auto (follow the user)' },
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
];

const MAX_LANGUAGE_LENGTH = 64;

/** Trim, collapse to a single line, and cap length so a pasted blob (or a
 *  hand-edited settings.json) can't smuggle extra content into the system prompt. */
export function sanitizeLanguage(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\s+/g, ' ')
    .replace(/[\x00-\x1f\x7f]+/g, '')
    .trim()
    .slice(0, MAX_LANGUAGE_LENGTH);
}

export function languageLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

/** Build the system-prompt clause(s) for the given language preferences, or
 *  `undefined` when nothing should be injected (prose `auto` and comments
 *  resolving to `auto`). */
export function languagePromptBody(
  language: string,
  commentLanguage: string,
): string | undefined {
  const resolvedComment = commentLanguage === INHERIT ? language : commentLanguage;

  const proseClause =
    language && language !== 'auto'
      ? `Write your prose — chat replies, explanations, summaries — in ${languageLabel(language)}.`
      : undefined;
  const commentClause =
    resolvedComment && resolvedComment !== 'auto'
      ? `Write code comments and doc strings in ${languageLabel(resolvedComment)}.`
      : undefined;

  if (!proseClause && !commentClause) return undefined;

  const clauses = [proseClause, commentClause].filter(Boolean);
  clauses.push(
    'Identifiers, symbol names, commit messages, and PR titles are always English regardless of the above.',
  );
  return clauses.join(' ');
}
