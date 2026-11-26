import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CookieMatcher, parseOcdJson } from '../src/core/cookiedb.ts';
import { categoryFromOcd } from '../src/core/categories.ts';
import { formatRetention, parseRetention, retentionDays } from '../src/core/retention.ts';
import { checkCompliance } from '../src/core/compliance.ts';
import { TranslationStore } from '../src/core/translations.ts';
import { TEMPLATES } from '../src/core/templates/index.ts';
import { buildBannerConfig, consentNeeded, markdownToHtml } from '../src/server/render.ts';
import type { Site, SiteCookie } from '../src/core/types.ts';

const words = { session: 'Session', persistent: 'Persistent', unknown: 'Unknown' };

test('retention periods are parsed and formatted per locale', () => {
  assert.deepEqual(parseRetention('1 year'), { kind: 'duration', value: 1, unit: 'year' });
  assert.deepEqual(parseRetention('Session'), { kind: 'session' });
  assert.deepEqual(parseRetention('29 Days'), { kind: 'duration', value: 29, unit: 'day' });
  assert.deepEqual(parseRetention('Unlimited'), { kind: 'persistent' });
  assert.equal(parseRetention('until you log out').kind, 'unknown');
  assert.equal(formatRetention(parseRetention('2 years'), 'nl', words), '2 jaar');
  assert.equal(formatRetention(parseRetention('1 year'), 'de', words), '1 Jahr');
  assert.equal(formatRetention(parseRetention('13 months'), 'fr', words).replace(/\s/u, ' '), '13 mois');
  assert.ok(retentionDays(parseRetention('13 months'))! > 395);
});

test('OCD categories map to consent categories', () => {
  assert.equal(categoryFromOcd('Functional'), 'necessary');
  assert.equal(categoryFromOcd('Security'), 'necessary');
  assert.equal(categoryFromOcd('Analytics'), 'statistics');
  assert.equal(categoryFromOcd('Personalization'), 'preferences');
  assert.equal(categoryFromOcd('Marketing'), 'marketing');
  assert.equal(categoryFromOcd('Something new'), 'marketing');
});

test('matcher prefers exact names, then the longest wildcard prefix', () => {
  const m = new CookieMatcher(
    parseOcdJson({
      'Google Analytics': [
        { id: '1', category: 'Analytics', cookie: '_ga', domain: '', description: 'ID', retentionPeriod: '2 years', dataController: 'Google', privacyLink: '', wildcardMatch: '0' },
        { id: '2', category: 'Analytics', cookie: '_ga_', domain: '', description: 'State', retentionPeriod: '2 years', dataController: 'Google', privacyLink: '', wildcardMatch: '1' },
        { id: '3', category: 'Marketing', cookie: '_g', domain: '', description: 'Short', retentionPeriod: '1 day', dataController: 'X', privacyLink: '', wildcardMatch: '1' },
      ],
    }),
  );
  assert.equal(m.match('_ga')?.id, '1');
  assert.equal(m.match('_ga_ABC123')?.id, '2');
  assert.equal(m.match('_gx')?.id, '3');
  assert.equal(m.match('nope'), null);
});

test('the real Open Cookie Database recognises common cookies', { skip: !safeRead('data/open-cookie-database.json') }, () => {
  const m = new CookieMatcher(parseOcdJson(JSON.parse(safeRead('data/open-cookie-database.json')!)));
  assert.ok(m.entries.length > 2000);
  assert.equal(m.match('_ga')?.category, 'statistics');
  assert.equal(m.match('_ga_Q1W2E3R4')?.category, 'statistics');
  assert.equal(m.match('_fbp')?.category, 'marketing');
});

test('translations are keyed by English text and never overwrite reviewed ones', () => {
  const t = new TranslationStore();
  t.put('nl', 'Stores consent', 'Slaat toestemming op', 'reviewed');
  t.put('nl', 'Stores consent', 'Machine', 'machine');
  assert.equal(t.translate('Stores consent', 'nl'), 'Slaat toestemming op');
  assert.equal(t.translate('Stores consent ', 'nl'), 'Slaat toestemming op'); // trimmed
  assert.equal(t.translate('Changed upstream', 'nl'), null);
  assert.equal(t.translate('Anything', 'en'), 'Anything');
});

test('every template has every key filled in', () => {
  const keys = (o: object, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, p + k + '.') : [p + k]));
  const ref = keys(TEMPLATES.en!.banner).sort();
  for (const [loc, t] of Object.entries(TEMPLATES)) {
    assert.deepEqual(keys(t.banner).sort(), ref, `${loc} keys`);
    for (const k of ref) {
      const v = k.split('.').reduce<unknown>((o, x) => (o as Record<string, unknown>)[x], t.banner);
      assert.ok(typeof v === 'string' && v.length > 0, `${loc}.${k} is empty`);
    }
    assert.ok(t.cookiePolicy.includes('{cookieTable}') && t.cookiePolicy.includes('{changeSettingsButton}'), `${loc} policy placeholders`);
  }
});

test('compliance flags pre-consent cookies but respects confirmed exemptions', () => {
  const site = {
    id: 1, orgId: 1, key: 'k', name: 'S', domain: 'example.nl', extraDomains: [], rulePack: 'nl-ap', defaultLocale: 'nl', locales: ['nl'],
    privacyPolicyUrl: 'https://example.nl/cookies', contact: 'privacy@example.nl', theme: { primary: '#000', background: '#fff', text: '#000', position: 'bottom' },
    textOverrides: {}, exemptConfirmed: [], consentMode: true, autoBlock: true, policyVersion: 1, createdAt: '', updatedAt: '',
  } satisfies Site;
  const cookie = (name: string, category: SiteCookie['category']): SiteCookie => ({
    id: 1, siteId: 1, name, domain: 'example.nl', kind: 'cookie', category, provider: '', ocdId: 'x', description: 'd',
    descriptionOverrides: {}, retention: '1 year', source: 'scan', reviewed: false, setBeforeConsent: true, firstSeen: '', lastSeen: '', exampleUrl: '',
  });
  const scan = { id: 1, siteId: 1, status: 'done' as const, startedAt: '', finishedAt: new Date().toISOString(), pagesScanned: 1, cookiesFound: 2, bannerDetected: true, thirdPartyHostsBeforeConsent: [], error: null };
  const cookies = [cookie('_pk_id', 'statistics'), cookie('PHPSESSID', 'necessary')];
  const codes = (s: Site) => checkCompliance({ site: s, cookies, latestScan: scan, missingTranslations: {} }).map((i) => i.code);
  assert.ok(codes(site).includes('PRECONSENT_COOKIES'));
  assert.ok(!codes({ ...site, exemptConfirmed: ['statistics'] }).includes('PRECONSENT_COOKIES'));
  assert.ok(codes({ ...site, privacyPolicyUrl: '' }).includes('NO_POLICY_URL'));
  // Statistics cookies need consent; with only necessary ones, or confirmed exempt, no banner is needed.
  assert.ok(!codes(site).includes('NO_BANNER_NEEDED'));
  assert.ok(codes({ ...site, exemptConfirmed: ['statistics'] }).includes('NO_BANNER_NEEDED'));
  const onlyNecessary = checkCompliance({ site, cookies: [cookie('PHPSESSID', 'necessary')], latestScan: scan, missingTranslations: {} }).map((i) => i.code);
  assert.ok(onlyNecessary.includes('NO_BANNER_NEEDED'));
  assert.ok(!checkCompliance({ site, cookies: [], latestScan: null, missingTranslations: {} }).some((i) => i.code === 'NO_BANNER_NEEDED'));
});

test('the banner is only needed when a scanned site has cookies that need consent', () => {
  const when = '2026-11-26T10:00:00Z';
  assert.equal(consentNeeded(['necessary', 'statistics'], [], null), true, 'not scanned yet: show it');
  assert.equal(consentNeeded(['necessary', 'preferences', 'statistics', 'marketing'], [], null), true);
  assert.equal(consentNeeded(['necessary'], [], when), false);
  assert.equal(consentNeeded(['necessary', 'statistics'], [], when), true);
  assert.equal(consentNeeded(['necessary', 'statistics'], ['statistics'], when), false, 'exempt statistics');
  assert.equal(consentNeeded(['necessary', 'statistics', 'marketing'], ['statistics'], when), true);

  // A site whose scan found no cookies at all needs no banner; before its first scan it does.
  const site = {
    id: 1, orgId: 1, key: 'k', name: 'S', domain: 'example.nl', extraDomains: [], rulePack: 'nl-ap', defaultLocale: 'en', locales: ['en'],
    privacyPolicyUrl: '', contact: '', theme: { primary: '#000', background: '#fff', text: '#000', position: 'bottom' },
    textOverrides: {}, exemptConfirmed: [], consentMode: true, autoBlock: true, policyVersion: 1, createdAt: '', updatedAt: '',
  } satisfies Site;
  const tr = new TranslationStore();
  const scanned = buildBannerConfig(site, [], 'en', tr, when);
  assert.deepEqual(scanned.categories, ['necessary']);
  assert.equal(scanned.consentNeeded, false);
  assert.equal(buildBannerConfig(site, [], 'en', tr, null).consentNeeded, true);
});

test('markdown renderer escapes HTML but keeps the settings button', () => {
  const html = markdownToHtml('# Title\n\nHello <script>x</script> **bold**\n\n<button type="button" data-oc-open>Change</button>\n\n| a | b |\n|---|---|\n| `x` | y |');
  assert.ok(html.includes('<h1>Title</h1>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(html.includes('<button type="button" data-oc-open>Change</button>'));
  assert.ok(html.includes('<td><code>x</code></td>'));
});

function safeRead(p: string): string | null {
  try {
    return readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  } catch {
    return null;
  }
}
