import { descriptionKey } from './cookiedb.ts';

/**
 * Translation files live in data/translations/<locale>.json:
 *   { "<descriptionKey>": { "text": "...", "status": "machine" | "reviewed", "source": "<English>" } }
 * They translate Open Cookie Database descriptions (and owner-written English descriptions).
 * Categories and retention periods are not translated here: categories use the templates and
 * retention periods are formatted with Intl.
 */
export interface TranslationEntry {
  text: string;
  status: 'machine' | 'reviewed';
  source: string;
}
export type TranslationFile = Record<string, TranslationEntry>;

export class TranslationStore {
  private files = new Map<string, TranslationFile>();

  set(locale: string, file: TranslationFile): void {
    this.files.set(locale, file);
  }

  get(locale: string): TranslationFile {
    let f = this.files.get(locale);
    if (!f) {
      f = {};
      this.files.set(locale, f);
    }
    return f;
  }

  locales(): string[] {
    return [...this.files.keys()];
  }

  /** Returns the translated description, or null when none exists. English is returned as-is. */
  translate(english: string, locale: string): string | null {
    if (!english) return null;
    if (locale === 'en') return english;
    return this.files.get(locale)?.[descriptionKey(english)]?.text ?? null;
  }

  put(locale: string, english: string, text: string, status: TranslationEntry['status']): void {
    const f = this.get(locale);
    const key = descriptionKey(english);
    // Never overwrite a human-reviewed translation with a machine one.
    if (f[key]?.status === 'reviewed' && status === 'machine') return;
    f[key] = { text, status, source: english };
  }
}
