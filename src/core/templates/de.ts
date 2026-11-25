import type { LocaleTemplate } from './types.ts';

export const de: LocaleTemplate = {
  locale: 'de',
  languageName: 'Deutsch',
  banner: {
    title: 'Wir verwenden Cookies',
    body: 'Wir verwenden notwendige Cookies, damit diese Website funktioniert. Mit Ihrer Einwilligung verwenden wir außerdem Cookies für Statistik und Marketing. Sie können diese akzeptieren, ablehnen oder pro Kategorie auswählen. Sie können Ihre Auswahl jederzeit ändern. Mehr dazu in unserer {policyLink}.',
    policyLinkText: 'Cookie-Richtlinie',
    acceptAll: 'Alle akzeptieren',
    rejectAll: 'Alle ablehnen',
    customize: 'Pro Kategorie auswählen',
    save: 'Auswahl speichern',
    close: 'Schließen',
    alwaysActive: 'Immer aktiv',
    withdrawButton: 'Cookie-Einstellungen',
    settingsTitle: 'Cookie-Einstellungen',
    settingsBody: 'Wählen Sie, welche Cookies Sie zulassen. Notwendige Cookies können nicht deaktiviert werden, da die Website ohne sie nicht funktioniert.',
    optOutTitle: 'Ihre Datenschutz-Einstellungen',
    optOutBody: 'Wir und unsere Partner verwenden Cookies für Statistik und personalisierte Werbung. Sie können dem Verkauf oder der Weitergabe Ihrer personenbezogenen Daten jederzeit widersprechen. Mehr dazu in unserer {policyLink}.',
    optOutButton: 'Meine personenbezogenen Daten nicht verkaufen oder weitergeben',
    okButton: 'OK',
    gpcHonored: 'Ihr Browser hat ein Global-Privacy-Control-Signal gesendet. Wir haben es berücksichtigt: Marketing-Cookies sind deaktiviert.',
    categories: {
      necessary: {
        label: 'Notwendig',
        description: 'Erforderlich, damit die Website funktioniert, z. B. um Ihre Cookie-Auswahl zu speichern, Sie angemeldet zu halten oder die Website abzusichern. Hierfür ist keine Einwilligung nötig.',
      },
      preferences: {
        label: 'Präferenzen',
        description: 'Speichern Ihre Auswahl, etwa Sprache oder Region, damit die Website besser zu Ihnen passt.',
      },
      statistics: {
        label: 'Statistik',
        description: 'Helfen uns zu verstehen, wie Besucher die Website nutzen, damit wir sie verbessern können.',
      },
      marketing: {
        label: 'Marketing',
        description: 'Werden von uns und Dritten verwendet, um Ihnen relevante Werbung anzuzeigen und diese zu messen, auch auf anderen Websites.',
      },
    },
    declaration: {
      name: 'Name',
      provider: 'Anbieter',
      purpose: 'Zweck',
      expiry: 'Speicherdauer',
      session: 'Sitzung',
      persistent: 'Dauerhaft',
      unknown: 'Unbekannt',
      noCookies: 'Keine Cookies in dieser Kategorie.',
      lastScanned: 'Zuletzt gescannt',
      changeSettings: 'Cookie-Einstellungen ändern',
      showCookies: 'Cookies anzeigen',
    },
  },
  cookiePolicy: `# Cookie-Richtlinie

_Zuletzt aktualisiert: {lastUpdated}_

Diese Cookie-Richtlinie erklärt, wie **{siteName}** ({siteUrl}) Cookies und ähnliche Technologien verwendet.

## Was sind Cookies?

Cookies sind kleine Textdateien, die eine Website auf Ihrem Gerät speichert. Ähnliche Technologien wie Local Storage und Tracking-Pixel funktionieren vergleichbar. In dieser Richtlinie nennen wir all diese Technologien „Cookies".

## Ihre Wahl

Ohne Ihre Einwilligung setzen wir nur notwendige Cookies. Für alle anderen Cookies fragen wir zuerst nach Ihrer Einwilligung. Ablehnen ist genauso einfach wie Akzeptieren, und Sie können Ihre Einwilligung jederzeit ändern oder widerrufen:

{changeSettingsButton}

## Welche Cookies verwenden wir?

{cookieTable}

## Fragen

Bei Fragen zu dieser Richtlinie oder zu Ihren personenbezogenen Daten erreichen Sie uns unter {contact}. Sie haben außerdem das Recht, sich bei einer Datenschutzaufsichtsbehörde zu beschweren.
`,
};
