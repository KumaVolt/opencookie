import type { Category } from './categories.ts';

/**
 * Well-known third-party script/iframe hosts and the category they need consent for.
 * The banner's auto-blocker stops matching <script> and <iframe> elements until the
 * visitor consents to that category. Site owners can still tag elements by hand with
 * data-oc-category for anything not on this list.
 */
export interface BlockRule {
  /** Matched against the hostname (suffix match) and optionally the path (substring). */
  host: string;
  path?: string;
  category: Category;
  /** Google tags are handled by Consent Mode when it is enabled, so they are not blocked then. */
  google?: boolean;
}

export const BLOCK_RULES: BlockRule[] = [
  // Google
  { host: 'googletagmanager.com', path: '/gtag/', category: 'statistics', google: true },
  { host: 'googletagmanager.com', path: '/gtm.js', category: 'statistics', google: true },
  { host: 'google-analytics.com', category: 'statistics', google: true },
  { host: 'googleadservices.com', category: 'marketing', google: true },
  { host: 'googlesyndication.com', category: 'marketing', google: true },
  { host: 'doubleclick.net', category: 'marketing', google: true },
  { host: 'youtube.com', path: '/embed', category: 'marketing' },
  { host: 'youtube-nocookie.com', category: 'marketing' },
  // Meta
  { host: 'connect.facebook.net', category: 'marketing' },
  { host: 'facebook.com', path: '/tr', category: 'marketing' },
  // Microsoft
  { host: 'clarity.ms', category: 'statistics' },
  { host: 'bat.bing.com', category: 'marketing' },
  // LinkedIn, X, TikTok, Pinterest, Snap, Reddit
  { host: 'snap.licdn.com', category: 'marketing' },
  { host: 'platform.linkedin.com', category: 'marketing' },
  { host: 'static.ads-twitter.com', category: 'marketing' },
  { host: 'platform.twitter.com', category: 'marketing' },
  { host: 'analytics.tiktok.com', category: 'marketing' },
  { host: 's.pinimg.com', category: 'marketing' },
  { host: 'sc-static.net', category: 'marketing' },
  { host: 'redditstatic.com', path: '/ads', category: 'marketing' },
  { host: 'embed.reddit.com', category: 'marketing' },
  { host: 'redditmedia.com', category: 'marketing' },
  { host: 'tiktok.com', path: '/embed', category: 'marketing' },
  { host: 'instagram.com', path: '/embed', category: 'marketing' },
  { host: 'facebook.com', path: '/plugins', category: 'marketing' },
  { host: 'ct.pinterest.com', category: 'marketing' },
  { host: 'a.quora.com', category: 'marketing' },
  { host: 's.adroll.com', category: 'marketing' },
  { host: 'static.klaviyo.com', category: 'marketing' },
  { host: 'mc.yandex.ru', category: 'statistics' },
  { host: 'cdn.heapanalytics.com', category: 'statistics' },
  { host: 'edge.fullstory.com', category: 'statistics' },
  { host: 'cdn.mouseflow.com', category: 'statistics' },
  { host: 'open.spotify.com', path: '/embed', category: 'marketing' },
  // Analytics / session recording
  { host: 'static.hotjar.com', category: 'statistics' },
  { host: 'script.hotjar.com', category: 'statistics' },
  { host: 'cdn.mxpnl.com', category: 'statistics' },
  { host: 'cdn.segment.com', category: 'statistics' },
  { host: 'cdn.amplitude.com', category: 'statistics' },
  { host: 'js.hs-scripts.com', category: 'marketing' },
  { host: 'js.hs-analytics.net', category: 'statistics' },
  { host: 'widget.intercom.io', category: 'preferences' },
  { host: 'player.vimeo.com', category: 'statistics' },
  { host: 'maps.googleapis.com', category: 'preferences' },
  { host: 'criteo.net', category: 'marketing' },
  { host: 'adnxs.com', category: 'marketing' },
  { host: 'taboola.com', category: 'marketing' },
  { host: 'outbrain.com', category: 'marketing' },
];

export function rulesFor(consentMode: boolean): BlockRule[] {
  return consentMode ? BLOCK_RULES.filter((r) => !r.google) : BLOCK_RULES;
}
