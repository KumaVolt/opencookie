import type { Category } from '../core/categories.ts';
import { EXTRA_COOKIES, trackerCategory } from '../core/trackers.ts';
import type { CookieMatcher } from '../core/cookiedb.ts';
import type { Site } from '../core/types.ts';
import { retentionText, scanSite } from '../scanner/scan.ts';
import { config } from './config.ts';
import { hostBelongsToSite, type Db, type ObservedCookie } from './db.ts';

/** OpenCookie's own storage; always necessary. */
const OWN: Record<string, { description: string; retention: string }> = {
  oc_consent: { description: 'Stores the visitor\'s cookie consent choices for this website.', retention: '1 year' },
};

/** Runs scans one at a time so a small server is never overloaded. */
export class ScanQueue {
  private queue: { scanId: number; siteId: number }[] = [];
  private running = false;
  private db: Db;
  private matcher: () => CookieMatcher;

  constructor(db: Db, matcher: () => CookieMatcher) {
    this.db = db;
    this.matcher = matcher;
  }

  enqueue(siteId: number): number {
    const scan = this.db.createScan(siteId);
    this.queue.push({ scanId: scan.id, siteId });
    void this.next();
    return scan.id;
  }

  isBusy(siteId: number): boolean {
    return this.queue.some((q) => q.siteId === siteId) || this.db.listScans(siteId, 1)[0]?.status === 'running';
  }

  private async next() {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = true;
    try {
      await this.run(job.scanId, job.siteId);
    } finally {
      this.running = false;
      void this.next();
    }
  }

  private async run(scanId: number, siteId: number) {
    const site = this.db.getSite(siteId);
    if (!site) return;
    this.db.updateScan(scanId, { status: 'running', startedAt: new Date().toISOString() });
    try {
      const result = await scanSite({
        startUrl: siteUrl(site.domain),
        maxPages: config.scanMaxPages,
        isSiteHost: (h) => hostBelongsToSite(h, site),
        onProgress: (m) => console.log(`[scan ${scanId}] ${m}`),
      });
      const observed = result.findings.map((f) => classify(f, site, this.matcher()));
      const changed = this.db.upsertObservedCookies(siteId, observed);
      if (changed) this.db.bumpPolicyVersion(siteId);
      this.db.updateScan(scanId, {
        status: 'done',
        finishedAt: new Date().toISOString(),
        pagesScanned: result.pages.length,
        cookiesFound: observed.length,
        bannerDetected: result.bannerDetected,
        thirdPartyHostsBeforeConsent: result.thirdPartyHostsBeforeConsent,
      });
    } catch (e) {
      this.db.updateScan(scanId, { status: 'failed', finishedAt: new Date().toISOString(), error: (e as Error).message });
    }
  }
}

export function classify(
  f: { name: string; domain: string; kind: ObservedCookie['kind']; expiresInSeconds: number | null; setBeforeConsent: boolean; url: string },
  site: Site,
  matcher: CookieMatcher,
): ObservedCookie {
  const own = OWN[f.name];
  if (own) {
    return { ...base(f), category: 'necessary', provider: site.name, ocdId: null, description: own.description, retention: own.retention, reviewed: true };
  }
  const hit = matcher.match(f.name, f.domain);
  if (hit) {
    // A tracking service's "functional" cookie still needs consent.
    const category = hit.category === 'necessary' ? trackerCategory(hit.platform) ?? hit.category : hit.category;
    return { ...base(f), category, provider: hit.platform, ocdId: hit.id, description: hit.description, retention: hit.retention || fallbackRetention(f) };
  }
  const extra = EXTRA_COOKIES.find((x) => x.pattern.test(f.name));
  if (extra) {
    return { ...base(f), category: extra.category, provider: extra.platform, ocdId: null, description: extra.description, retention: fallbackRetention(f) };
  }
  const firstParty = hostBelongsToSite(f.domain, site);
  return {
    ...base(f),
    // Unknown cookies need consent until a human says otherwise.
    category: 'marketing' as Category,
    provider: firstParty ? site.name : f.domain,
    ocdId: null,
    description: '',
    retention: fallbackRetention(f),
  };
}

function base(f: { name: string; domain: string; kind: ObservedCookie['kind']; setBeforeConsent: boolean; url: string }) {
  return { name: f.name, domain: f.domain, kind: f.kind, setBeforeConsent: f.setBeforeConsent, exampleUrl: f.url };
}

function fallbackRetention(f: { kind: ObservedCookie['kind']; expiresInSeconds: number | null }): string {
  if (f.kind === 'sessionStorage') return 'Session';
  return retentionText(f.expiresInSeconds);
}

/** Local development hosts are scanned over http; everything else over https. */
export function siteUrl(domain: string): string {
  const local = /^(localhost|127\.0\.0\.1|[^:/]+\.(localhost|test))(:\d+)?$/.test(domain);
  return `${local ? 'http' : 'https'}://${domain}/`;
}
