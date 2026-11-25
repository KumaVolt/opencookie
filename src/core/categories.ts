/** Consent categories used throughout OpenCookie. */
export const CATEGORIES = ['necessary', 'preferences', 'statistics', 'marketing'] as const;
export type Category = (typeof CATEGORIES)[number];

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}

/**
 * Maps the Open Cookie Database category names to OpenCookie categories.
 * OCD uses: Functional, Necessary, Security, Personalization, Analytics, Marketing.
 */
export function categoryFromOcd(ocd: string): Category {
  switch (ocd.trim().toLowerCase()) {
    case 'functional':
    case 'necessary':
    case 'security':
      return 'necessary';
    case 'personalization':
    case 'preferences':
      return 'preferences';
    case 'analytics':
    case 'statistics':
    case 'performance':
      return 'statistics';
    case 'marketing':
    default:
      // Unknown categories are treated as marketing: the safest default (needs consent).
      return 'marketing';
  }
}
