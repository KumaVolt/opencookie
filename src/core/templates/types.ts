import type { Category } from '../categories.ts';

/** All visitor-facing text. Every key can be overridden per site in the admin. */
export interface BannerTexts {
  title: string;
  /** May contain {policyLink}, replaced with a link to the cookie/privacy policy. */
  body: string;
  policyLinkText: string;
  acceptAll: string;
  rejectAll: string;
  customize: string;
  save: string;
  close: string;
  alwaysActive: string;
  /** Floating button label to reopen the banner and change/withdraw consent. */
  withdrawButton: string;
  settingsTitle: string;
  settingsBody: string;
  /** Opt-out model (US) wording. */
  optOutTitle: string;
  optOutBody: string;
  optOutButton: string;
  okButton: string;
  gpcHonored: string;
  categories: Record<Category, { label: string; description: string }>;
  declaration: {
    name: string;
    provider: string;
    purpose: string;
    expiry: string;
    session: string;
    persistent: string;
    unknown: string;
    noCookies: string;
    lastScanned: string;
    changeSettings: string;
    /** Label of the expandable cookie list in the settings dialog. */
    showCookies: string;
  };
}

export interface LocaleTemplate {
  locale: string;
  languageName: string;
  banner: BannerTexts;
  /**
   * Cookie policy page in Markdown. Placeholders: {siteName}, {siteUrl}, {contact},
   * {lastUpdated}, {cookieTable}, {changeSettingsButton}.
   */
  cookiePolicy: string;
}
