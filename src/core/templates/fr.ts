import type { LocaleTemplate } from './types.ts';

export const fr: LocaleTemplate = {
  locale: 'fr',
  languageName: 'Français',
  banner: {
    title: 'Nous utilisons des cookies',
    body: 'Nous utilisons des cookies nécessaires au fonctionnement de ce site. Avec votre accord, nous utilisons aussi des cookies de mesure d\'audience et de marketing. Vous pouvez les accepter, les refuser ou choisir par catégorie. Vous pouvez modifier votre choix à tout moment. En savoir plus dans notre {policyLink}.',
    policyLinkText: 'politique cookies',
    acceptAll: 'Tout accepter',
    rejectAll: 'Tout refuser',
    customize: 'Choisir par catégorie',
    save: 'Enregistrer mes choix',
    close: 'Fermer',
    alwaysActive: 'Toujours actifs',
    withdrawButton: 'Paramètres des cookies',
    settingsTitle: 'Paramètres des cookies',
    settingsBody: 'Choisissez les cookies que vous autorisez. Les cookies nécessaires ne peuvent pas être désactivés, car le site ne fonctionne pas sans eux.',
    optOutTitle: 'Vos choix de confidentialité',
    optOutBody: 'Nos partenaires et nous utilisons des cookies pour la mesure d\'audience et la publicité personnalisée. Vous pouvez vous opposer à tout moment à la vente ou au partage de vos données personnelles. En savoir plus dans notre {policyLink}.',
    optOutButton: 'Ne pas vendre ni partager mes données personnelles',
    okButton: 'OK',
    gpcHonored: 'Votre navigateur a envoyé un signal Global Privacy Control. Nous l\'avons respecté : les cookies marketing sont désactivés.',
    categories: {
      necessary: {
        label: 'Nécessaires',
        description: 'Indispensables au fonctionnement du site, par exemple pour mémoriser votre choix de cookies, maintenir votre connexion ou sécuriser le site. Ils ne nécessitent pas de consentement.',
      },
      preferences: {
        label: 'Préférences',
        description: 'Mémorisent vos choix, comme la langue ou la région, pour personnaliser votre expérience.',
      },
      statistics: {
        label: 'Mesure d\'audience',
        description: 'Nous aident à comprendre comment les visiteurs utilisent le site afin de l\'améliorer.',
      },
      marketing: {
        label: 'Marketing',
        description: 'Utilisés par nous et par des tiers pour vous montrer des publicités pertinentes et les mesurer, y compris sur d\'autres sites.',
      },
    },
    declaration: {
      name: 'Nom',
      provider: 'Fournisseur',
      purpose: 'Finalité',
      expiry: 'Durée',
      session: 'Session',
      persistent: 'Permanent',
      unknown: 'Inconnue',
      noCookies: 'Aucun cookie dans cette catégorie.',
      lastScanned: 'Dernière analyse',
      changeSettings: 'Modifier les paramètres des cookies',
      showCookies: 'Voir les cookies',
    },
  },
  cookiePolicy: `# Politique cookies

_Dernière mise à jour : {lastUpdated}_

Cette politique explique comment **{siteName}** ({siteUrl}) utilise les cookies et autres traceurs.

## Qu'est-ce qu'un cookie ?

Un cookie est un petit fichier texte qu'un site enregistre sur votre appareil. D'autres technologies, comme le stockage local ou les pixels de suivi, fonctionnent de manière similaire. Dans cette politique, nous les appelons tous « cookies ».

## Votre choix

Sans votre consentement, nous ne déposons que des cookies nécessaires. Pour tous les autres cookies, nous demandons d'abord votre accord. Refuser est aussi simple qu'accepter, et vous pouvez modifier ou retirer votre consentement à tout moment :

{changeSettingsButton}

## Quels cookies utilisons-nous ?

{cookieTable}

## Questions

Pour toute question sur cette politique ou sur vos données personnelles, contactez-nous à {contact}. Vous pouvez également introduire une réclamation auprès de la CNIL.
`,
};
