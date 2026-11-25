import type { BannerTexts, LocaleTemplate } from './types.ts';
import { en } from './en.ts';
import { nl } from './nl.ts';
import { de } from './de.ts';
import { fr } from './fr.ts';
import { es } from './es.ts';
import { it } from './it.ts';

export type { BannerTexts, LocaleTemplate } from './types.ts';

/** Built-in default templates. Add a language by adding a file and listing it here. */
export const TEMPLATES: Record<string, LocaleTemplate> = { en, nl, de, fr, es, it };
export const SUPPORTED_LOCALES = Object.keys(TEMPLATES);

export function getTemplate(locale: string): LocaleTemplate {
  const base = locale.toLowerCase().split(/[-_]/)[0] ?? 'en';
  return TEMPLATES[base] ?? en;
}

/** Deep-merges site-specific text overrides over the default template. Empty strings are ignored. */
export function mergeTexts(base: BannerTexts, override: unknown): BannerTexts {
  return deepMerge(base, override) as BannerTexts;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined || override === null || override === '') return base;
  if (typeof base === 'object' && base !== null && typeof override === 'object' && !Array.isArray(override)) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
      if (k in out) out[k] = deepMerge(out[k], v);
    }
    return out;
  }
  return typeof override === typeof base ? override : base;
}
