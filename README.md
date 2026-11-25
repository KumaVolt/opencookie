<div align="center">

<h1>OpenCookie</h1>

**Cookie consent that you host yourself, for as many sites as you like.**

[![Licence: AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-blue)](LICENSE)
[![Node 24+](https://img.shields.io/badge/node-24%2B-339933)](https://nodejs.org)
[![Cookie data: Open Cookie Database](https://img.shields.io/badge/cookie%20data-Open%20Cookie%20Database-555)](https://github.com/jkwakman/Open-Cookie-Database)
[![Self-hosted](https://img.shields.io/badge/hosting-self--hosted-555)](#install)

[Why](#why-opencookie) · [Features](#features) · [Install](#install) · [How it works](#how-it-works) · [FAQ](#faq) · [Development](#development)

<img src="docs/banner-bar.png" width="900" alt="A cookie bar at the bottom of a demo page, in Dutch, with equal Reject all and Accept all buttons and a Choose per category link">

<sub>The bar on a demo site. Accept and Reject always look the same.</sub>

</div>

## Why OpenCookie

There is no reason for cookie compliance to be expensive. A cookie banner shows a choice, blocks a few scripts until that choice is made, and keeps a record of it. Hosted services charge for that per domain, every month, for as long as the site exists. OpenCookie does the same job on a server you already pay for.

- **One server, unlimited sites.** Add your own sites and your clients' sites. Nothing is counted per domain, page or visitor.
- **Recognises cookies for you.** A built-in scanner visits each site, finds its cookies and storage, and looks them up in the [Open Cookie Database](https://github.com/jkwakman/Open-Cookie-Database).
- **Rules per country.** Rule packs for the Dutch AP, the EDPB, CNIL, German TDDDG, UK DUAA and US GPC set what the banner must do and what the compliance check looks for.
- **Your data stays with you.** Consent records live in a SQLite file on your server. No third party sees your visitors.

> [!NOTE]
> OpenCookie is new. The banner, scanner, consent log and accounts are tested end to end, but there is no stable release yet. The rule packs are a starting point, not legal advice: have a lawyer check your texts and settings.

### What it costs

List prices for a typical small business site (fewer than 100,000 page views a month, a few hundred pages, more than one language), on the cheapest plan that fits. Prices exclude VAT and were read from each vendor's pricing page on 25 November 2026. They change often.

| | 1 site | 10 sites | 50 sites |
|---|---|---|---|
| [Cookiebot](https://www.cookiebot.com/en/pricing/) | €360 a year | €1,800 a year | €9,000 a year |
| [iubenda](https://www.iubenda.com/en/pricing) (Advanced) | €240 a year | €2,399 a year | €11,994 a year |
| [CookieYes](https://www.cookieyes.com/pricing/) (Basic) | €90 a year | €900 a year | €4,500 a year |
| **OpenCookie** | **the server you run it on** | **the same server** | **the same server** |

How the figures were worked out:

- **Cookiebot** is €30 a month for one domain. From four domains, sites of up to 350 subpages can use the €15 plan. Above 350 subpages every site costs €30 a month: €3,600 a year for 10 sites and €18,000 for 50.
- **iubenda** is €19.99 a month per site, billed yearly. That plan includes 50,000 page views a month, after which each extra 1,000 costs €0.05.
- **CookieYes** is €90 a year per domain. Its agency programme mentions discounts of up to 50%, but publishes no prices.
- **OpenCookie** runs comfortably on a small virtual server. If you already host websites, it can share that server.

### Rule packs

| Pack | Model | What it adds |
|---|---|---|
| `nl-ap` | Opt-in | Telecommunicatiewet 11.7a and AP guidance. Privacy-friendly analytics can run without consent once you confirm the conditions. |
| `eu-edpb` | Opt-in | The EDPB baseline and the 2023 cookie banner taskforce findings. |
| `fr-cnil` | Opt-in | Consent lasts 13 months and a refusal is remembered for 6. Warns about cookies that live longer than 13 months. |
| `de-tdddg` | Opt-in | TDDDG §25. |
| `uk-duaa` | Opt-in | Statistics and appearance cookies can be exempt under the Data (Use and Access) Act 2025, provided visitors can object. |
| `us-gpc` | Opt-out | "Do not sell or share", with the Global Privacy Control signal honoured and confirmed. |

## Features

- **Banner:** about 19 KB and no dependencies. It runs in a Shadow DOM, so site CSS cannot break it. Layouts: a full-width bar, a corner box or a centred popup. "Reject all" sits next to "Accept all" and looks the same. Nothing is pre-ticked, there is no cookie wall, and a button stays on the page for changing your mind. Keyboard and screen-reader friendly, aiming for WCAG 2.1 AA.
- **Blocking:**
  - Scripts and embeds from about 50 known services are held back until the visitor agrees. These include Meta, TikTok, Reddit, LinkedIn, Pinterest, Snapchat, X, Hotjar, Clarity, YouTube, Vimeo, Instagram and Spotify.
  - Anything else can be tagged by hand.
  - When consent is withdrawn, the related cookies are deleted.
- **Google Consent Mode v2:** `ad_storage`, `analytics_storage`, `ad_user_data` and `ad_personalization` are sent with every choice.
- **Scanner:** a headless Chromium visits up to 20 pages, first without consent and then after accepting. It records cookies, localStorage and sessionStorage, and flags anything set before consent.
- **Compliance check per site:**
  - cookies set before consent
  - unknown cookies
  - a missing policy page
  - cookies that live too long
  - missing translations
  - third parties contacted early
- **Consent log:** proof of consent. Each record holds a random ID, the choice, the policy version, a truncated and hashed IP address and the time. Records are searchable, can be exported as CSV, and are deleted after the rule pack's retention period.
- **Texts:**
  - Templates in Dutch, English, German, French, Spanish and Italian cover the banner, the settings dialog and a full cookie policy page.
  - Every text can be changed per site and per language.
  - Cookie descriptions can be machine-translated with DeepL or LibreTranslate.
- **Clients and accounts:**
  - Each client has its own sites, team and consent logs.
  - Roles are owner, editor and viewer.
  - Platform admins manage every client and user.
  - People join by invitation.
- **Security:**
  - Passkeys, including logging in with no password at all.
  - Authenticator app codes.
  - One-time recovery codes.
  - 2FA can be required per client or for the whole server.
  - Rate limits on logins.
  - A list of active sessions you can sign out.
  - An activity log of logins and changes, kept for 2 years.
- **Statistics:** consent choices over time, accept and reject rates, and compliance problems. Platform admins see them across all clients; everyone else sees them per client.

## Install

You need Docker, a domain name for the consent server (for example `consent.example.com`), and HTTPS in front of it (Caddy, Traefik or nginx).

```sh
git clone https://github.com/YOUR-ORG/opencookie.git && cd opencookie
cp .env.example .env    # set PUBLIC_URL, SETUP_KEY and SECRET
docker compose up -d
```

Open `PUBLIC_URL/admin/`, enter the setup key and create the first admin account. Then add a client and a site, and paste the snippet as the **first** element in the `<head>` of every page, without `async` or `defer`:

```html
<script src="https://consent.example.com/s/SITE_KEY/banner.js"></script>
```

> [!NOTE]
> Passkeys are tied to the host name in `PUBLIC_URL`. If you move the admin to a different domain, everyone will need to add their passkeys again. Authenticator apps and passwords keep working.

### Settings

| Variable | |
|---|---|
| `PUBLIC_URL` | Public HTTPS address of the server. Used in snippets, emails and passkeys. |
| `SETUP_KEY` | Needed once, to create the first admin. If it is not set, a key is printed in the log. |
| `SECRET` | Hashes visitor IP addresses and encrypts 2FA secrets. If it is not set, one is generated in `DATA_DIR/secret.key`. **Back that file up.** |
| `SMTP_URL`, `MAIL_FROM` | Optional, for sending invitations and password reset emails, e.g. `smtps://user:pass@smtp.example.com:465`. Without them you copy invitation links yourself. |
| `REQUIRE_2FA` | `true` makes every user set up a passkey or authenticator app. |
| `GRAVATAR` | `true` shows Gravatar photos as profile pictures. Off by default, because it sends a hash of each email address to Gravatar. Without it, people get their initials. |
| `APP_NAME` | Name shown in the admin, emails and authenticator apps. |
| `SESSION_HOURS` | How long a login lasts. Default 12. |
| `SCAN_MAX_PAGES` | Pages per scan. Default 20. |
| `DEEPL_API_KEY`, `LIBRETRANSLATE_URL` | For translating the cookie database. |

### On your site

```html
<!-- Blocked until the visitor allows statistics -->
<script type="text/plain" data-oc-category="statistics" src="https://example.com/analytics.js"></script>

<!-- Embeds: replaced by a placeholder until consent -->
<iframe data-oc-category="marketing" data-oc-src="https://www.youtube-nocookie.com/embed/ID"></iframe>

<!-- A link that opens the cookie settings, e.g. in your footer -->
<a href="#" data-oc-open>Cookie settings</a>

<!-- The cookie table on your cookie policy page, always current and in the visitor's language -->
<div data-oc-declaration></div>
```

JavaScript: `OpenCookie.hasConsent('statistics')`, `OpenCookie.onChange(fn)`, `OpenCookie.showSettings()` and the `opencookie:change` event. A complete policy page is served at `/api/v1/sites/SITE_KEY/policy?lang=nl`.

## How it works

```
 visitor's browser                          your server (Node + SQLite)
┌────────────────────────┐   banner.js   ┌──────────────────────────────┐
│ banner (Shadow DOM)    │◀──────────────│ public API                   │
│  blocks scripts/iframes│   config      │  /s/:key/banner.js           │
│  Consent Mode, GPC     │──────────────▶│  /api/v1/sites/:key/consent  │
└────────────────────────┘   choice      ├──────────────────────────────┤
                                         │ admin API + UI (/admin)      │
 headless Chromium  ◀── scans ───────────│  accounts, 2FA, passkeys     │
                                         │  clients, sites, statistics  │
 Open Cookie Database ── matched ───────▶│  consent log, audit log      │
                                         └──────────────────────────────┘
```

The server is TypeScript run directly by Node, with no build step. Data goes in `node:sqlite`, served by Fastify. The banner and admin UI (Preact) are bundled with esbuild. Passkeys use [SimpleWebAuthn](https://simplewebauthn.dev).

| Path | Does |
|---|---|
| [`src/banner`](src/banner) | The script visitors load: banner, settings dialog, blocking, Consent Mode |
| [`src/core`](src/core) | Rule packs, text templates, cookie matching, compliance checks |
| [`src/scanner`](src/scanner) | The headless cookie scanner |
| [`src/server`](src/server) | API, accounts, authentication, database |
| [`src/admin`](src/admin) | The admin interface |

**Where your data lives.** Everything is in `DATA_DIR`, which defaults to `./data` and is `/data` in Docker: the SQLite database, `secret.key`, the downloaded cookie database and the translations. Back up that folder.

## FAQ

**Does OpenCookie phone home?**
No. The server downloads the Open Cookie Database from GitHub when you ask it to. Translation uses DeepL or LibreTranslate only if you configure one. The banner talks only to your own server.

**Is it really compliant?**
The banner follows what regulators ask for: reject is as easy as accept, nothing is pre-ticked, there is no cookie wall, consent can be withdrawn, and choices are logged. Whether your site is compliant also depends on what you load and what your texts say, which is what the scanner and the compliance check help with. It is not legal advice.

**Can my clients log in?**
Yes. Invite them to their own client, as owner, editor or viewer. They see only their own sites and statistics. You can require them to use two-step verification.

**Does it support IAB TCF?**
Not yet. TCF is only needed for programmatic advertising, and registering as a CMP has its own costs and obligations.

**What does AGPL mean for me?**
You can use, change and host it freely, including for paying clients. If you offer a modified version to others as a service, you must publish your changes.

## Development

Needs Node 24 or newer.

```sh
npm install
npx playwright install chromium   # for the scanner
npm run build                      # bundles the banner and the admin UI
SETUP_KEY=dev npm start
```

**Checks:** `npm test` (unit and API tests, including 2FA, invitations and client separation) and `npm run typecheck`.

**Demo site:** `examples/demo-site/` has good and bad trackers to scan. Serve it on `localhost:8090`, add a site with the domain `localhost:8090`, and replace `YOUR_SITE_KEY` in the HTML.

**Translating the cookie database:**

```sh
npm run cookie-db:update
DEEPL_API_KEY=... npm run translate -- --locales nl,de,fr --provider deepl
```

Translations are keyed by a hash of the English text, so one translation covers every cookie with that description. They are marked `machine` or `reviewed`, and a machine translation never overwrites a reviewed one.

## Licence

[AGPL-3.0](LICENSE). Cookie data comes from the [Open Cookie Database](https://github.com/jkwakman/Open-Cookie-Database) under its own licence.
