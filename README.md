# OpenCookie

Open-source, self-hosted cookie consent manager. You can run it for as many sites as you like. It scans your sites for cookies, recognises them through the [Open Cookie Database](https://github.com/jkwakman/Open-Cookie-Database), and applies the rules of the country you choose (Dutch AP, EDPB, CNIL, German TDDDG, UK DUAA, US GPC).

**Licence:** AGPL-3.0. You may self-host and modify it freely. If you offer a modified version to others as a hosted service, you must publish your changes.

## What it does

| | |
|---|---|
| **Banner** | About 18 KB, no dependencies, Shadow DOM so it doesn't clash with site CSS. "Reject all" sits next to "Accept all" on the first layer with identical styling. No pre-ticked boxes, no cookie wall, and a permanent button to change or withdraw consent. Keyboard and screen-reader accessible (WCAG 2.1 AA target). |
| **Blocking** | Scripts and iframes from about 35 known trackers (Meta, LinkedIn, TikTok, Hotjar, YouTube…) are blocked automatically until consent. Anything else can be tagged by hand with `type="text/plain" data-oc-category="statistics"`. When consent is withdrawn, the related cookies are deleted and the page reloads. |
| **Google Consent Mode v2** | Sends `ad_storage`, `analytics_storage`, `ad_user_data` and `ad_personalization` with every choice. |
| **GPC** | Honours the Global Privacy Control browser signal. Under the US rule pack it opts the visitor out automatically and shows a confirmation. |
| **Scanner** | Headless Chromium crawls up to 20 pages, first without consent and then after "Accept all". It records cookies, localStorage and sessionStorage, matches them against the Open Cookie Database, and flags anything set before consent. |
| **Compliance check** | Lists, per site, the cookies set before consent, unknown cookies, a missing policy URL, cookies that live too long (CNIL 13 months), missing translations, and third parties contacted before consent. |
| **Consent log** | Proof of consent: a random ID, the choice made, the policy version, a hashed and truncated IP address and the time. Searchable, exportable to CSV, and deleted automatically after the rule pack's retention period. |
| **Texts** | Default templates in NL, EN, DE, FR, ES and IT for the banner, settings, category descriptions and a full cookie policy page. Every text can be overridden per site and per language. |
| **Translations** | Cookie descriptions from the Open Cookie Database are translated into `data/translations/<lang>.json`. Retention periods ("2 years" → "2 jaar") and category names are localised automatically. |

## Quick start (Docker)

```bash
cp .env.example .env    # set PUBLIC_URL, ADMIN_PASSWORD and SECRET
docker compose up -d
```

Open `PUBLIC_URL/admin/`, add a site and copy the snippet. Put it as the **first** element in `<head>`, without `async` or `defer`:

```html
<script src="https://consent.example.com/s/SITE_KEY/banner.js"></script>
```

Put HTTPS in front of the server (Caddy, Traefik or nginx). Data lives in the `opencookie-data` volume (SQLite).

## Development

Needs Node 24 or newer. TypeScript runs directly; the server has no build step.

```bash
npm install
npx playwright install chromium   # for the scanner
npm run build                      # bundles the banner and the admin UI
ADMIN_PASSWORD=dev SECRET=dev npm start
npm test
```

`examples/demo-site/` is a small test site with good and bad trackers. Serve it on `localhost:8090`, add a site with domain `localhost:8090`, and replace `YOUR_SITE_KEY` in the HTML.

## On your site

```html
<!-- Blocked until the visitor allows statistics -->
<script type="text/plain" data-oc-category="statistics" src="https://example.com/analytics.js"></script>

<!-- Iframes: blocked with a placeholder until consent -->
<iframe data-oc-category="marketing" data-oc-src="https://www.youtube-nocookie.com/embed/ID"></iframe>

<!-- A link that opens the cookie settings (e.g. in your footer) -->
<a href="#" data-oc-open>Cookie settings</a>

<!-- The cookie table on your cookie policy page, always current and in the visitor's language -->
<div data-oc-declaration></div>
```

JavaScript API: `OpenCookie.hasConsent('statistics')`, `OpenCookie.onChange(cb)`, `OpenCookie.showSettings()`, and the `opencookie:change` event.

A complete cookie policy page is also available at `/api/v1/sites/SITE_KEY/policy?lang=nl` (HTML, or `&format=md` for Markdown).

## Translating the cookie database

The Open Cookie Database is English only. It has about 2,300 entries but only about 1,800 unique descriptions. Translations are keyed by a hash of the English text, so one translation covers every cookie with that description. When the English text changes upstream, the old translation is no longer used.

```bash
npm run cookie-db:update                                            # latest database
DEEPL_API_KEY=... npm run translate -- --locales nl,de,fr --provider deepl
LIBRETRANSLATE_URL=http://localhost:5000 npm run translate -- --locales nl --provider libretranslate
```

Each entry is marked `machine` or `reviewed`. Machine translations never overwrite reviewed ones. Site owners can also override any description per language in the admin. Commit `data/translations/` so others benefit.

## Rule packs

| Pack | Model | Notes |
|---|---|---|
| `nl-ap` | opt-in | Tw 11.7a, AP guidance, EDPB taskforce. Privacy-friendly analytics can be marked exempt after confirming the conditions. |
| `eu-edpb` | opt-in | EDPB baseline. |
| `fr-cnil` | opt-in | Consent valid for 13 months, refusal remembered for 6 months, warns on cookies older than 13 months. |
| `de-tdddg` | opt-in | TDDDG §25. |
| `uk-duaa` | opt-in | Statistics and appearance cookies can be exempt under the DUAA 2025 if the visitor can object. |
| `us-gpc` | opt-out | "Do not sell or share", GPC honoured with a confirmation. |

The rule packs are a starting point, **not legal advice**. Have a lawyer check your texts and configuration.

## Not included yet

- IAB TCF v2.x and GPP (needed only for programmatic advertising)
- Geo-based rule packs (one pack per site for now)
- Scheduled automatic scans (run them from the admin, or call `POST /admin/api/sites/:id/scans` from cron)
- Multiple admin users and roles
- Reading consent stored by German PIMS (EinwV) services
