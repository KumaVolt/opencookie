import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Category } from '../core/categories.ts';
import type { ConsentRecord, CookieKind, ScanSummary, Site, SiteCookie } from '../core/types.ts';
import { config } from './config.ts';
import { accounts } from './accounts.ts';

const MIGRATIONS = [
  `CREATE TABLE sites (
     id INTEGER PRIMARY KEY,
     key TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     domain TEXT NOT NULL,
     extra_domains TEXT NOT NULL DEFAULT '[]',
     rule_pack TEXT NOT NULL DEFAULT 'nl-ap',
     default_locale TEXT NOT NULL DEFAULT 'nl',
     locales TEXT NOT NULL DEFAULT '["nl","en"]',
     privacy_policy_url TEXT NOT NULL DEFAULT '',
     contact TEXT NOT NULL DEFAULT '',
     theme TEXT NOT NULL DEFAULT '{}',
     text_overrides TEXT NOT NULL DEFAULT '{}',
     exempt_confirmed TEXT NOT NULL DEFAULT '[]',
     consent_mode INTEGER NOT NULL DEFAULT 1,
     auto_block INTEGER NOT NULL DEFAULT 1,
     policy_version INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE site_cookies (
     id INTEGER PRIMARY KEY,
     site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     domain TEXT NOT NULL DEFAULT '',
     kind TEXT NOT NULL DEFAULT 'cookie',
     category TEXT NOT NULL,
     provider TEXT NOT NULL DEFAULT '',
     ocd_id TEXT,
     description TEXT NOT NULL DEFAULT '',
     description_overrides TEXT NOT NULL DEFAULT '{}',
     retention TEXT NOT NULL DEFAULT '',
     source TEXT NOT NULL DEFAULT 'scan',
     reviewed INTEGER NOT NULL DEFAULT 0,
     set_before_consent INTEGER NOT NULL DEFAULT 0,
     first_seen TEXT NOT NULL,
     last_seen TEXT NOT NULL,
     example_url TEXT NOT NULL DEFAULT '',
     UNIQUE (site_id, name, domain, kind)
   )`,
  `CREATE TABLE scans (
     id INTEGER PRIMARY KEY,
     site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
     status TEXT NOT NULL,
     started_at TEXT,
     finished_at TEXT,
     pages_scanned INTEGER NOT NULL DEFAULT 0,
     cookies_found INTEGER NOT NULL DEFAULT 0,
     banner_detected INTEGER,
     third_party_hosts TEXT NOT NULL DEFAULT '[]',
     error TEXT,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE consents (
     id INTEGER PRIMARY KEY,
     site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
     consent_id TEXT NOT NULL,
     policy_version INTEGER NOT NULL,
     categories TEXT NOT NULL,
     action TEXT NOT NULL,
     locale TEXT NOT NULL,
     gpc INTEGER NOT NULL DEFAULT 0,
     url TEXT NOT NULL DEFAULT '',
     ip_hash TEXT NOT NULL DEFAULT '',
     user_agent TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX consents_site_created ON consents (site_id, created_at)`,
  `CREATE INDEX consents_consent_id ON consents (consent_id)`,
  // ---- v0.2: accounts, organisations (clients), 2FA, passkeys ----
  `CREATE TABLE organisations (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     require_2fa INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL DEFAULT '',
     password_hash TEXT,
     is_platform_admin INTEGER NOT NULL DEFAULT 0,
     webauthn_id TEXT NOT NULL UNIQUE,
     totp_secret TEXT,
     totp_last_step INTEGER NOT NULL DEFAULT 0,
     disabled INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     last_login_at TEXT
   )`,
  `CREATE TABLE memberships (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     org_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
     role TEXT NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (user_id, org_id)
   )`,
  `CREATE TABLE passkeys (
     id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     public_key BLOB NOT NULL,
     counter INTEGER NOT NULL DEFAULT 0,
     transports TEXT NOT NULL DEFAULT '[]',
     name TEXT NOT NULL DEFAULT 'Passkey',
     backed_up INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     last_used_at TEXT
   )`,
  `CREATE TABLE recovery_codes (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     code_hash TEXT NOT NULL,
     used_at TEXT
   )`,
  `CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     stage TEXT NOT NULL,
     mfa_attempts INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     last_seen_at TEXT NOT NULL,
     ip TEXT NOT NULL DEFAULT '',
     user_agent TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE INDEX sessions_user ON sessions (user_id)`,
  `CREATE TABLE tokens (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     email TEXT NOT NULL DEFAULT '',
     user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
     org_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
     role TEXT NOT NULL DEFAULT '',
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     used_at TEXT
   )`,
  `CREATE TABLE audit_log (
     id INTEGER PRIMARY KEY,
     created_at TEXT NOT NULL,
     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     user_email TEXT NOT NULL DEFAULT '',
     org_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
     site_id INTEGER,
     action TEXT NOT NULL,
     detail TEXT NOT NULL DEFAULT '',
     ip TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE INDEX audit_org_created ON audit_log (org_id, created_at)`,
  `ALTER TABLE sites ADD COLUMN org_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE`,
  // Sites created before accounts existed go into one organisation.
  `INSERT INTO organisations (name, created_at) SELECT 'My sites', datetime('now') WHERE EXISTS (SELECT 1 FROM sites);
   UPDATE sites SET org_id = (SELECT MIN(id) FROM organisations) WHERE org_id IS NULL`,
  // Personal access tokens for the API and MCP. Only a hash is stored.
  `CREATE TABLE api_tokens (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     token_hash TEXT NOT NULL UNIQUE,
     prefix TEXT NOT NULL,
     can_write INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     expires_at TEXT,
     last_used_at TEXT,
     last_used_ip TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE INDEX api_tokens_user ON api_tokens (user_id)`,
  `ALTER TABLE scans ADD COLUMN settings_link INTEGER`,
  `ALTER TABLE sites ADD COLUMN country_packs TEXT NOT NULL DEFAULT '{}';
   ALTER TABLE consents ADD COLUMN country TEXT NOT NULL DEFAULT '';
   ALTER TABLE consents ADD COLUMN rule_pack TEXT NOT NULL DEFAULT ''`,
];

export type Db = ReturnType<typeof openDb>;

export function openDb(file = join(config.dataDir, 'opencookie.sqlite')) {
  if (file !== ':memory:') mkdirSync(config.dataDir, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec(MIGRATIONS[i]!);
    db.exec(`PRAGMA user_version = ${i + 1}`);
  }
  const sites = repo(db);
  const acc = accounts(db);
  return Object.assign(sites, acc);
}

const now = () => new Date().toISOString();
const j = <T>(s: unknown, fallback: T): T => {
  try {
    return s ? (JSON.parse(String(s)) as T) : fallback;
  } catch {
    return fallback;
  }
};

type Row = Record<string, unknown>;

const DEFAULT_THEME = { primary: '#1a1a1a', background: '#ffffff', text: '#1a1a1a', position: 'bottom' as const, floatingButton: true };

function toSite(r: Row): Site {
  return {
    id: Number(r.id),
    key: String(r.key),
    orgId: r.org_id === null || r.org_id === undefined ? null : Number(r.org_id),
    name: String(r.name),
    domain: String(r.domain),
    extraDomains: j(r.extra_domains, []),
    rulePack: String(r.rule_pack),
    countryPacks: j(r.country_packs, {}),
    defaultLocale: String(r.default_locale),
    locales: j(r.locales, ['en']),
    privacyPolicyUrl: String(r.privacy_policy_url),
    contact: String(r.contact),
    theme: { ...DEFAULT_THEME, ...j(r.theme, {}) },
    textOverrides: j(r.text_overrides, {}),
    exemptConfirmed: j(r.exempt_confirmed, []),
    consentMode: Boolean(r.consent_mode),
    autoBlock: Boolean(r.auto_block),
    policyVersion: Number(r.policy_version),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function toCookie(r: Row): SiteCookie {
  return {
    id: Number(r.id),
    siteId: Number(r.site_id),
    name: String(r.name),
    domain: String(r.domain),
    kind: String(r.kind) as CookieKind,
    category: String(r.category) as Category,
    provider: String(r.provider),
    ocdId: r.ocd_id ? String(r.ocd_id) : null,
    description: String(r.description),
    descriptionOverrides: j(r.description_overrides, {}),
    retention: String(r.retention),
    source: String(r.source) as SiteCookie['source'],
    reviewed: Boolean(r.reviewed),
    setBeforeConsent: Boolean(r.set_before_consent),
    firstSeen: String(r.first_seen),
    lastSeen: String(r.last_seen),
    exampleUrl: String(r.example_url),
  };
}

function toScan(r: Row): ScanSummary {
  return {
    id: Number(r.id),
    siteId: Number(r.site_id),
    status: String(r.status) as ScanSummary['status'],
    startedAt: (r.started_at as string) ?? null,
    finishedAt: (r.finished_at as string) ?? null,
    pagesScanned: Number(r.pages_scanned),
    cookiesFound: Number(r.cookies_found),
    bannerDetected: r.banner_detected === null || r.banner_detected === undefined ? null : Boolean(r.banner_detected),
    thirdPartyHostsBeforeConsent: j(r.third_party_hosts, []),
    settingsLinkFound: r.settings_link === null || r.settings_link === undefined ? null : Boolean(r.settings_link),
    error: (r.error as string) ?? null,
  };
}

function toConsent(r: Row): ConsentRecord {
  return {
    id: Number(r.id),
    siteId: Number(r.site_id),
    consentId: String(r.consent_id),
    policyVersion: Number(r.policy_version),
    categories: j(r.categories, []),
    action: String(r.action) as ConsentRecord['action'],
    locale: String(r.locale),
    gpc: Boolean(r.gpc),
    url: String(r.url),
    ipHash: String(r.ip_hash),
    userAgent: String(r.user_agent),
    country: String(r.country ?? ''),
    rulePack: String(r.rule_pack ?? ''),
    createdAt: String(r.created_at),
  };
}

export type SiteInput = Partial<Omit<Site, 'id' | 'key' | 'createdAt' | 'updatedAt' | 'policyVersion' | 'orgId'>>;

export interface ObservedCookie {
  name: string;
  domain: string;
  kind: CookieKind;
  category: Category;
  provider: string;
  ocdId: string | null;
  description: string;
  retention: string;
  setBeforeConsent: boolean;
  exampleUrl: string;
  /** Pre-reviewed (e.g. OpenCookie's own cookie). */
  reviewed?: boolean;
}

function repo(db: DatabaseSync) {
  return {
    raw: db,

    // ---- sites ----
    listSites(): Site[] {
      return (db.prepare('SELECT * FROM sites ORDER BY name').all() as Row[]).map(toSite);
    },
    listSitesInOrgs(orgIds: number[]): Site[] {
      if (!orgIds.length) return [];
      return (db.prepare(`SELECT * FROM sites WHERE org_id IN (${orgIds.map(() => '?').join(',')}) ORDER BY name`).all(...orgIds) as Row[]).map(toSite);
    },
    getSite(id: number): Site | null {
      const r = db.prepare('SELECT * FROM sites WHERE id = ?').get(id) as Row | undefined;
      return r ? toSite(r) : null;
    },
    getSiteByKey(key: string): Site | null {
      const r = db.prepare('SELECT * FROM sites WHERE key = ?').get(key) as Row | undefined;
      return r ? toSite(r) : null;
    },
    createSite(orgId: number, input: SiteInput & { name: string; domain: string }): Site {
      const key = randomBytes(9).toString('base64url');
      const t = now();
      const r = db
        .prepare(
          `INSERT INTO sites (key, org_id, name, domain, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(key, orgId, input.name, normaliseDomain(input.domain), t, t) as Row;
      return this.updateSite(Number(r.id), input)!;
    },
    updateSite(id: number, input: SiteInput): Site | null {
      const s = this.getSite(id);
      if (!s) return null;
      const m = { ...s, ...input };
      db.prepare(
        `UPDATE sites SET name=?, domain=?, extra_domains=?, rule_pack=?, country_packs=?, default_locale=?, locales=?,
           privacy_policy_url=?, contact=?, theme=?, text_overrides=?, exempt_confirmed=?, consent_mode=?,
           auto_block=?, updated_at=? WHERE id=?`,
      ).run(
        m.name,
        normaliseDomain(m.domain),
        JSON.stringify(m.extraDomains.map(normaliseDomain)),
        m.rulePack,
        JSON.stringify(m.countryPacks),
        m.defaultLocale,
        JSON.stringify(m.locales),
        m.privacyPolicyUrl,
        m.contact,
        JSON.stringify(m.theme),
        JSON.stringify(m.textOverrides),
        JSON.stringify(m.exemptConfirmed),
        m.consentMode ? 1 : 0,
        m.autoBlock ? 1 : 0,
        now(),
        id,
      );
      return this.getSite(id);
    },
    /** Bump when the set of cookies or the purposes change: visitors are asked again. */
    bumpPolicyVersion(id: number): void {
      db.prepare('UPDATE sites SET policy_version = policy_version + 1, updated_at = ? WHERE id = ?').run(now(), id);
    },
    deleteSite(id: number): void {
      db.prepare('DELETE FROM sites WHERE id = ?').run(id);
    },

    // ---- cookies ----
    listCookies(siteId: number): SiteCookie[] {
      return (db.prepare('SELECT * FROM site_cookies WHERE site_id = ? ORDER BY category, name').all(siteId) as Row[]).map(toCookie);
    },
    getCookie(id: number): SiteCookie | null {
      const r = db.prepare('SELECT * FROM site_cookies WHERE id = ?').get(id) as Row | undefined;
      return r ? toCookie(r) : null;
    },
    /**
     * Inserts or refreshes cookies seen during a scan. Returns true when new non-essential
     * cookies appeared (the caller then bumps the policy version so visitors are asked again).
     * Human-reviewed category and description are kept.
     */
    upsertObservedCookies(siteId: number, observed: ObservedCookie[]): boolean {
      const t = now();
      let newNonEssential = false;
      const find = db.prepare('SELECT * FROM site_cookies WHERE site_id=? AND name=? AND domain=? AND kind=?');
      const insert = db.prepare(
        `INSERT INTO site_cookies (site_id, name, domain, kind, category, provider, ocd_id, description, retention,
           source, set_before_consent, first_seen, last_seen, example_url, reviewed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scan', ?, ?, ?, ?, ?)`,
      );
      const update = db.prepare(
        `UPDATE site_cookies SET last_seen=?, set_before_consent=?, example_url=?,
           category = CASE WHEN reviewed THEN category ELSE ? END,
           provider = CASE WHEN reviewed THEN provider ELSE ? END,
           description = CASE WHEN reviewed THEN description ELSE ? END,
           retention = CASE WHEN reviewed THEN retention ELSE ? END,
           ocd_id = ?
         WHERE id=?`,
      );
      db.exec('BEGIN');
      try {
        for (const o of observed) {
          const existing = find.get(siteId, o.name, o.domain, o.kind) as Row | undefined;
          if (existing) {
            update.run(t, o.setBeforeConsent ? 1 : 0, o.exampleUrl, o.category, o.provider, o.description, o.retention, o.ocdId, Number(existing.id));
          } else {
            insert.run(siteId, o.name, o.domain, o.kind, o.category, o.provider, o.ocdId, o.description, o.retention, o.setBeforeConsent ? 1 : 0, t, t, o.exampleUrl, o.reviewed ? 1 : 0);
            if (o.category !== 'necessary') newNonEssential = true;
          }
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return newNonEssential;
    },
    addManualCookie(siteId: number, c: Pick<SiteCookie, 'name' | 'domain' | 'kind' | 'category' | 'provider' | 'description' | 'retention'>): SiteCookie {
      const t = now();
      const r = db
        .prepare(
          `INSERT INTO site_cookies (site_id, name, domain, kind, category, provider, description, retention, source, reviewed, first_seen, last_seen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', 1, ?, ?) RETURNING id`,
        )
        .get(siteId, c.name, c.domain, c.kind, c.category, c.provider, c.description, c.retention, t, t) as Row;
      return this.getCookie(Number(r.id))!;
    },
    updateCookie(id: number, patch: Partial<Pick<SiteCookie, 'category' | 'provider' | 'description' | 'descriptionOverrides' | 'retention'>>): SiteCookie | null {
      const c = this.getCookie(id);
      if (!c) return null;
      // Fields left out (undefined) keep their value.
      const m = { ...c, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
      db.prepare(
        'UPDATE site_cookies SET category=?, provider=?, description=?, description_overrides=?, retention=?, reviewed=1 WHERE id=?',
      ).run(m.category, m.provider, m.description, JSON.stringify(m.descriptionOverrides), m.retention, id);
      return this.getCookie(id);
    },
    deleteCookie(id: number): void {
      db.prepare('DELETE FROM site_cookies WHERE id = ?').run(id);
    },

    // ---- scans ----
    createScan(siteId: number): ScanSummary {
      const r = db.prepare(`INSERT INTO scans (site_id, status, created_at) VALUES (?, 'queued', ?) RETURNING *`).get(siteId, now()) as Row;
      return toScan(r);
    },
    updateScan(id: number, patch: Partial<Omit<ScanSummary, 'id' | 'siteId'>>): void {
      const cols: Record<string, unknown> = {
        status: patch.status,
        started_at: patch.startedAt,
        finished_at: patch.finishedAt,
        pages_scanned: patch.pagesScanned,
        cookies_found: patch.cookiesFound,
        banner_detected: patch.bannerDetected === undefined ? undefined : patch.bannerDetected === null ? null : patch.bannerDetected ? 1 : 0,
        third_party_hosts: patch.thirdPartyHostsBeforeConsent && JSON.stringify(patch.thirdPartyHostsBeforeConsent),
        settings_link: patch.settingsLinkFound === undefined || patch.settingsLinkFound === null ? undefined : patch.settingsLinkFound ? 1 : 0,
        error: patch.error,
      };
      const set = Object.entries(cols).filter(([, v]) => v !== undefined);
      if (!set.length) return;
      db.prepare(`UPDATE scans SET ${set.map(([k]) => `${k}=?`).join(', ')} WHERE id=?`).run(...(set.map(([, v]) => v) as (string | number | null)[]), id);
    },
    listScans(siteId: number, limit = 20): ScanSummary[] {
      return (db.prepare('SELECT * FROM scans WHERE site_id=? ORDER BY id DESC LIMIT ?').all(siteId, limit) as Row[]).map(toScan);
    },
    latestFinishedScan(siteId: number): ScanSummary | null {
      const r = db.prepare(`SELECT * FROM scans WHERE site_id=? AND status IN ('done','failed') ORDER BY id DESC LIMIT 1`).get(siteId) as Row | undefined;
      return r ? toScan(r) : null;
    },
    /** Scans interrupted by a restart are marked failed. */
    failInterruptedScans(): void {
      db.prepare(`UPDATE scans SET status='failed', error='Interrupted by a server restart', finished_at=? WHERE status IN ('queued','running')`).run(now());
    },

    // ---- consent log ----
    insertConsent(c: Omit<ConsentRecord, 'id' | 'createdAt'>): void {
      db.prepare(
        `INSERT INTO consents (site_id, consent_id, policy_version, categories, action, locale, gpc, url, ip_hash, user_agent, country, rule_pack, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(c.siteId, c.consentId, c.policyVersion, JSON.stringify(c.categories), c.action, c.locale, c.gpc ? 1 : 0, c.url, c.ipHash, c.userAgent, c.country, c.rulePack, now());
    },
    listConsents(siteId: number, opts: { limit?: number; offset?: number; consentId?: string } = {}): { total: number; rows: ConsentRecord[] } {
      const where = opts.consentId ? 'site_id=? AND consent_id=?' : 'site_id=?';
      const args: (string | number)[] = opts.consentId ? [siteId, opts.consentId] : [siteId];
      const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM consents WHERE ${where}`).get(...args) as Row).n);
      const rows = (db.prepare(`SELECT * FROM consents WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, opts.limit ?? 50, opts.offset ?? 0) as Row[]).map(toConsent);
      return { total, rows };
    },
    consentStats(siteId: number, sinceIso: string): Record<string, number> {
      const rows = db.prepare('SELECT action, COUNT(*) AS n FROM consents WHERE site_id=? AND created_at>=? GROUP BY action').all(siteId, sinceIso) as Row[];
      return Object.fromEntries(rows.map((r) => [String(r.action), Number(r.n)]));
    },
    /** Consent choices per site, day and action since a date (for the statistics pages). */
    consentDaily(siteIds: number[] | null, sinceIso: string): { siteId: number; day: string; action: string; n: number }[] {
      if (siteIds && !siteIds.length) return [];
      const inList = siteIds ? ` AND site_id IN (${siteIds.map(() => '?').join(',')})` : '';
      return (db.prepare(`SELECT site_id, substr(created_at, 1, 10) AS day, action, COUNT(*) AS n FROM consents WHERE created_at >= ?${inList} GROUP BY 1, 2, 3`).all(sinceIso, ...(siteIds ?? [])) as Row[])
        .map((r) => ({ siteId: Number(r.site_id), day: String(r.day), action: String(r.action), n: Number(r.n) }));
    },
    /** Deletes consent records older than the rule pack's retention period. */
    purgeConsents(siteId: number, olderThanIso: string): number {
      return Number(db.prepare('DELETE FROM consents WHERE site_id=? AND created_at<?').run(siteId, olderThanIso).changes);
    },
  };
}

export function normaliseDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
}

/** True when `host` is the site's domain, one of its extra domains, or a subdomain of either. */
export function hostBelongsToSite(host: string, site: Site): boolean {
  const strip = (x: string) => x.toLowerCase().replace(/:\d+$/, '');
  const h = strip(host);
  return [site.domain, ...site.extraDomains].map(strip).some((d) => h === d || h.endsWith('.' + d));
}
