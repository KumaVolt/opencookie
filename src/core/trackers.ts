import type { Category } from './categories.ts';

/**
 * Services whose cookies always need consent. The Open Cookie Database files some of their
 * cookies under "Functional" (for example Hotjar's _hjSession_), which would otherwise make
 * them count as necessary. Keys are OCD platform names, lower case.
 */
const TRACKING_PLATFORMS: Record<string, Category> = {
  hotjar: 'statistics',
  'microsoft clarity': 'statistics',
  clarity: 'statistics',
  'google analytics': 'statistics',
  posthog: 'statistics',
  mixpanel: 'statistics',
  amplitude: 'statistics',
  heap: 'statistics',
  fullstory: 'statistics',
  'mouseflow': 'statistics',
  'lucky orange': 'statistics',
  'crazy egg': 'statistics',
  segment: 'statistics',
  facebook: 'marketing',
  meta: 'marketing',
  tiktok: 'marketing',
  linkedin: 'marketing',
  pinterest: 'marketing',
  snapchat: 'marketing',
  'twitter': 'marketing',
  x: 'marketing',
  reddit: 'marketing',
  'google ads': 'marketing',
  doubleclick: 'marketing',
  hubspot: 'marketing',
};

/** The category a tracking platform's cookie needs, or null when the platform isn't one. */
export function trackerCategory(platform: string): Category | null {
  return TRACKING_PLATFORMS[platform.trim().toLowerCase()] ?? null;
}

/**
 * Cookies the Open Cookie Database doesn't list yet, by name pattern. Only a last resort:
 * the scanner first looks at which script set a cookie. PostHog is here because sites
 * usually bundle it into their own JavaScript, so there's no tracker host to see.
 */
export const EXTRA_COOKIES: { pattern: RegExp; platform: string; category: Category; description: string }[] = [
  {
    // ph_<project key>_posthog, ph_conv_…, __ph_opt_in_out_…, ph_…_window_id and similar.
    pattern: /^(__)?ph_/,
    platform: 'PostHog',
    category: 'statistics',
    description: 'Set by PostHog product analytics to recognise a visitor and their session.',
  },
];
