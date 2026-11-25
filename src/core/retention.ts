/**
 * Retention periods in the Open Cookie Database are free text ("1 year", "Session",
 * "29 Days", "13 months", "Unlimited"). We parse them into a structured value so they
 * can be shown in any language through Intl, without needing translation.
 */
export type RetentionUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
export type Retention =
  | { kind: 'session' }
  | { kind: 'persistent' } // "Unlimited", "Persistent"
  | { kind: 'duration'; value: number; unit: RetentionUnit }
  | { kind: 'unknown'; raw: string };

const UNIT_ALIASES: Record<string, RetentionUnit> = {
  s: 'minute', // seconds are rounded up to minutes below
  sec: 'minute', second: 'minute', seconds: 'minute',
  min: 'minute', mins: 'minute', minute: 'minute', minutes: 'minute',
  h: 'hour', hr: 'hour', hrs: 'hour', hour: 'hour', hours: 'hour',
  d: 'day', day: 'day', days: 'day',
  w: 'week', wk: 'week', week: 'week', weeks: 'week',
  m: 'month', mo: 'month', month: 'month', months: 'month',
  y: 'year', yr: 'year', yrs: 'year', year: 'year', years: 'year',
};

export function parseRetention(raw: string | null | undefined): Retention {
  const text = (raw ?? '').trim().toLowerCase();
  if (!text) return { kind: 'unknown', raw: '' };
  if (/\bsessions?\b/.test(text)) return { kind: 'session' };
  if (/(unlimited|persistent|permanent|never|indefinite|forever)/.test(text)) return { kind: 'persistent' };
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*([a-z]+)/);
  if (m) {
    const unitWord = m[2] as string;
    const unit = UNIT_ALIASES[unitWord];
    if (unit) {
      let value = Number(m[1]!.replace(',', '.'));
      if (/^s(ec(ond)?s?)?$/.test(unitWord)) value = Math.max(1, Math.ceil(value / 60));
      return { kind: 'duration', value, unit };
    }
  }
  return { kind: 'unknown', raw: raw ?? '' };
}

/** Approximate length in days (used for compliance checks such as the CNIL 13-month cap). */
export function retentionDays(r: Retention): number | null {
  if (r.kind === 'session') return 0;
  if (r.kind === 'persistent') return Infinity;
  if (r.kind !== 'duration') return null;
  const perUnit: Record<RetentionUnit, number> = {
    minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30.44, year: 365.25,
  };
  return r.value * perUnit[r.unit];
}

/** Formats a retention period in the given locale, e.g. "1 jaar", "2 Jahre", "Sessie". */
export function formatRetention(r: Retention, locale: string, words: { session: string; persistent: string; unknown: string }): string {
  switch (r.kind) {
    case 'session':
      return words.session;
    case 'persistent':
      return words.persistent;
    case 'unknown':
      return r.raw || words.unknown;
    case 'duration':
      try {
        return new Intl.NumberFormat(locale, { style: 'unit', unit: r.unit, unitDisplay: 'long' }).format(r.value);
      } catch {
        return `${r.value} ${r.unit}`;
      }
  }
}
