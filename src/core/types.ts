import type { Category } from './categories.ts';
import type { BannerTexts } from './templates/types.ts';

export interface SiteTheme {
  /** Colour for both Accept and Reject (they are always styled the same). */
  primary: string;
  background: string;
  text: string;
  position: 'bottom' | 'center' | 'bottom-left';
}

export interface Site {
  id: number;
  /** Public identifier used in the embed snippet. */
  key: string;
  name: string;
  /** Primary hostname, e.g. "example.nl". Subdomains are allowed automatically. */
  domain: string;
  extraDomains: string[];
  rulePack: string;
  defaultLocale: string;
  locales: string[];
  privacyPolicyUrl: string;
  contact: string;
  theme: SiteTheme;
  textOverrides: Record<string, DeepPartial<BannerTexts>>;
  /** Categories whose conditional exemption (e.g. privacy-friendly analytics) the owner has confirmed. */
  exemptConfirmed: Category[];
  /** Send Google Consent Mode v2 signals. */
  consentMode: boolean;
  /** Automatically block known third-party scripts until consent. */
  autoBlock: boolean;
  /** Bumped whenever cookies or texts change in a way that requires asking again. */
  policyVersion: number;
  createdAt: string;
  updatedAt: string;
}

export type CookieKind = 'cookie' | 'localStorage' | 'sessionStorage';

export interface SiteCookie {
  id: number;
  siteId: number;
  name: string;
  domain: string;
  kind: CookieKind;
  category: Category;
  provider: string;
  /** Open Cookie Database ID when matched. */
  ocdId: string | null;
  /** English description (from OCD or entered by the owner). */
  description: string;
  /** Per-locale descriptions entered by the owner; override the translation files. */
  descriptionOverrides: Record<string, string>;
  retention: string;
  source: 'scan' | 'manual';
  /** True when a human has checked the category/description. */
  reviewed: boolean;
  setBeforeConsent: boolean;
  firstSeen: string;
  lastSeen: string;
  exampleUrl: string;
}

export interface ScanSummary {
  id: number;
  siteId: number;
  status: 'queued' | 'running' | 'done' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  pagesScanned: number;
  cookiesFound: number;
  bannerDetected: boolean | null;
  /** Third-party hosts contacted before any consent was given. */
  thirdPartyHostsBeforeConsent: string[];
  error: string | null;
}

export interface ConsentRecord {
  id: number;
  siteId: number;
  consentId: string;
  policyVersion: number;
  categories: Category[];
  action: 'accept_all' | 'reject_all' | 'custom' | 'gpc' | 'opt_out';
  locale: string;
  gpc: boolean;
  url: string;
  ipHash: string;
  userAgent: string;
  createdAt: string;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
