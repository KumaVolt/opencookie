import type { LocaleTemplate } from './types.ts';

export const it: LocaleTemplate = {
  locale: 'it',
  languageName: 'Italiano',
  banner: {
    title: 'Utilizziamo i cookie',
    body: 'Utilizziamo cookie necessari per il funzionamento di questo sito. Con il tuo consenso utilizziamo anche cookie statistici e di marketing. Puoi accettarli, rifiutarli o scegliere per categoria. Puoi modificare la tua scelta in qualsiasi momento. Maggiori informazioni nella nostra {policyLink}.',
    policyLinkText: 'cookie policy',
    acceptAll: 'Accetta tutti',
    rejectAll: 'Rifiuta tutti',
    customize: 'Scegli per categoria',
    save: 'Salva le mie scelte',
    close: 'Chiudi',
    alwaysActive: 'Sempre attivi',
    withdrawButton: 'Impostazioni cookie',
    settingsTitle: 'Impostazioni cookie',
    settingsBody: 'Scegli quali cookie consentire. I cookie necessari non possono essere disattivati perché il sito non funziona senza di essi.',
    optOutTitle: 'Le tue scelte sulla privacy',
    optOutBody: 'Noi e i nostri partner utilizziamo cookie per statistiche e pubblicità personalizzata. Puoi opporti in qualsiasi momento alla vendita o condivisione dei tuoi dati personali. Maggiori informazioni nella nostra {policyLink}.',
    optOutButton: 'Non vendere né condividere i miei dati personali',
    okButton: 'OK',
    gpcHonored: 'Il tuo browser ha inviato un segnale Global Privacy Control. Lo abbiamo rispettato: i cookie di marketing sono disattivati.',
    categories: {
      necessary: {
        label: 'Necessari',
        description: 'Indispensabili per il funzionamento del sito, ad esempio per ricordare la tua scelta sui cookie, mantenere l\'accesso o proteggere il sito. Non richiedono consenso.',
      },
      preferences: {
        label: 'Preferenze',
        description: 'Ricordano le tue scelte, come lingua o regione, per offrirti un\'esperienza più personale.',
      },
      statistics: {
        label: 'Statistiche',
        description: 'Ci aiutano a capire come i visitatori usano il sito, così possiamo migliorarlo.',
      },
      marketing: {
        label: 'Marketing',
        description: 'Utilizzati da noi e da terze parti per mostrarti pubblicità pertinente e misurarla, anche su altri siti.',
      },
    },
    declaration: {
      name: 'Nome',
      provider: 'Fornitore',
      purpose: 'Finalità',
      expiry: 'Durata',
      session: 'Sessione',
      persistent: 'Persistente',
      unknown: 'Sconosciuta',
      noCookies: 'Nessun cookie in questa categoria.',
      lastScanned: 'Ultima scansione',
      changeSettings: 'Modifica impostazioni cookie',
      showCookies: 'Mostra cookie',
    },
  },
  cookiePolicy: `# Cookie policy

_Ultimo aggiornamento: {lastUpdated}_

Questa cookie policy spiega come **{siteName}** ({siteUrl}) utilizza i cookie e tecnologie simili.

## Cosa sono i cookie?

I cookie sono piccoli file di testo che un sito salva sul tuo dispositivo. Tecnologie simili, come il local storage e i pixel di tracciamento, funzionano in modo analogo. In questa policy li chiamiamo tutti "cookie".

## La tua scelta

Senza il tuo consenso utilizziamo solo cookie necessari. Per tutti gli altri cookie chiediamo prima il tuo consenso. Rifiutare è facile quanto accettare, e puoi modificare o revocare il consenso in qualsiasi momento:

{changeSettingsButton}

## Quali cookie utilizziamo?

{cookieTable}

## Domande

Per domande su questa policy o sui tuoi dati personali, contattaci all'indirizzo {contact}. Hai anche il diritto di presentare un reclamo al Garante per la protezione dei dati personali.
`,
};
