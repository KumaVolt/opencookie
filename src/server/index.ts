import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { Boot } from '../banner/banner.ts';
import { join } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { CATEGORIES, isCategory, type Category } from '../core/categories.ts';
import { checkCompliance } from '../core/compliance.ts';
import { RULE_PACKS, getRulePack } from '../core/rulepacks.ts';
import { SUPPORTED_LOCALES, TEMPLATES } from '../core/templates/index.ts';
import type { CookieMatcher } from '../core/cookiedb.ts';
import type { ConsentRecord, Site } from '../core/types.ts';
import { roleAtLeast, type Role } from './accounts.ts';
import { registerAuth } from './auth.ts';
import { config } from './config.ts';
import { downloadCookieDb, loadMatcher, loadTranslations } from './data.ts';
import { hostBelongsToSite, openDb, type SiteInput } from './db.ts';
import { buildBannerConfig, cookiePolicyMarkdown, markdownToHtml } from './render.ts';
import { ScanQueue } from './scans.ts';

export async function buildServer(opts: { dbFile?: string; logger?: boolean } = {}) {
  const db = openDb(opts.dbFile);
  db.failInterruptedScans();
  let matcher: CookieMatcher = await loadMatcher();
  const translations = await loadTranslations();
  const scans = new ScanQueue(db, () => matcher);

  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true, bodyLimit: 256 * 1024 });

  // Consent beacons are sent as text/plain to avoid CORS preflights.
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(String(body)));
    } catch {
      done(null, {});
    }
  });

  if (existsSync(config.distDir)) {
    await app.register(fastifyStatic, { root: config.distDir, prefix: '/', index: false, cacheControl: false });
  }

  // =========================================================================
  // Public API (called by the banner on visitors' browsers)
  // =========================================================================

  app.get('/health', async () => ({ ok: true }));

  // Per-site banner script: boot settings (needed synchronously for blocking) + the shared bundle.
  let bannerBundle: { mtime: number; code: string } | null = null;
  const readBundle = () => {
    const file = join(config.distDir, 'banner.js');
    const mtime = existsSync(file) ? statSync(file).mtimeMs : 0;
    if (!bannerBundle || bannerBundle.mtime !== mtime) bannerBundle = { mtime, code: mtime ? readFileSync(file, 'utf8') : '' };
    return bannerBundle.code;
  };
  app.get<{ Params: { key: string } }>('/s/:key/banner.js', async (req, reply) => {
    const site = db.getSiteByKey(req.params.key);
    reply.header('Access-Control-Allow-Origin', '*').type('application/javascript; charset=utf-8');
    if (!site) return reply.code(404).send('console.warn("OpenCookie: unknown site key");');
    const bundle = readBundle();
    if (!bundle) return reply.code(500).send('console.error("OpenCookie: banner not built");');
    const cfg = buildBannerConfig(site, db.listCookies(site.id), undefined, translations, null);
    const boot: Boot = {
      key: site.key,
      api: config.publicUrl,
      policyVersion: cfg.policyVersion,
      model: cfg.model,
      exempt: cfg.exempt,
      honorGpc: cfg.honorGpc,
      showGpcConfirmation: cfg.showGpcConfirmation,
      consentMaxAgeDays: cfg.consentMaxAgeDays,
      refusalReaskDays: cfg.refusalReaskDays,
      autoBlock: cfg.autoBlock,
      blockRules: cfg.blockRules,
      cookieNames: cfg.cookieNames,
    };
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send(`window.__OC_BOOT=${JSON.stringify(boot).replace(/</g, '\\u003c')};\n${bundle}`);
  });

  app.get<{ Params: { key: string }; Querystring: { lang?: string } }>('/api/v1/sites/:key/config', async (req, reply) => {
    const site = db.getSiteByKey(req.params.key);
    if (!site) return reply.code(404).send({ error: 'Unknown site' });
    const lang = req.query.lang ?? req.headers['accept-language']?.split(',')[0];
    const cfg = buildBannerConfig(site, db.listCookies(site.id), lang, translations, db.latestFinishedScan(site.id)?.finishedAt ?? null);
    reply.header('Access-Control-Allow-Origin', '*').header('Cache-Control', 'public, max-age=60').header('Vary', 'Accept-Language');
    return cfg;
  });

  app.get<{ Params: { key: string }; Querystring: { lang?: string; format?: string } }>('/api/v1/sites/:key/policy', async (req, reply) => {
    const site = db.getSiteByKey(req.params.key);
    if (!site) return reply.code(404).send({ error: 'Unknown site' });
    const md = cookiePolicyMarkdown(site, db.listCookies(site.id), req.query.lang, translations, db.latestFinishedScan(site.id)?.finishedAt ?? null);
    reply.header('Access-Control-Allow-Origin', '*').header('Cache-Control', 'public, max-age=300');
    if (req.query.format === 'md') return reply.type('text/markdown; charset=utf-8').send(md);
    return reply.type('text/html; charset=utf-8').send(markdownToHtml(md));
  });

  const consentRate = new Map<string, { n: number; reset: number }>();
  app.options('/api/v1/sites/:key/consent', async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*').header('Access-Control-Allow-Methods', 'POST').header('Access-Control-Allow-Headers', 'Content-Type');
    return reply.code(204).send();
  });
  app.post<{ Params: { key: string } }>('/api/v1/sites/:key/consent', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    const site = db.getSiteByKey(req.params.key);
    if (!site) return reply.code(404).send({ error: 'Unknown site' });

    // Only accept records coming from the site's own pages.
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (!hostBelongsToSite(new URL(origin).hostname, site) && !new URL(origin).hostname.match(/^(localhost|127\.0\.0\.1)$/)) {
          return reply.code(403).send({ error: 'Origin not allowed' });
        }
      } catch {
        return reply.code(400).send({ error: 'Bad origin' });
      }
    }

    // Simple per-IP rate limit: 30 records per minute.
    const t = Date.now();
    const r = consentRate.get(req.ip);
    if (!r || r.reset < t) consentRate.set(req.ip, { n: 1, reset: t + 60_000 });
    else if (++r.n > 30) return reply.code(429).send({ error: 'Too many requests' });
    if (consentRate.size > 50_000) consentRate.clear();

    // Our own scanner accepts cookies to discover them; that is not a visitor's consent.
    if (String(req.headers['user-agent'] ?? '').includes('OpenCookieScanner')) return reply.code(204).send();

    const b = (req.body ?? {}) as Record<string, unknown>;
    const consentId = typeof b.id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.id) ? b.id : null;
    const actions: ConsentRecord['action'][] = ['accept_all', 'reject_all', 'custom', 'gpc', 'opt_out'];
    const action = actions.find((a) => a === b.action);
    const cats = Array.isArray(b.categories) ? (b.categories.filter(isCategory) as Category[]) : null;
    if (!consentId || !action || !cats) return reply.code(400).send({ error: 'Invalid consent record' });

    db.insertConsent({
      siteId: site.id,
      consentId,
      policyVersion: Number(b.policyVersion) || site.policyVersion,
      categories: [...new Set<Category>(['necessary', ...cats])],
      action,
      locale: String(b.locale ?? '').slice(0, 10),
      gpc: Boolean(b.gpc),
      url: String(b.url ?? '').slice(0, 500),
      ipHash: hashIp(req.ip),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    });
    return reply.code(204).send();
  });

  // =========================================================================
  // Admin
  // =========================================================================

  const auth = registerAuth(app, db);

  // Every /admin/api/sites/:id… route: the user must be a member of the site's client (organisation).
  // Reading needs "viewer", changing needs "editor", deleting a site needs "owner".
  app.addHook('preHandler', async (req, reply) => {
    const route = req.routeOptions.url ?? '';
    if (!route.startsWith('/admin/api/sites/:id')) return;
    const site = db.getSite(Number((req.params as { id?: string }).id));
    const role = site && req.user ? auth.siteRole(req.user, site) : null;
    if (!site || !role) return reply.code(404).send({ error: 'Not found' });
    const need: Role = req.method === 'GET' ? 'viewer' : req.method === 'DELETE' && route === '/admin/api/sites/:id' ? 'owner' : 'editor';
    if (!roleAtLeast(role, need)) return reply.code(403).send({ error: `You need the ${need} role for this.` });
    (req as { site?: Site }).site = site;
  });
  const siteOf = (req: FastifyRequest) => (req as { site?: Site }).site!;

  app.get('/admin/api/meta', async () => ({
    publicUrl: config.publicUrl,
    appName: config.appName,
    rulePacks: RULE_PACKS,
    locales: SUPPORTED_LOCALES.map((l) => ({ code: l, name: TEMPLATES[l]!.languageName })),
    categories: CATEGORIES,
    templates: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, TEMPLATES[l]!.banner])),
    cookieDb: { entries: matcher.entries.length },
    translations: Object.fromEntries(translations.locales().map((l) => [l, Object.keys(translations.get(l)).length])),
  }));

  app.post('/admin/api/cookie-db/update', async (req) => {
    auth.requirePlatform(req);
    const n = await downloadCookieDb();
    matcher = await loadMatcher();
    return { entries: n };
  });

  // ---- sites ----
  app.get('/admin/api/sites', async (req) => {
    const u = req.user!;
    const sites = u.isPlatformAdmin ? db.listSites() : db.listSitesInOrgs(db.memberships(u.id).map((m) => m.orgId));
    const orgNames = new Map(db.listOrgs().map((o) => [o.id, o.name]));
    return sites.map((s) => ({
      ...s,
      orgName: s.orgId ? orgNames.get(s.orgId) ?? '' : '',
      yourRole: auth.siteRole(u, s),
      latestScan: db.latestFinishedScan(s.id),
      cookieCount: db.listCookies(s.id).length,
    }));
  });

  app.post<{ Body: SiteInput & { name: string; domain: string; orgId?: number } }>('/admin/api/sites', async (req, reply) => {
    const orgId = Number(req.body?.orgId);
    if (!orgId || !db.getOrg(orgId)) return reply.code(400).send({ error: 'Choose the client this site belongs to.' });
    if (!roleAtLeast(auth.orgRole(req.user!, orgId), 'owner')) return reply.code(403).send({ error: 'Only owners of this client can add sites.' });
    const body = sanitiseSiteInput(req.body);
    if (!body.name || !body.domain) return reply.code(400).send({ error: 'Name and domain are required' });
    const site = db.createSite(orgId, body as SiteInput & { name: string; domain: string });
    auth.audit(req, 'site_created', { orgId, siteId: site.id, detail: `${site.name} (${site.domain})` });
    return site;
  });

  app.get<{ Params: { id: string } }>('/admin/api/sites/:id', async (req) => {
    const site = siteOf(req);
    return { ...site, yourRole: auth.siteRole(req.user!, site), orgName: site.orgId ? db.getOrg(site.orgId)?.name ?? '' : '' };
  });

  app.put<{ Params: { id: string }; Body: SiteInput }>('/admin/api/sites/:id', async (req) => {
    const before = siteOf(req);
    const id = before.id;
    const site = db.updateSite(id, sanitiseSiteInput(req.body))!;
    // Purposes or texts changed → ask visitors again.
    if (JSON.stringify(before.textOverrides) !== JSON.stringify(site.textOverrides) || before.rulePack !== site.rulePack || JSON.stringify(before.exemptConfirmed) !== JSON.stringify(site.exemptConfirmed)) {
      db.bumpPolicyVersion(id);
    }
    const changed = (Object.keys(req.body ?? {}) as (keyof Site)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(site[k]));
    if (changed.length) auth.audit(req, 'site_updated', { orgId: site.orgId, siteId: id, detail: changed.join(', ') });
    const fresh = db.getSite(id)!;
    return { ...fresh, yourRole: auth.siteRole(req.user!, fresh), orgName: fresh.orgId ? db.getOrg(fresh.orgId)?.name ?? '' : '' };
  });

  app.delete<{ Params: { id: string } }>('/admin/api/sites/:id', async (req) => {
    const site = siteOf(req);
    db.deleteSite(site.id);
    auth.audit(req, 'site_deleted', { orgId: site.orgId, siteId: site.id, detail: `${site.name} (${site.domain})` });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/admin/api/sites/:id/embed', async (req) => {
    const site = siteOf(req);
    return {
      head: `<script src="${config.publicUrl}/s/${site.key}/banner.js"></script>`,
      policy: `<div data-oc-declaration></div>`,
      policyUrl: `${config.publicUrl}/api/v1/sites/${site.key}/policy?lang=${site.defaultLocale}`,
      manualBlocking: `<script type="text/plain" data-oc-category="statistics" src="https://example.com/analytics.js"></script>`,
    };
  });

  // ---- cookies ----
  app.get<{ Params: { id: string } }>('/admin/api/sites/:id/cookies', async (req) => {
    const site = siteOf(req);
    return db.listCookies(site.id).map((c) => ({
      ...c,
      translations: Object.fromEntries(site.locales.map((l) => [l, c.descriptionOverrides[l] || translations.translate(c.description, l)])),
    }));
  });

  app.post<{ Params: { id: string }; Body: Record<string, string> }>('/admin/api/sites/:id/cookies', async (req, reply) => {
    const b = req.body ?? {};
    if (!b.name || !isCategory(b.category)) return reply.code(400).send({ error: 'Name and a valid category are required' });
    const c = db.addManualCookie(Number(req.params.id), {
      name: b.name,
      domain: b.domain ?? '',
      kind: b.kind === 'localStorage' || b.kind === 'sessionStorage' ? b.kind : 'cookie',
      category: b.category,
      provider: b.provider ?? '',
      description: b.description ?? '',
      retention: b.retention ?? '',
    });
    if (c.category !== 'necessary') db.bumpPolicyVersion(c.siteId);
    auth.audit(req, 'cookie_added', { orgId: siteOf(req).orgId, siteId: c.siteId, detail: `${c.name} (${c.category})` });
    return c;
  });

  app.put<{ Params: { id: string; cookieId: string }; Body: Record<string, unknown> }>('/admin/api/sites/:id/cookies/:cookieId', async (req, reply) => {
    const b = req.body ?? {};
    const before = db.getCookie(Number(req.params.cookieId));
    if (!before || before.siteId !== Number(req.params.id)) return reply.code(404).send({ error: 'Not found' });
    const c = db.updateCookie(before.id, {
      category: isCategory(b.category) ? b.category : undefined,
      provider: typeof b.provider === 'string' ? b.provider : undefined,
      description: typeof b.description === 'string' ? b.description : undefined,
      retention: typeof b.retention === 'string' ? b.retention : undefined,
      descriptionOverrides: isStringRecord(b.descriptionOverrides) ? b.descriptionOverrides : undefined,
    })!;
    if (before.category !== c.category) db.bumpPolicyVersion(c.siteId);
    auth.audit(req, 'cookie_updated', { orgId: siteOf(req).orgId, siteId: c.siteId, detail: before.category !== c.category ? `${c.name}: ${before.category} → ${c.category}` : c.name });
    return c;
  });

  app.delete<{ Params: { id: string; cookieId: string } }>('/admin/api/sites/:id/cookies/:cookieId', async (req) => {
    const c = db.getCookie(Number(req.params.cookieId));
    if (c && c.siteId === Number(req.params.id)) {
      db.deleteCookie(c.id);
      auth.audit(req, 'cookie_deleted', { orgId: siteOf(req).orgId, siteId: c.siteId, detail: c.name });
    }
    return { ok: true };
  });

  // ---- scans ----
  app.get<{ Params: { id: string } }>('/admin/api/sites/:id/scans', async (req) => db.listScans(Number(req.params.id)));
  app.post<{ Params: { id: string } }>('/admin/api/sites/:id/scans', async (req, reply) => {
    const id = siteOf(req).id;
    if (scans.isBusy(id)) return reply.code(409).send({ error: 'A scan is already running for this site' });
    return { scanId: scans.enqueue(id) };
  });

  // ---- compliance ----
  app.get<{ Params: { id: string } }>('/admin/api/sites/:id/compliance', async (req) => {
    const site = siteOf(req);
    const cookies = db.listCookies(site.id);
    const missingTranslations: Record<string, number> = {};
    for (const l of site.locales) {
      if (l === 'en') continue;
      missingTranslations[l] = cookies.filter((c) => c.description && !c.descriptionOverrides[l] && !translations.translate(c.description, l)).length;
    }
    return {
      rulePack: getRulePack(site.rulePack),
      issues: checkCompliance({ site, cookies, latestScan: db.latestFinishedScan(site.id), missingTranslations }),
    };
  });

  // ---- consent log ----
  app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string; consentId?: string } }>('/admin/api/sites/:id/consents', async (req) => {
    const siteId = Number(req.params.id);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    return {
      ...db.listConsents(siteId, {
        limit: Math.min(200, Number(req.query.limit ?? 50)),
        offset: Number(req.query.offset ?? 0),
        consentId: req.query.consentId || undefined,
      }),
      last30Days: db.consentStats(siteId, since),
    };
  });

  app.get<{ Params: { id: string } }>('/admin/api/sites/:id/consents.csv', async (req, reply) => {
    const siteId = Number(req.params.id);
    const { rows } = db.listConsents(siteId, { limit: 1_000_000 });
    auth.audit(req, 'consents_exported', { orgId: siteOf(req).orgId, siteId });
    const q = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [
      'created_at,consent_id,action,categories,policy_version,locale,gpc,url,ip_hash,user_agent',
      ...rows.map((r) => [r.createdAt, r.consentId, r.action, r.categories.join(' '), r.policyVersion, r.locale, r.gpc, r.url, r.ipHash, r.userAgent].map(q).join(',')),
    ].join('\n');
    reply.header('Content-Disposition', `attachment; filename="consents-site-${siteId}.csv"`);
    return reply.type('text/csv; charset=utf-8').send(csv);
  });

  // ---- statistics: everything for platform admins, otherwise the user's own clients ----
  app.get<{ Querystring: { orgId?: string; days?: string } }>('/admin/api/stats', async (req, reply) => {
    const u = req.user!;
    const days = Math.min(365, Math.max(7, Number(req.query.days ?? 30) || 30));
    const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const myOrgIds = u.isPlatformAdmin ? db.listOrgs().map((o) => o.id) : db.memberships(u.id).map((m) => m.orgId);
    let orgIds = myOrgIds;
    if (req.query.orgId) {
      const id = Number(req.query.orgId);
      if (!myOrgIds.includes(id)) return reply.code(404).send({ error: 'Not found' });
      orgIds = [id];
    }
    const sites = db.listSitesInOrgs(orgIds);
    const rows = db.consentDaily(sites.map((s) => s.id), since);
    const orgOf = new Map(sites.map((s) => [s.id, s.orgId]));
    const empty = () => ({ total: 0, accept_all: 0, reject_all: 0, custom: 0, gpc: 0, opt_out: 0 });
    type Counts = ReturnType<typeof empty>;
    const add = (c: Counts, action: string, n: number) => {
      c.total += n;
      if (action in c) (c as Record<string, number>)[action]! += n;
    };
    const total = empty();
    const bySite = new Map<number, Counts>();
    const byOrg = new Map<number, Counts>();
    const byDay = new Map<string, Counts>();
    for (const r of rows) {
      add(total, r.action, r.n);
      add(bySite.get(r.siteId) ?? (bySite.set(r.siteId, empty()), bySite.get(r.siteId)!), r.action, r.n);
      const o = orgOf.get(r.siteId) ?? 0;
      add(byOrg.get(o) ?? (byOrg.set(o, empty()), byOrg.get(o)!), r.action, r.n);
      add(byDay.get(r.day) ?? (byDay.set(r.day, empty()), byDay.get(r.day)!), r.action, r.n);
    }
    const series = Array.from({ length: days }, (_, i) => {
      const day = new Date(Date.parse(since) + i * 86_400_000).toISOString().slice(0, 10);
      return { day, ...(byDay.get(day) ?? empty()) };
    });
    const siteRows = sites.map((s) => {
      const latest = db.latestFinishedScan(s.id);
      const cookies = db.listCookies(s.id);
      const issues = checkCompliance({ site: s, cookies, latestScan: latest, missingTranslations: {} });
      return {
        id: s.id, name: s.name, domain: s.domain, orgId: s.orgId,
        consents: bySite.get(s.id) ?? empty(),
        cookies: cookies.length,
        problems: issues.filter((i) => i.severity === 'error').length,
        warnings: issues.filter((i) => i.severity === 'warning').length,
        lastScan: latest?.finishedAt ?? null,
      };
    });
    const orgs = db.listOrgs().filter((o) => orgIds.includes(o.id)).map((o) => {
      const own = siteRows.filter((s) => s.orgId === o.id);
      return { id: o.id, name: o.name, sites: own.length, members: db.orgMembers(o.id).length, consents: byOrg.get(o.id) ?? empty(), problems: own.reduce((a, s) => a + s.problems, 0) };
    });
    return {
      days,
      since,
      scope: req.query.orgId ? 'client' : u.isPlatformAdmin ? 'platform' : 'mine',
      totals: {
        clients: orgs.length,
        sites: sites.length,
        users: u.isPlatformAdmin && !req.query.orgId ? db.countUsers() : new Set(orgIds.flatMap((id) => db.orgMembers(id).map((m) => m.id))).size,
        sitesWithProblems: siteRows.filter((s) => s.problems > 0).length,
        consents: total,
      },
      series,
      orgs,
      sites: siteRows,
    };
  });

  // Admin single-page app
  const sendAdmin = (_req: FastifyRequest, reply: FastifyReply) =>
    existsSync(join(config.distDir, 'admin/index.html'))
      ? reply.type('text/html; charset=utf-8').sendFile('admin/index.html')
      : reply.code(500).send('Admin UI not built. Run "npm run build".');
  app.get('/', async (_req, reply) => reply.redirect('/admin/'));
  app.get('/admin', async (_req, reply) => reply.redirect('/admin/'));
  app.get('/admin/', sendAdmin);

  // Daily housekeeping: delete consent records past the rule pack's retention period.
  const purge = () => {
    for (const s of db.listSites()) {
      const days = getRulePack(s.rulePack).consentLogRetentionDays;
      db.purgeConsents(s.id, new Date(Date.now() - days * 86_400_000).toISOString());
    }
  };
  purge();
  setInterval(purge, 24 * 3600_000).unref();

  return { app, db, scans };
}

function hashIp(ip: string): string {
  // Truncate before hashing (IPv4 /24, IPv6 /48) so the stored value is not a full IP address.
  const truncated = ip.includes(':') ? ip.split(':').slice(0, 3).join(':') : ip.split('.').slice(0, 3).join('.');
  return createHash('sha256').update(config.secret + truncated).digest('hex').slice(0, 24);
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return typeof v === 'object' && v !== null && Object.values(v).every((x) => typeof x === 'string');
}

function sanitiseSiteInput(b: unknown): SiteInput {
  const i = (b ?? {}) as Record<string, unknown>;
  const out: SiteInput = {};
  if (typeof i.name === 'string') out.name = i.name.trim().slice(0, 200);
  if (typeof i.domain === 'string') out.domain = i.domain;
  if (Array.isArray(i.extraDomains)) out.extraDomains = i.extraDomains.filter((d): d is string => typeof d === 'string' && d.trim() !== '');
  if (typeof i.rulePack === 'string' && RULE_PACKS.some((p) => p.id === i.rulePack)) out.rulePack = i.rulePack;
  if (Array.isArray(i.locales)) {
    const l = i.locales.filter((x): x is string => typeof x === 'string' && SUPPORTED_LOCALES.includes(x));
    if (l.length) out.locales = l;
  }
  if (typeof i.defaultLocale === 'string' && SUPPORTED_LOCALES.includes(i.defaultLocale)) out.defaultLocale = i.defaultLocale;
  if (out.locales && out.defaultLocale && !out.locales.includes(out.defaultLocale)) out.locales = [out.defaultLocale, ...out.locales];
  if (typeof i.privacyPolicyUrl === 'string') out.privacyPolicyUrl = i.privacyPolicyUrl.trim();
  if (typeof i.contact === 'string') out.contact = i.contact.trim();
  if (typeof i.theme === 'object' && i.theme) {
    const t = i.theme as Record<string, unknown>;
    const colour = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined);
    out.theme = {
      primary: colour(t.primary) ?? '#1a1a1a',
      background: colour(t.background) ?? '#ffffff',
      text: colour(t.text) ?? '#1a1a1a',
      position: t.position === 'center' || t.position === 'bottom-left' ? t.position : 'bottom',
    };
  }
  if (typeof i.textOverrides === 'object' && i.textOverrides) out.textOverrides = i.textOverrides as SiteInput['textOverrides'];
  if (Array.isArray(i.exemptConfirmed)) out.exemptConfirmed = i.exemptConfirmed.filter(isCategory);
  if (typeof i.consentMode === 'boolean') out.consentMode = i.consentMode;
  if (typeof i.autoBlock === 'boolean') out.autoBlock = i.autoBlock;
  return out;
}

// Start when run directly.
if (import.meta.main) {
  const { app } = await buildServer();
  await app.listen({ port: config.port, host: config.host });
  console.log(`[opencookie] Admin: ${config.publicUrl}/admin/`);
}
