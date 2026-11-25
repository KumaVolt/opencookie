import type { LocaleTemplate } from './types.ts';

export const es: LocaleTemplate = {
  locale: 'es',
  languageName: 'Español',
  banner: {
    title: 'Usamos cookies',
    body: 'Usamos cookies necesarias para que este sitio web funcione. Con tu permiso, también usamos cookies de estadísticas y marketing. Puedes aceptarlas, rechazarlas o elegir por categoría. Puedes cambiar tu elección en cualquier momento. Más información en nuestra {policyLink}.',
    policyLinkText: 'política de cookies',
    acceptAll: 'Aceptar todas',
    rejectAll: 'Rechazar todas',
    customize: 'Elegir por categoría',
    save: 'Guardar mi elección',
    close: 'Cerrar',
    alwaysActive: 'Siempre activas',
    withdrawButton: 'Configuración de cookies',
    settingsTitle: 'Configuración de cookies',
    settingsBody: 'Elige qué cookies permites. Las cookies necesarias no se pueden desactivar porque el sitio web no funciona sin ellas.',
    optOutTitle: 'Tus opciones de privacidad',
    optOutBody: 'Nosotros y nuestros socios usamos cookies para estadísticas y publicidad personalizada. Puedes oponerte en cualquier momento a la venta o cesión de tus datos personales. Más información en nuestra {policyLink}.',
    optOutButton: 'No vender ni compartir mis datos personales',
    okButton: 'OK',
    gpcHonored: 'Tu navegador envió una señal Global Privacy Control. La hemos respetado: las cookies de marketing están desactivadas.',
    categories: {
      necessary: {
        label: 'Necesarias',
        description: 'Imprescindibles para que el sitio funcione, por ejemplo para recordar tu elección de cookies, mantener tu sesión o proteger el sitio. No requieren consentimiento.',
      },
      preferences: {
        label: 'Preferencias',
        description: 'Recuerdan tus elecciones, como el idioma o la región, para ofrecerte una experiencia más personal.',
      },
      statistics: {
        label: 'Estadísticas',
        description: 'Nos ayudan a entender cómo usan los visitantes el sitio para poder mejorarlo.',
      },
      marketing: {
        label: 'Marketing',
        description: 'Las usamos nosotros y terceros para mostrarte publicidad relevante y medirla, también en otros sitios web.',
      },
    },
    declaration: {
      name: 'Nombre',
      provider: 'Proveedor',
      purpose: 'Finalidad',
      expiry: 'Duración',
      session: 'Sesión',
      persistent: 'Persistente',
      unknown: 'Desconocida',
      noCookies: 'No hay cookies en esta categoría.',
      lastScanned: 'Último análisis',
      changeSettings: 'Cambiar la configuración de cookies',
      showCookies: 'Ver cookies',
    },
  },
  cookiePolicy: `# Política de cookies

_Última actualización: {lastUpdated}_

Esta política explica cómo **{siteName}** ({siteUrl}) utiliza cookies y tecnologías similares.

## ¿Qué son las cookies?

Las cookies son pequeños archivos de texto que un sitio web guarda en tu dispositivo. Otras tecnologías, como el almacenamiento local y los píxeles de seguimiento, funcionan de forma parecida. En esta política las llamamos a todas "cookies".

## Tu elección

Sin tu permiso solo usamos cookies necesarias. Para todas las demás te pedimos primero tu consentimiento. Rechazar es tan fácil como aceptar, y puedes cambiar o retirar tu consentimiento en cualquier momento:

{changeSettingsButton}

## ¿Qué cookies usamos?

{cookieTable}

## Preguntas

Si tienes preguntas sobre esta política o sobre tus datos personales, escríbenos a {contact}. También tienes derecho a presentar una reclamación ante la autoridad de protección de datos.
`,
};
