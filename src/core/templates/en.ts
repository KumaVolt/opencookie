import type { LocaleTemplate } from './types.ts';

export const en: LocaleTemplate = {
  locale: 'en',
  languageName: 'English',
  banner: {
    title: 'We use cookies',
    body: 'We use necessary cookies to make this website work. With your permission we also use cookies for statistics and marketing. You can accept or reject these, or choose per category. You can change your choice at any time. Read more in our {policyLink}.',
    policyLinkText: 'cookie policy',
    acceptAll: 'Accept all',
    rejectAll: 'Reject all',
    customize: 'Choose per category',
    save: 'Save my choices',
    close: 'Close',
    alwaysActive: 'Always active',
    withdrawButton: 'Cookie settings',
    settingsTitle: 'Cookie settings',
    settingsBody: 'Choose which cookies you allow. Necessary cookies cannot be switched off because the website does not work without them.',
    optOutTitle: 'Your privacy choices',
    optOutBody: 'We and our partners use cookies for statistics and personalised advertising. You can opt out of the sale or sharing of your personal information at any time. Read more in our {policyLink}.',
    optOutButton: 'Do not sell or share my personal information',
    okButton: 'OK',
    gpcHonored: 'Your browser sent a Global Privacy Control signal. We have honoured it: marketing cookies are off.',
    categories: {
      necessary: {
        label: 'Necessary',
        description: 'Needed for the website to work, for example to remember your cookie choice, keep you logged in or secure the site. These do not require consent.',
      },
      preferences: {
        label: 'Preferences',
        description: 'Remember choices you make, such as your language or region, to give you a more personal experience.',
      },
      statistics: {
        label: 'Statistics',
        description: 'Help us understand how visitors use the website, so we can improve it.',
      },
      marketing: {
        label: 'Marketing',
        description: 'Used by us and third parties to show you relevant advertising and to measure it, also on other websites.',
      },
    },
    declaration: {
      name: 'Name',
      provider: 'Provider',
      purpose: 'Purpose',
      expiry: 'Expiry',
      session: 'Session',
      persistent: 'Persistent',
      unknown: 'Unknown',
      noCookies: 'No cookies in this category.',
      lastScanned: 'Last scanned',
      changeSettings: 'Change cookie settings',
      showCookies: 'Show cookies',
    },
  },
  cookiePolicy: `# Cookie policy

_Last updated: {lastUpdated}_

This cookie policy explains how **{siteName}** ({siteUrl}) uses cookies and similar technologies.

## What are cookies?

Cookies are small text files that a website stores on your device. Similar technologies, such as local storage and tracking pixels, work in a comparable way. In this policy we call all of these "cookies".

## Your choice

We only place necessary cookies without your permission. For all other cookies we ask for your consent first. Rejecting is as easy as accepting, and you can change or withdraw your consent at any time:

{changeSettingsButton}

## Which cookies do we use?

{cookieTable}

## Questions

If you have questions about this policy or about your personal data, contact us at {contact}. You also have the right to file a complaint with your national data protection authority.
`,
};
