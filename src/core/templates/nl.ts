import type { LocaleTemplate } from './types.ts';

export const nl: LocaleTemplate = {
  locale: 'nl',
  languageName: 'Nederlands',
  banner: {
    title: 'Wij gebruiken cookies',
    body: 'Wij gebruiken noodzakelijke cookies om deze website te laten werken. Met jouw toestemming gebruiken we ook cookies voor statistieken en marketing. Je kunt deze accepteren of weigeren, of per categorie kiezen. Je kunt je keuze altijd wijzigen. Lees meer in onze {policyLink}.',
    policyLinkText: 'cookieverklaring',
    acceptAll: 'Alles accepteren',
    rejectAll: 'Alles weigeren',
    customize: 'Per categorie kiezen',
    save: 'Keuze opslaan',
    close: 'Sluiten',
    alwaysActive: 'Altijd actief',
    withdrawButton: 'Cookie-instellingen',
    settingsTitle: 'Cookie-instellingen',
    settingsBody: 'Kies welke cookies je toestaat. Noodzakelijke cookies kun je niet uitzetten, omdat de website zonder deze cookies niet werkt.',
    optOutTitle: 'Jouw privacykeuzes',
    optOutBody: 'Wij en onze partners gebruiken cookies voor statistieken en gepersonaliseerde advertenties. Je kunt je op elk moment afmelden voor het verkopen of delen van je persoonsgegevens. Lees meer in onze {policyLink}.',
    optOutButton: 'Mijn persoonsgegevens niet verkopen of delen',
    okButton: 'OK',
    gpcHonored: 'Je browser stuurde een Global Privacy Control-signaal. Daar houden we ons aan: marketingcookies staan uit.',
    categories: {
      necessary: {
        label: 'Noodzakelijk',
        description: 'Nodig om de website te laten werken, bijvoorbeeld om je cookiekeuze te onthouden, je ingelogd te houden of de website te beveiligen. Hiervoor is geen toestemming nodig.',
      },
      preferences: {
        label: 'Voorkeuren',
        description: 'Onthouden keuzes die je maakt, zoals je taal of regio, zodat de website beter bij je past.',
      },
      statistics: {
        label: 'Statistieken',
        description: 'Helpen ons te begrijpen hoe bezoekers de website gebruiken, zodat we die kunnen verbeteren.',
      },
      marketing: {
        label: 'Marketing',
        description: 'Worden door ons en derden gebruikt om je relevante advertenties te tonen en die te meten, ook op andere websites.',
      },
    },
    declaration: {
      name: 'Naam',
      provider: 'Aanbieder',
      purpose: 'Doel',
      expiry: 'Bewaartermijn',
      session: 'Sessie',
      persistent: 'Blijvend',
      unknown: 'Onbekend',
      noCookies: 'Geen cookies in deze categorie.',
      lastScanned: 'Laatst gescand',
      changeSettings: 'Cookie-instellingen wijzigen',
      showCookies: 'Toon cookies',
    },
  },
  cookiePolicy: `# Cookieverklaring

_Laatst bijgewerkt: {lastUpdated}_

In deze cookieverklaring leggen we uit hoe **{siteName}** ({siteUrl}) cookies en vergelijkbare technieken gebruikt.

## Wat zijn cookies?

Cookies zijn kleine tekstbestanden die een website op je apparaat opslaat. Vergelijkbare technieken, zoals local storage en trackingpixels, werken op een soortgelijke manier. In deze verklaring noemen we die allemaal "cookies".

## Jouw keuze

Zonder je toestemming plaatsen we alleen noodzakelijke cookies. Voor alle andere cookies vragen we eerst je toestemming. Weigeren is net zo makkelijk als accepteren, en je kunt je toestemming altijd wijzigen of intrekken:

{changeSettingsButton}

## Welke cookies gebruiken we?

{cookieTable}

## Vragen

Heb je vragen over deze verklaring of over je persoonsgegevens? Neem contact met ons op via {contact}. Je hebt ook het recht om een klacht in te dienen bij de Autoriteit Persoonsgegevens.
`,
};
