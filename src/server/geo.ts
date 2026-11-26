import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { config } from './config.ts';

/**
 * Visitor country, for sites that use different rules per country.
 *
 * Looked up on this server in DB-IP's free country database (CC BY 4.0, https://db-ip.com),
 * downloaded once a month and only when a site uses country rules. No visitor data leaves
 * the server. A CDN header such as Cloudflare's CF-IPCountry is used instead when GEO_HEADER
 * names it. Only the two-letter country is kept; the IP address never is.
 */

const FILE = join(config.dataDir, 'geo', 'dbip-country-lite.csv.gz');
const MAX_AGE_MS = 35 * 86_400_000;

interface Table {
  countries: string[];
  v4Start: Uint32Array;
  v4End: Uint32Array;
  v4Country: Uint16Array;
  /** IPv6 ranges by their first 64 bits; finer ranges don't exist at country level. */
  v6Start: BigUint64Array;
  v6End: BigUint64Array;
  v6Country: Uint16Array;
}

let table: Table | null = null;
let tableMtime = 0;

function ipv4ToInt(ip: string): number {
  const p = ip.split('.');
  return ((Number(p[0]) << 24) | (Number(p[1]) << 16) | (Number(p[2]) << 8) | Number(p[3])) >>> 0;
}

/** First 64 bits of an IPv6 address. */
function ipv6High(ip: string): bigint {
  let [head = '', tail = ''] = ip.split('::') as [string, string?];
  if (!ip.includes('::')) tail = '';
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  // An embedded IPv4 tail takes two groups; it only affects the low 64 bits anyway.
  const tailGroups = t.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0);
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - tailGroups)).fill('0'), ...t];
  let v = 0n;
  for (let i = 0; i < 4; i++) v = (v << 16n) | BigInt(parseInt(groups[i] || '0', 16) || 0);
  return v;
}

export function parseTable(csv: string): Table {
  const countries: string[] = [];
  const idx = new Map<string, number>();
  const v4: [number, number, number][] = [];
  const v6: [bigint, bigint, number][] = [];
  for (const line of csv.split('\n')) {
    const [a, b, cc] = line.trim().split(',');
    if (!a || !b || !cc || !/^[A-Z]{2}$/.test(cc) || cc === 'ZZ') continue;
    let i = idx.get(cc);
    if (i === undefined) idx.set(cc, (i = countries.push(cc) - 1));
    if (isIP(a) === 4) v4.push([ipv4ToInt(a), ipv4ToInt(b), i]);
    else if (isIP(a) === 6) v6.push([ipv6High(a), ipv6High(b), i]);
  }
  v4.sort((x, y) => x[0] - y[0]);
  v6.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return {
    countries,
    v4Start: Uint32Array.from(v4, (r) => r[0]),
    v4End: Uint32Array.from(v4, (r) => r[1]),
    v4Country: Uint16Array.from(v4, (r) => r[2]),
    v6Start: BigUint64Array.from(v6, (r) => r[0]),
    v6End: BigUint64Array.from(v6, (r) => r[1]),
    v6Country: Uint16Array.from(v6, (r) => r[2]),
  };
}

function search<T extends number | bigint>(starts: ArrayLike<T>, ends: ArrayLike<T>, x: T): number {
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid]! <= x) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 && x <= ends[found]! ? found : -1;
}

export function lookupIn(t: Table, ip: string): string | null {
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  const kind = isIP(ip);
  if (kind === 4) {
    const i = search(t.v4Start, t.v4End, ipv4ToInt(ip));
    return i < 0 ? null : t.countries[t.v4Country[i]!]!;
  }
  if (kind === 6) {
    const i = search(t.v6Start, t.v6End, ipv6High(ip));
    return i < 0 ? null : t.countries[t.v6Country[i]!]!;
  }
  return null;
}

function loadTable(): Table | null {
  if (!existsSync(FILE)) return null;
  const mtime = statSync(FILE).mtimeMs;
  if (!table || tableMtime !== mtime) {
    table = parseTable(gunzipSync(readFileSync(FILE)).toString('utf8'));
    tableMtime = mtime;
  }
  return table;
}

/** Two-letter country of a visitor, or null when unknown. */
export function visitorCountry(ip: string, headers: Record<string, string | string[] | undefined>): string | null {
  if (config.geoHeader) {
    const h = String(headers[config.geoHeader] ?? '').toUpperCase();
    // Cloudflare uses XX for unknown and T1 for Tor.
    if (/^[A-Z]{2}$/.test(h) && h !== 'XX') return h;
  }
  try {
    return loadTable() ? lookupIn(table!, ip) : null;
  } catch (e) {
    console.warn('[opencookie] Country lookup failed:', (e as Error).message);
    return null;
  }
}

let downloading: Promise<void> | null = null;

/** Download or refresh the country database. Does nothing while the file is less than a month old. */
export function ensureGeoDb(): Promise<void> {
  if (config.geoHeader) return Promise.resolve();
  if (existsSync(FILE) && Date.now() - statSync(FILE).mtimeMs < MAX_AGE_MS) return Promise.resolve();
  downloading ??= download().finally(() => (downloading = null));
  return downloading;
}

async function download(): Promise<void> {
  const month = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  // A new month's file appears in the first days of the month; fall back to the previous one.
  for (const m of [month(now), month(prev)]) {
    try {
      const res = await fetch(`https://download.db-ip.com/free/dbip-country-lite-${m}.csv.gz`);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      parseTable(gunzipSync(buf).toString('utf8')); // refuse a broken file before replacing a good one
      mkdirSync(join(config.dataDir, 'geo'), { recursive: true });
      writeFileSync(FILE + '.tmp', buf);
      renameSync(FILE + '.tmp', FILE);
      console.log(`[opencookie] Country database updated (DB-IP ${m}).`);
      return;
    } catch (e) {
      console.warn(`[opencookie] Country database download failed (${m}):`, (e as Error).message);
    }
  }
}
