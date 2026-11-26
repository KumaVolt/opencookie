import { CATEGORIES, type Category } from '../core/categories.ts';
import { rulesFor, type BlockRule } from '../core/blocklist.ts';
import { exemptCategories } from '../core/compliance.ts';
import { formatRetention, parseRetention } from '../core/retention.ts';
import { getRulePack } from '../core/rulepacks.ts';
import { getTemplate, mergeTexts, type BannerTexts } from '../core/templates/index.ts';
import type { TranslationStore } from '../core/translations.ts';
import type { Site, SiteCookie } from '../core/types.ts';

export interface DeclaredCookie {
  name: string;
  provider: string;
  purpose: string;
  expiry: string;
  kind: string;
}

/** Everything the banner script needs, in one cacheable response. */
export interface BannerConfig {
  v: 1;
  siteKey: string;
  policyVersion: number;
  locale: string;
  locales: string[];
  model: 'opt-in' | 'opt-out';
  honorGpc: boolean;
  showGpcConfirmation: boolean;
  consentMaxAgeDays: number;
  refusalReaskDays: number;
  exempt: Category[];
  categories: Category[];
  /**
   * False when a finished scan found only necessary (or exempt) cookies: then the banner
   * stays hidden unless the page itself holds back something that needs consent.
   */
  consentNeeded: boolean;
  consentMode: boolean;
  autoBlock: boolean;
  blockRules: BlockRule[];
  /** First-party cookie names per category, removed when consent for that category is withdrawn. */
  cookieNames: Record<string, string[]>;
  theme: Site['theme'];
  privacyPolicyUrl: string;
  texts: BannerTexts;
  cookies: Record<Category, DeclaredCookie[]>;
  lastScanned: string | null;
}

export function pickLocale(site: Site, requested: string | undefined): string {
  const want = (requested ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return site.locales.includes(want) ? want : site.defaultLocale;
}

export function textsFor(site: Site, locale: string): BannerTexts {
  return mergeTexts(getTemplate(locale).banner, site.textOverrides[locale]);
}

/** Description in the requested language: owner override → translation file → English. */
export function describe(cookie: SiteCookie, locale: string, tr: TranslationStore): string {
  return cookie.descriptionOverrides[locale] || tr.translate(cookie.description, locale) || cookie.description;
}

export function declaredCookies(cookies: SiteCookie[], locale: string, tr: TranslationStore, texts: BannerTexts): Record<Category, DeclaredCookie[]> {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, [] as DeclaredCookie[]])) as Record<Category, DeclaredCookie[]>;
  for (const c of cookies) {
    out[c.category].push({
      name: c.name,
      provider: c.provider || c.domain || '—',
      purpose: describe(c, locale, tr),
      expiry: formatRetention(parseRetention(c.retention), locale, texts.declaration),
      kind: c.kind,
    });
  }
  return out;
}

/**
 * A banner is only needed when the site sets cookies that need consent. Without a finished
 * scan we cannot know, so it is shown. Unknown cookies count as marketing, so they need it too.
 */
export function consentNeeded(categories: Category[], exempt: Category[], lastScanned: string | null): boolean {
  if (!lastScanned) return true;
  return categories.some((c) => c !== 'necessary' && !exempt.includes(c));
}

export function buildBannerConfig(site: Site, cookies: SiteCookie[], requestedLocale: string | undefined, tr: TranslationStore, lastScanned: string | null): BannerConfig {
  const pack = getRulePack(site.rulePack);
  const locale = pickLocale(site, requestedLocale);
  const texts = textsFor(site, locale);
  const declared = declaredCookies(cookies, locale, tr, texts);
  // Show necessary plus every category that actually has cookies. With no cookies known and no
  // finished scan yet, show all: we can't tell what the site sets. A scan that found none means none.
  const categories = cookies.length || lastScanned ? CATEGORIES.filter((c) => c === 'necessary' || declared[c].length > 0) : [...CATEGORIES];
  const cookieNames: Record<string, string[]> = {};
  for (const c of cookies) {
    if (c.category === 'necessary') continue;
    (cookieNames[c.category] ??= []).push(c.name);
  }
  return {
    v: 1,
    siteKey: site.key,
    policyVersion: site.policyVersion,
    locale,
    locales: site.locales,
    model: pack.model,
    honorGpc: pack.honorGpc,
    showGpcConfirmation: pack.showGpcConfirmation,
    consentMaxAgeDays: pack.consentMaxAgeDays,
    refusalReaskDays: pack.refusalReaskDays,
    exempt: exemptCategories(site, pack),
    categories,
    consentNeeded: consentNeeded(categories, exemptCategories(site, pack), lastScanned),
    consentMode: site.consentMode,
    autoBlock: site.autoBlock,
    blockRules: site.autoBlock ? rulesFor(site.consentMode) : [],
    cookieNames,
    theme: site.theme,
    privacyPolicyUrl: site.privacyPolicyUrl,
    texts,
    cookies: declared,
    lastScanned,
  };
}

// ---------------------------------------------------------------------------
// Cookie policy page (Markdown and HTML)
// ---------------------------------------------------------------------------

export function cookiePolicyMarkdown(site: Site, cookies: SiteCookie[], requestedLocale: string | undefined, tr: TranslationStore, lastScanned: string | null): string {
  const locale = pickLocale(site, requestedLocale);
  const texts = textsFor(site, locale);
  const declared = declaredCookies(cookies, locale, tr, texts);
  const d = texts.declaration;
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const table = CATEGORIES.map((cat) => {
    const head = `### ${texts.categories[cat].label}\n\n${texts.categories[cat].description}\n\n`;
    const rows = declared[cat];
    if (!rows.length) return head + `_${d.noCookies}_\n`;
    return (
      head +
      `| ${d.name} | ${d.provider} | ${d.purpose} | ${d.expiry} |\n|---|---|---|---|\n` +
      rows.map((r) => `| \`${esc(r.name)}\` | ${esc(r.provider)} | ${esc(r.purpose)} | ${esc(r.expiry)} |`).join('\n') +
      '\n'
    );
  }).join('\n');
  const dateFmt = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(iso));
  return getTemplate(locale)
    .cookiePolicy.replaceAll('{siteName}', site.name)
    .replaceAll('{siteUrl}', `https://${site.domain}`)
    .replaceAll('{contact}', site.contact || '—')
    .replaceAll('{lastUpdated}', dateFmt(lastScanned ?? site.updatedAt))
    .replaceAll('{changeSettingsButton}', `<button type="button" data-oc-open>${d.changeSettings}</button>`)
    .replaceAll('{cookieTable}', table);
}

/**
 * The hosted cookie policy as a page of its own, for sites that link to it instead of
 * embedding it. It loads the site's banner so the "change settings" button works here too.
 */
export function policyPage(site: Site, locale: string, body: string, bannerSrc: string): string {
  const title = body.match(/<h1>(.*?)<\/h1>/)?.[1] ?? 'Cookie policy';
  return `<!doctype html>
<html lang="${escHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · ${escHtml(site.name)}</title>
<script src="${escHtml(bannerSrc)}"></script>
<style>
  :root { color-scheme: light dark; --text: #1d1d1b; --muted: #5f5f5a; --line: #dcdcd6; --bg: #fff; --soft: #f5f5f2; --btn: ${site.theme.primary}; }
  @media (prefers-color-scheme: dark) { :root { --text: #ececea; --muted: #a5a5a0; --line: #3a3a37; --bg: #161615; --soft: #1f1f1e; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem 4rem; }
  h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 .25rem; }
  h2 { font-size: 1.3rem; margin: 2.25rem 0 .5rem; }
  h3 { font-size: 1.05rem; margin: 1.75rem 0 .25rem; }
  p { margin: .5rem 0; }
  em { color: var(--muted); }
  code { font: .85em/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .table { overflow-x: auto; margin: .75rem 0 1rem; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  th, td { text-align: left; vertical-align: top; padding: .5rem .75rem .5rem 0; border-bottom: 1px solid var(--line); }
  th { font-weight: 600; color: var(--muted); }
  button { font: inherit; font-weight: 600; color: var(--bg); background: var(--text); border: 0; border-radius: 6px; padding: .6rem 1rem; cursor: pointer; }
  @media (prefers-color-scheme: light) { button { color: #fff; background: var(--btn); } }
  button:focus-visible { outline: 3px solid var(--text); outline-offset: 3px; }
  a { color: inherit; }
</style>
</head>
<body>
<main>
${body.replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, '</table></div>')}
</main>
</body>
</html>`;
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Minimal Markdown → HTML for the policy template (headings, paragraphs, emphasis, code, tables). */
export function markdownToHtml(md: string): string {
  const inline = (s: string) =>
    escHtml(s)
      .replace(/&lt;button type=&quot;button&quot; data-oc-open&gt;(.*?)&lt;\/button&gt;/g, '<button type="button" data-oc-open>$1</button>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1<em>$2</em>')
      .replace(/\\\|/g, '|');
  const out: string[] = [];
  const blocks = md.trim().split(/\n{2,}/);
  for (const b of blocks) {
    const lines = b.split('\n');
    const h = b.match(/^(#{1,6})\s+(.*)$/);
    if (h && lines.length === 1) {
      out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`);
    } else if (lines.length >= 2 && /^\|.*\|$/.test(lines[0]!) && /^\|[-|\s]+\|$/.test(lines[1]!)) {
      const cells = (l: string) => l.slice(1, -1).split(/(?<!\\)\|/).map((c) => inline(c.trim()));
      out.push(
        '<table><thead><tr>' + cells(lines[0]!).map((c) => `<th scope="col">${c}</th>`).join('') + '</tr></thead><tbody>' +
          lines.slice(2).map((l) => '<tr>' + cells(l).map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') +
          '</tbody></table>',
      );
    } else {
      out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}
