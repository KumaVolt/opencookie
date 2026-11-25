import { createHash } from 'node:crypto';
import { categoryFromOcd, type Category } from './categories.ts';

/** One entry of the Open Cookie Database (https://github.com/jkwakman/Open-Cookie-Database). */
export interface OcdEntry {
  id: string;
  platform: string;
  category: Category;
  rawCategory: string;
  name: string;
  domain: string;
  description: string;
  retention: string;
  controller: string;
  privacyLink: string;
  wildcard: boolean;
}

interface OcdJsonRow {
  id: string;
  category: string;
  cookie: string;
  domain: string;
  description: string;
  retentionPeriod: string;
  dataController: string;
  privacyLink: string;
  wildcardMatch: string;
}

/** Parses the upstream JSON file, which is keyed by platform name. */
export function parseOcdJson(json: Record<string, OcdJsonRow[]>): OcdEntry[] {
  const out: OcdEntry[] = [];
  for (const [platform, rows] of Object.entries(json)) {
    for (const r of rows) {
      if (!r.cookie) continue;
      out.push({
        id: r.id,
        platform,
        category: categoryFromOcd(r.category),
        rawCategory: r.category,
        name: r.cookie.trim(),
        domain: (r.domain ?? '').trim(),
        description: (r.description ?? '').trim(),
        retention: (r.retentionPeriod ?? '').trim(),
        controller: (r.dataController ?? '').trim(),
        privacyLink: (r.privacyLink ?? '').trim(),
        wildcard: r.wildcardMatch === '1',
      });
    }
  }
  return out;
}

/**
 * Matches observed cookie / storage key names against the database.
 * Exact names win; otherwise the longest wildcard prefix wins (e.g. "_ga_ABC123" → "_ga_").
 * When several entries share a name, the one whose domain matches the cookie's domain is preferred.
 */
export class CookieMatcher {
  private exact = new Map<string, OcdEntry[]>();
  private prefixes: OcdEntry[];
  readonly entries: OcdEntry[];

  constructor(entries: OcdEntry[]) {
    this.entries = entries;
    for (const e of entries) {
      if (e.wildcard) continue;
      const list = this.exact.get(e.name) ?? [];
      list.push(e);
      this.exact.set(e.name, list);
    }
    this.prefixes = entries.filter((e) => e.wildcard).sort((a, b) => b.name.length - a.name.length);
  }

  match(name: string, domain = ''): OcdEntry | null {
    const exact = this.exact.get(name);
    if (exact?.length) return pickByDomain(exact, domain);
    const candidates: OcdEntry[] = [];
    for (const p of this.prefixes) {
      if (name.startsWith(p.name)) {
        if (candidates.length && p.name.length < candidates[0]!.name.length) break;
        candidates.push(p);
      }
    }
    return candidates.length ? pickByDomain(candidates, domain) : null;
  }
}

function pickByDomain(list: OcdEntry[], domain: string): OcdEntry {
  if (list.length === 1 || !domain) return list[0]!;
  const d = domain.replace(/^\./, '').toLowerCase();
  const hit = list.find((e) => {
    const ed = e.domain.replace(/\s*\(3rd party\)\s*/i, '').replace(/^\./, '').toLowerCase();
    return ed && (d === ed || d.endsWith('.' + ed) || ed.endsWith('.' + d));
  });
  return hit ?? list[0]!;
}

/**
 * Translation key for a description: a short hash of the English text.
 * Identical descriptions share one translation, and when the English text changes
 * upstream the key changes, so a stale translation is never shown.
 */
export function descriptionKey(english: string): string {
  return createHash('sha256').update(english.trim()).digest('hex').slice(0, 16);
}
