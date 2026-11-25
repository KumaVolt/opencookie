import type { Category } from './categories.ts';

/**
 * A rule pack encodes what a regulator expects from a cookie banner. Each site picks one.
 * The banner enforces the "hard" rules itself (it cannot be configured to break them),
 * and the compliance checker reports everything else.
 *
 * Sources are listed per pack. These are a starting point, not legal advice.
 */
export interface RulePack {
  id: string;
  name: string;
  jurisdiction: string;
  /** opt-in: nothing non-essential runs until consent (EU/UK). opt-out: runs until the visitor objects (US). */
  model: 'opt-in' | 'opt-out';
  /** A "Reject all" button must be on the first layer, as prominent as "Accept all". */
  rejectOnFirstLayer: boolean;
  /** Accept and reject get identical styling (no nudging through colour/size). */
  equalButtonStyling: boolean;
  /** Blocking the site until the visitor accepts is not allowed. */
  cookieWallAllowed: boolean;
  /** A persistent control to change/withdraw consent must always be available. */
  persistentWithdraw: boolean;
  /** Honour the Global Privacy Control browser signal as an opt-out of marketing. */
  honorGpc: boolean;
  /** Show a confirmation when a GPC opt-out is honoured (California). */
  showGpcConfirmation: boolean;
  /** How long a given consent is valid before asking again. */
  consentMaxAgeDays: number;
  /** How long a refusal is remembered before asking again. */
  refusalReaskDays: number;
  /** Categories that never need consent. */
  exemptCategories: Category[];
  /**
   * Categories that may run without consent if the site owner confirms the conditions
   * (e.g. privacy-friendly analytics under Dutch Tw 11.7a or UK DUAA statistics exemption).
   */
  conditionalExemptCategories: { category: Category; conditions: string[] }[];
  /** Maximum lifetime of a non-essential cookie before the checker warns. */
  maxCookieLifetimeDays: number | null;
  /** How long consent records are kept as proof. */
  consentLogRetentionDays: number;
  sources: { label: string; url: string }[];
}

const EU_BASE = {
  model: 'opt-in',
  rejectOnFirstLayer: true,
  equalButtonStyling: true,
  cookieWallAllowed: false,
  persistentWithdraw: true,
  honorGpc: true, // not required in the EU, but a clear objection signal; costs nothing to respect
  showGpcConfirmation: false,
  consentMaxAgeDays: 365,
  refusalReaskDays: 365,
  exemptCategories: ['necessary'],
  conditionalExemptCategories: [],
  maxCookieLifetimeDays: null,
  consentLogRetentionDays: 5 * 365,
} satisfies Partial<RulePack>;

export const RULE_PACKS: RulePack[] = [
  {
    ...EU_BASE,
    id: 'nl-ap',
    name: 'Netherlands — Autoriteit Persoonsgegevens',
    jurisdiction: 'NL',
    conditionalExemptCategories: [
      {
        category: 'statistics',
        conditions: [
          'Analytics data is only used by the site owner for statistics about the site (Tw art. 11.7a lid 3b).',
          'IP addresses are anonymised or truncated before storage.',
          'Data is not shared with or used by third parties for their own purposes.',
          'No cross-site tracking or combination with other data.',
          'The visitor is informed about this analytics in the cookie policy.',
        ],
      },
    ],
    sources: [
      { label: 'Telecommunicatiewet art. 11.7a', url: 'https://wetten.overheid.nl/jci1.3:c:BWBR0009950&hoofdstuk=11&artikel=11.7a' },
      { label: 'AP — Cookies', url: 'https://www.autoriteitpersoonsgegevens.nl/themas/internet-slimme-apparaten/cookies' },
      { label: 'EDPB Cookie Banner Taskforce report (2023)', url: 'https://www.edpb.europa.eu/system/files/2023-01/edpb_20230118_report_cookie_banner_taskforce_en.pdf' },
    ],
  },
  {
    ...EU_BASE,
    id: 'eu-edpb',
    name: 'European Union — EDPB baseline',
    jurisdiction: 'EU',
    sources: [
      { label: 'ePrivacy Directive art. 5(3)', url: 'https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32002L0058' },
      { label: 'EDPB Guidelines 05/2020 on consent', url: 'https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-052020-consent-under-regulation-2016679_en' },
      { label: 'EDPB Cookie Banner Taskforce report (2023)', url: 'https://www.edpb.europa.eu/system/files/2023-01/edpb_20230118_report_cookie_banner_taskforce_en.pdf' },
    ],
  },
  {
    ...EU_BASE,
    id: 'fr-cnil',
    name: 'France — CNIL',
    jurisdiction: 'FR',
    consentMaxAgeDays: 395, // 13 months
    refusalReaskDays: 182, // CNIL: remember a refusal for ~6 months
    maxCookieLifetimeDays: 395,
    conditionalExemptCategories: [
      {
        category: 'statistics',
        conditions: [
          'Audience measurement is strictly limited to the site owner\'s own statistics.',
          'Data is not combined with other processing or passed to third parties.',
          'Cookie lifetime is at most 13 months and data is kept at most 25 months.',
          'Visitors are informed and can object.',
        ],
      },
    ],
    sources: [
      { label: 'CNIL — Recommandation cookies et autres traceurs', url: 'https://www.cnil.fr/fr/cookies-et-autres-traceurs' },
    ],
  },
  {
    ...EU_BASE,
    id: 'de-tdddg',
    name: 'Germany — TDDDG §25',
    jurisdiction: 'DE',
    sources: [
      { label: 'TDDDG §25', url: 'https://www.gesetze-im-internet.de/ttdsg/__25.html' },
      { label: 'Einwilligungsverwaltungsverordnung (EinwV)', url: 'https://www.recht.bund.de/bgbl/1/2025/32/VO.html' },
    ],
  },
  {
    ...EU_BASE,
    id: 'uk-duaa',
    name: 'United Kingdom — PECR as amended by the Data (Use and Access) Act 2025',
    jurisdiction: 'UK',
    conditionalExemptCategories: [
      {
        category: 'statistics',
        conditions: [
          'Used only to produce aggregate statistics about the service in order to improve it.',
          'Clear information is given about the cookie.',
          'The visitor has a simple, free way to object (this banner provides it).',
        ],
      },
      {
        category: 'preferences',
        conditions: [
          'Used only to adapt the appearance or functions of the site to the visitor\'s preferences.',
          'Clear information is given and the visitor can object.',
        ],
      },
    ],
    sources: [
      { label: 'ICO — Storage and access technologies guidance', url: 'https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/' },
    ],
  },
  {
    id: 'us-gpc',
    name: 'United States — state privacy laws (opt-out + GPC)',
    jurisdiction: 'US',
    model: 'opt-out',
    rejectOnFirstLayer: true,
    equalButtonStyling: true,
    cookieWallAllowed: false,
    persistentWithdraw: true,
    honorGpc: true,
    showGpcConfirmation: true,
    consentMaxAgeDays: 365,
    refusalReaskDays: 365,
    exemptCategories: ['necessary', 'preferences', 'statistics'],
    conditionalExemptCategories: [],
    maxCookieLifetimeDays: null,
    consentLogRetentionDays: 2 * 365,
    sources: [
      { label: 'Global Privacy Control specification', url: 'https://privacycg.github.io/gpc-spec/' },
      { label: 'CCPA regulations §7025 (opt-out preference signals)', url: 'https://cppa.ca.gov/regulations/' },
    ],
  },
];

export function getRulePack(id: string): RulePack {
  return RULE_PACKS.find((p) => p.id === id) ?? RULE_PACKS[0]!;
}
