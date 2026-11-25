import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CookieMatcher, parseOcdJson } from '../core/cookiedb.ts';
import { TranslationStore, type TranslationFile } from '../core/translations.ts';
import { config } from './config.ts';

export const ocdPath = () => join(config.dataDir, 'open-cookie-database.json');
export const translationsDir = () => join(config.dataDir, 'translations');

/** Downloads the latest Open Cookie Database into the data directory. */
export async function downloadCookieDb(): Promise<number> {
  const res = await fetch(config.cookieDbUrl);
  if (!res.ok) throw new Error(`Downloading the Open Cookie Database failed: HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, never[]>;
  const entries = parseOcdJson(json);
  if (entries.length < 100) throw new Error('The downloaded cookie database looks wrong (fewer than 100 entries).');
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(ocdPath(), JSON.stringify(json));
  return entries.length;
}

export async function loadMatcher(): Promise<CookieMatcher> {
  if (!existsSync(ocdPath())) {
    console.log('[opencookie] Downloading the Open Cookie Database…');
    await downloadCookieDb();
  }
  const json = JSON.parse(await readFile(ocdPath(), 'utf8'));
  return new CookieMatcher(parseOcdJson(json));
}

export async function loadTranslations(): Promise<TranslationStore> {
  const store = new TranslationStore();
  const dir = translationsDir();
  if (!existsSync(dir)) return store;
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.json')) continue;
    store.set(f.replace(/\.json$/, ''), JSON.parse(await readFile(join(dir, f), 'utf8')) as TranslationFile);
  }
  return store;
}

export async function saveTranslations(store: TranslationStore, locale: string): Promise<void> {
  await mkdir(translationsDir(), { recursive: true });
  const file = store.get(locale);
  const sorted = Object.fromEntries(Object.entries(file).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(join(translationsDir(), `${locale}.json`), JSON.stringify(sorted, null, 2) + '\n');
}
