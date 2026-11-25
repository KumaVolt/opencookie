/**
 * Machine-translates Open Cookie Database descriptions into data/translations/<locale>.json.
 *
 *   npm run translate -- --locales nl,de,fr --provider deepl
 *   npm run translate -- --locales nl --provider libretranslate
 *
 * Providers:
 *   deepl           needs DEEPL_API_KEY (free keys end in ":fx")
 *   libretranslate  self-hosted; needs LIBRETRANSLATE_URL (and LIBRETRANSLATE_API_KEY if required)
 *
 * Only descriptions without a translation are sent. Reviewed translations are never overwritten.
 * Each unique English sentence is translated once (about 1,800 for the whole database).
 */
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { parseOcdJson } from '../src/core/cookiedb.ts';
import { loadTranslations, ocdPath, saveTranslations } from '../src/server/data.ts';

const { values } = parseArgs({
  options: {
    locales: { type: 'string', default: 'nl,de,fr,es,it' },
    provider: { type: 'string', default: process.env.DEEPL_API_KEY ? 'deepl' : 'libretranslate' },
    limit: { type: 'string' },
    'batch-size': { type: 'string', default: '40' },
  },
});

type Translator = (texts: string[], target: string) => Promise<string[]>;

const deepl: Translator = async (texts, target) => {
  const key = process.env.DEEPL_API_KEY;
  if (!key) throw new Error('Set DEEPL_API_KEY');
  const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const res = await fetch(`${host}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts, source_lang: 'EN', target_lang: target.toUpperCase() }),
  });
  if (!res.ok) throw new Error(`DeepL: HTTP ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { translations: { text: string }[] };
  return json.translations.map((t) => t.text);
};

const libretranslate: Translator = async (texts, target) => {
  const url = process.env.LIBRETRANSLATE_URL;
  if (!url) throw new Error('Set LIBRETRANSLATE_URL, e.g. http://localhost:5000');
  const res = await fetch(`${url.replace(/\/$/, '')}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: texts, source: 'en', target, format: 'text', api_key: process.env.LIBRETRANSLATE_API_KEY }),
  });
  if (!res.ok) throw new Error(`LibreTranslate: HTTP ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { translatedText: string[] | string };
  return Array.isArray(json.translatedText) ? json.translatedText : [json.translatedText];
};

const providers: Record<string, Translator> = { deepl, libretranslate };
const translate = providers[values.provider!];
if (!translate) throw new Error(`Unknown provider "${values.provider}". Use: ${Object.keys(providers).join(', ')}`);

const entries = parseOcdJson(JSON.parse(await readFile(ocdPath(), 'utf8')));
const unique = [...new Set(entries.map((e) => e.description).filter(Boolean))];
const store = await loadTranslations();
const batchSize = Number(values['batch-size']);

for (const locale of values.locales!.split(',').map((s) => s.trim()).filter(Boolean)) {
  if (locale === 'en') continue;
  let todo = unique.filter((t) => store.translate(t, locale) === null);
  if (values.limit) todo = todo.slice(0, Number(values.limit));
  console.log(`${locale}: ${unique.length - todo.length} already translated, ${todo.length} to go`);
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    const out = await translate(batch, locale);
    batch.forEach((src, j) => out[j] && store.put(locale, src, out[j]!, 'machine'));
    await saveTranslations(store, locale); // save as we go, so an interrupted run loses nothing
    process.stdout.write(`  ${Math.min(i + batchSize, todo.length)}/${todo.length}\r`);
  }
  console.log(`\n${locale}: done`);
}
