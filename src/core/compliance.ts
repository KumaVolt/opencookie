import type { Category } from './categories.ts';
import { getRulePack, type RulePack } from './rulepacks.ts';
import { parseRetention, retentionDays } from './retention.ts';
import type { ScanSummary, Site, SiteCookie } from './types.ts';

export interface ComplianceIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  /** Cookie names or hosts the issue is about. */
  items?: string[];
}

export interface ComplianceInput {
  site: Site;
  cookies: SiteCookie[];
  latestScan: ScanSummary | null;
  /** Locales for which a description translation is missing, per cookie id. */
  missingTranslations: Record<string, number>;
  now?: Date;
}

/** Categories that may run before consent for this site. */
export function exemptCategories(site: Site, pack: RulePack = getRulePack(site.rulePack)): Category[] {
  const set = new Set<Category>(pack.exemptCategories);
  // The owner confirmed the conditions of the site's own rule pack, not those of its country rules.
  if (pack.id !== site.rulePack) return [...set];
  for (const c of pack.conditionalExemptCategories) {
    if (site.exemptConfirmed.includes(c.category)) set.add(c.category);
  }
  return [...set];
}

/**
 * Checks a site's configuration and latest scan against its rule pack.
 * Banner behaviour (reject on first layer, equal buttons, no pre-ticked boxes, withdraw button,
 * no cookie wall) is enforced by the banner itself and cannot be configured away, so it is not
 * checked here; the checker focuses on what the site actually does.
 */
export function checkCompliance(input: ComplianceInput): ComplianceIssue[] {
  const { site, cookies, latestScan } = input;
  const now = input.now ?? new Date();
  const pack = getRulePack(site.rulePack);
  const exempt = new Set(exemptCategories(site, pack));
  const issues: ComplianceIssue[] = [];

  if (!latestScan || latestScan.status !== 'done') {
    issues.push({ severity: 'warning', code: 'NO_SCAN', message: 'This site has not been scanned yet. Run a scan to detect cookies.' });
  } else {
    const ageDays = (now.getTime() - new Date(latestScan.finishedAt ?? 0).getTime()) / 86_400_000;
    if (ageDays > 31) {
      issues.push({ severity: 'warning', code: 'STALE_SCAN', message: `The last scan is ${Math.floor(ageDays)} days old. Scan at least monthly.` });
    }
    if (latestScan.bannerDetected === false) {
      issues.push({ severity: 'error', code: 'BANNER_NOT_FOUND', message: 'The scanner did not find the OpenCookie banner on the site. Add the embed snippet to every page.' });
    }
    if (pack.model === 'opt-in' && latestScan.thirdPartyHostsBeforeConsent.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'THIRD_PARTY_BEFORE_CONSENT',
        message: 'These third-party hosts were contacted before consent. Check that none of them track visitors (fonts, video embeds and tag managers often do).',
        items: latestScan.thirdPartyHostsBeforeConsent,
      });
    }
  }

  if (pack.model === 'opt-in') {
    const pre = cookies.filter((c) => c.setBeforeConsent && !exempt.has(c.category));
    if (pre.length) {
      issues.push({
        severity: 'error',
        code: 'PRECONSENT_COOKIES',
        message: 'These cookies were set before the visitor gave consent. Block the scripts that set them (enable auto-blocking or mark them with data-oc-category).',
        items: pre.map((c) => `${c.name} (${c.category})`),
      });
    }
  }

  const unreviewed = cookies.filter((c) => !c.ocdId && !c.reviewed);
  if (unreviewed.length) {
    issues.push({
      severity: 'warning',
      code: 'UNKNOWN_COOKIES',
      message: 'These cookies are not in the Open Cookie Database. They are treated as marketing until you set a category and description.',
      items: unreviewed.map((c) => c.name),
    });
  }

  // Visitors must be able to change their choice as easily as they gave it.
  const needsConsent = cookies.some((c) => c.category !== 'necessary' && !exempt.has(c.category));
  if (site.theme.floatingButton === false && needsConsent && latestScan?.status === 'done' && latestScan.settingsLinkFound !== true) {
    issues.push({
      severity: 'error',
      code: 'NO_WAY_TO_CHANGE',
      message: latestScan.settingsLinkFound === false
        ? 'The cookie button is off and the scan found no other way to change cookie settings. Add a link with data-oc-open (for example in your footer) or the cookie policy block with data-oc-policy.'
        : 'The cookie button is off. Make sure every page has a link with data-oc-open, or the cookie policy block with data-oc-policy, then scan again to check.',
    });
  }

  if (!site.privacyPolicyUrl) {
    issues.push({ severity: 'error', code: 'NO_POLICY_URL', message: 'Set a cookie or privacy policy URL. Visitors must be able to read what each cookie does.' });
  }
  if (!site.contact) {
    issues.push({ severity: 'warning', code: 'NO_CONTACT', message: 'Set a contact address for privacy questions; it appears in the cookie policy.' });
  }

  if (pack.maxCookieLifetimeDays !== null) {
    const tooLong = cookies.filter((c) => {
      if (c.category === 'necessary') return false;
      const d = retentionDays(parseRetention(c.retention));
      return d !== null && d > pack.maxCookieLifetimeDays!;
    });
    if (tooLong.length) {
      issues.push({
        severity: 'warning',
        code: 'COOKIE_LIFETIME',
        message: `${pack.name} expects non-essential cookies to last at most ${Math.round(pack.maxCookieLifetimeDays / 30.44)} months.`,
        items: tooLong.map((c) => `${c.name} (${c.retention})`),
      });
    }
  }

  const missing = Object.entries(input.missingTranslations).filter(([, n]) => n > 0);
  if (missing.length) {
    issues.push({
      severity: 'warning',
      code: 'MISSING_TRANSLATIONS',
      message: 'Some cookie descriptions are not translated yet and will be shown in English. Run "npm run translate" or add them in the Cookies tab.',
      items: missing.map(([loc, n]) => `${loc}: ${n}`),
    });
  }

  for (const c of pack.conditionalExemptCategories) {
    if (site.exemptConfirmed.includes(c.category)) {
      issues.push({
        severity: 'info',
        code: 'EXEMPTION_CONDITIONS',
        message: `You marked "${c.category}" as exempt from consent. This is only lawful if all of these stay true:`,
        items: c.conditions,
      });
    }
  }

  if (latestScan?.status === 'done' && cookies.every((c) => c.category === 'necessary' || exempt.has(c.category))) {
    issues.push({
      severity: 'info',
      code: 'NO_BANNER_NEEDED',
      message: 'The last scan found only cookies that need no consent, so visitors see no banner. It appears by itself when a script or embed that needs consent turns up on a page.',
    });
  }
  return issues;
}
