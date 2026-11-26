/**
 * Cookie scanner. Crawls a site in headless Chromium twice:
 *   1. without consent  → everything found here was set BEFORE consent
 *   2. after "accept all" through the OpenCookie banner → the full set of cookies
 * It records cookies, localStorage and sessionStorage keys, and third-party hosts contacted
 * before consent.
 */
import type { CookieKind } from '../core/types.ts';

export interface ScanOptions {
  startUrl: string;
  maxPages: number;
  /** Returns true for hostnames that belong to the site (first party). */
  isSiteHost: (host: string) => boolean;
  onProgress?: (msg: string) => void;
}

export interface RawFinding {
  name: string;
  domain: string;
  kind: CookieKind;
  /** Seconds until expiry; -1 for session cookies; null for storage keys. */
  expiresInSeconds: number | null;
  setBeforeConsent: boolean;
  url: string;
}

export interface ScanResult {
  pages: string[];
  findings: RawFinding[];
  bannerDetected: boolean;
  thirdPartyHostsBeforeConsent: string[];
}

const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mp3|ics|xml|json|css|js)(\?|$)/i;
const SETTLE_MS = 2500;

export async function scanSite(opts: ScanOptions): Promise<ScanResult> {
  let playwright: typeof import('playwright');
  try {
    playwright = await import('playwright');
  } catch {
    throw new Error('Playwright is not installed. Run "npm install playwright && npx playwright install chromium".');
  }
  const log = opts.onProgress ?? (() => {});
  // /dev/shm is only 64 MB in Docker by default; without this flag Chromium crashes on big pages.
  const browser = await playwright.chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  try {
    const start = new URL(opts.startUrl);
    const queue = await initialUrls(start, opts);
    const visited: string[] = [];
    const findings = new Map<string, RawFinding>();
    const thirdParty = new Set<string>();
    let bannerDetected = false;

    // ---- Phase 1: no consent ----
    const ctx1 = await browser.newContext({ userAgent: uaString(), locale: 'en-GB' });
    const page1 = await ctx1.newPage();
    page1.on('request', (req) => {
      try {
        const h = new URL(req.url()).hostname;
        if (!opts.isSiteHost(h) && !h.endsWith(new URL(opts.startUrl).hostname)) thirdParty.add(h);
      } catch {
        /* data: URLs etc. */
      }
    });
    while (queue.length && visited.length < opts.maxPages) {
      const url = queue.shift()!;
      if (visited.includes(url)) continue;
      log(`Scanning ${url}`);
      try {
        await page1.goto(url, { waitUntil: 'load', timeout: 30_000 });
        await page1.waitForTimeout(SETTLE_MS);
      } catch (e) {
        log(`  failed: ${(e as Error).message.split('\n')[0]}`);
        continue;
      }
      visited.push(url);
      bannerDetected ||= await page1.evaluate(() => typeof (window as unknown as { OpenCookie?: unknown }).OpenCookie === 'object');
      await collect(ctx1, page1, url, true, findings);
      for (const link of await sameSiteLinks(page1, opts)) {
        if (!visited.includes(link) && !queue.includes(link)) queue.push(link);
      }
    }
    await ctx1.close();

    // ---- Phase 2: accept all through the banner, then revisit a few pages ----
    if (bannerDetected) {
      const ctx2 = await browser.newContext({ userAgent: uaString(), locale: 'en-GB' });
      const page2 = await ctx2.newPage();
      const revisit = visited.slice(0, Math.min(5, visited.length));
      for (const [i, url] of revisit.entries()) {
        try {
          await page2.goto(url, { waitUntil: 'load', timeout: 30_000 });
          if (i === 0) {
            await page2.evaluate(() => (window as unknown as { OpenCookie?: { acceptAll(): void } }).OpenCookie?.acceptAll());
            await page2.waitForLoadState('load').catch(() => {});
          }
          await page2.waitForTimeout(SETTLE_MS);
          await collect(ctx2, page2, url, false, findings);
        } catch (e) {
          log(`  failed after consent: ${(e as Error).message.split('\n')[0]}`);
        }
      }
      await ctx2.close();
    }

    return {
      pages: visited,
      findings: [...findings.values()],
      bannerDetected,
      thirdPartyHostsBeforeConsent: [...thirdParty].sort(),
    };
  } finally {
    await browser.close();
  }
}

async function collect(
  ctx: import('playwright').BrowserContext,
  page: import('playwright').Page,
  url: string,
  beforeConsent: boolean,
  out: Map<string, RawFinding>,
) {
  const nowSec = Date.now() / 1000;
  const add = (f: RawFinding) => {
    const key = `${f.kind}|${f.domain}|${f.name}`;
    if (!out.has(key)) out.set(key, f);
  };
  for (const c of await ctx.cookies()) {
    add({
      name: c.name,
      domain: c.domain.replace(/^\./, ''),
      kind: 'cookie',
      expiresInSeconds: c.expires === -1 ? -1 : Math.max(0, Math.round(c.expires - nowSec)),
      setBeforeConsent: beforeConsent,
      url,
    });
  }
  const storage = await page.evaluate(() => ({
    host: location.hostname,
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  })).catch(() => null);
  if (storage) {
    for (const k of storage.local) add({ name: k, domain: storage.host, kind: 'localStorage', expiresInSeconds: null, setBeforeConsent: beforeConsent, url });
    for (const k of storage.session) add({ name: k, domain: storage.host, kind: 'sessionStorage', expiresInSeconds: null, setBeforeConsent: beforeConsent, url });
  }
}

async function sameSiteLinks(page: import('playwright').Page, opts: ScanOptions): Promise<string[]> {
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href)).catch(() => [] as string[]);
  const out = new Set<string>();
  for (const h of hrefs) {
    const u = normaliseUrl(h);
    if (u && opts.isSiteHost(new URL(u).hostname) && !SKIP_EXT.test(u)) out.add(u);
  }
  return [...out];
}

async function initialUrls(start: URL, opts: ScanOptions): Promise<string[]> {
  const urls = [normaliseUrl(start.href)!];
  try {
    const res = await fetch(new URL('/sitemap.xml', start), { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const xml = await res.text();
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        const u = normaliseUrl(m[1]!);
        if (u && !u.endsWith('.xml') && opts.isSiteHost(new URL(u).hostname) && !urls.includes(u)) urls.push(u);
        if (urls.length >= opts.maxPages) break;
      }
    }
  } catch {
    /* no sitemap */
  }
  return urls;
}

function normaliseUrl(href: string): string | null {
  try {
    const u = new URL(href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

function uaString() {
  return 'Mozilla/5.0 (compatible; OpenCookieScanner/0.1; +https://github.com/opencookie)';
}

/** Turns an expiry in seconds into the same kind of text the Open Cookie Database uses. */
export function retentionText(expiresInSeconds: number | null): string {
  if (expiresInSeconds === null) return 'Persistent';
  if (expiresInSeconds < 0) return 'Session';
  const days = expiresInSeconds / 86_400;
  if (days < 1 / 24) return `${Math.max(1, Math.round(expiresInSeconds / 60))} minutes`;
  if (days < 1) return `${Math.round(days * 24)} hours`;
  if (days < 60) return `${Math.round(days)} days`;
  if (days < 730) return `${Math.round(days / 30.44)} months`;
  return `${Math.round(days / 365.25)} years`;
}
