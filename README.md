<div align="center">

<h1>OpenCookie</h1>

**Cookie consent that you host yourself, for as many sites as you like.**

[![Licence: AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-blue)](LICENSE)
[![Docker image](https://img.shields.io/badge/docker-ghcr.io%2Fkumavolt%2Fopencookie-2496ED)](https://github.com/KumaVolt/opencookie/pkgs/container/opencookie)
[![Cookie data: Open Cookie Database](https://img.shields.io/badge/cookie%20data-Open%20Cookie%20Database-555)](https://github.com/jkwakman/Open-Cookie-Database)

<img src="docs/banner-bar.png" width="900" alt="A cookie bar at the bottom of a demo page, in Dutch, with equal Reject all and Accept all buttons and a Choose per category link">

</div>

OpenCookie is a cookie banner, a cookie scanner and a consent log in one Docker container. Hosted services charge per domain, every month; OpenCookie runs on a server you already have.

- **Unlimited sites.** Your own and your clients'. Nothing is counted per domain, page or visitor.
- **Finds the cookies for you.** A scanner visits each site and looks every cookie up in the [Open Cookie Database](https://github.com/jkwakman/Open-Cookie-Database).
- **Rules per country.** Rule packs for the Dutch AP, the EDPB, CNIL, German TDDDG, UK DUAA and US GPC.
- **No banner when you don't need one.** A site that only sets necessary cookies shows nothing.
- **Your data stays with you.** Consent records live in a SQLite file on your server.

> [!NOTE]
> OpenCookie is new and has no stable release yet. The rule packs are a starting point, not legal advice.

## Run it

```sh
docker run -d --name opencookie --restart unless-stopped \
  -p 8080:8080 -v opencookie-data:/data \
  -e PUBLIC_URL=https://consent.example.com \
  -e TZ=Europe/Amsterdam \
  ghcr.io/kumavolt/opencookie
```

1. Put HTTPS in front of port 8080 (Caddy, Traefik or nginx) on the domain in `PUBLIC_URL`.
2. Get the setup key with `docker logs opencookie`, open `PUBLIC_URL/admin/` and create the first admin.
3. Add a site. Its first scan starts by itself.
4. Paste the line the admin gives you as the **first** thing in the `<head>` of every page:

```html
<script src="https://consent.example.com/s/SITE_KEY/banner.js"></script>
```

The image runs on amd64 and arm64. Everything is stored in the `/data` volume: back it up.

<details>
<summary>The same with Docker Compose</summary>

```yaml
services:
  opencookie:
    image: ghcr.io/kumavolt/opencookie
    restart: unless-stopped
    ports: ["8080:8080"]
    environment:
      PUBLIC_URL: https://consent.example.com
      TZ: Europe/Amsterdam
    volumes: [opencookie-data:/data]
volumes:
  opencookie-data:
```

</details>

## Settings

Only `PUBLIC_URL` is required.

| Setting | What it does |
|---|---|
| `PUBLIC_URL` | The HTTPS address of this server. Used in snippets, emails and passkeys. |
| `TZ` | Time zone for dates on cookie policy pages, e.g. `Europe/Amsterdam`. Default `UTC`. |
| `SETUP_KEY` | Key to create the first admin. Without it, one is printed in the log. |
| `SMTP_URL`, `MAIL_FROM` | To email invitations and password resets, e.g. `smtps://user:pass@smtp.example.com:465`. Without them you copy invitation links yourself. |
| `REQUIRE_2FA` | `true` makes everyone use a passkey or authenticator app. |

<details>
<summary>All other settings</summary>

| Setting | What it does |
|---|---|
| `SECRET` | Hashes visitor IP addresses and encrypts 2FA secrets. Without it, one is generated in `/data/secret.key`. |
| `PORT` | Port inside the container. Default 8080. |
| `APP_NAME` | Name shown in the admin, emails and authenticator apps. |
| `SESSION_HOURS` | How long a login lasts. Default 12. |
| `AUTO_SCAN` | `false` stops the automatic first scan of a new site. |
| `SCAN_MAX_PAGES` | Pages per scan. Default 20. |
| `GRAVATAR` | `true` shows Gravatar photos. Off by default, because it sends a hash of each email address to Gravatar. |
| `HOMEPAGE_DIR` | A folder with an `index.html` to show at `/`. Without it, `/` opens the admin. |
| `DEEPL_API_KEY`, `LIBRETRANSLATE_URL` | For machine-translating cookie descriptions. |

Passkeys are tied to the host name in `PUBLIC_URL`. If you move to another domain, everyone adds their passkeys again.

</details>

## On your site

```html
<!-- Held back until the visitor allows statistics -->
<script type="text/plain" data-oc-category="statistics" src="https://example.com/analytics.js"></script>

<!-- An embed, replaced by a placeholder until consent -->
<iframe data-oc-category="marketing" data-oc-src="https://www.youtube-nocookie.com/embed/ID"></iframe>

<!-- A link that opens the cookie settings -->
<a href="#" data-oc-open>Cookie settings</a>

<!-- Your whole cookie policy, always up to date, in your site's own styles -->
<div data-oc-policy></div>

<!-- Or only the cookie table -->
<div data-oc-declaration></div>
```

After a choice, a small cookie button in the corner lets visitors change it. You can turn it off under Appearance; then put a `data-oc-open` link or the `data-oc-policy` block on every page, and the next scan checks that you did.

Scripts from about 50 known services (Meta, TikTok, LinkedIn, Hotjar, Clarity, YouTube and more) are held back automatically. Google tags get Consent Mode v2. In JavaScript: `OpenCookie.hasConsent('statistics')`, `OpenCookie.onChange(fn)` and the `opencookie:change` event.

## What it costs

| | 1 site | 10 sites | 50 sites |
|---|---|---|---|
| [Cookiebot](https://www.cookiebot.com/en/pricing/) | €360 a year | €1,800 a year | €9,000 a year |
| [iubenda](https://www.iubenda.com/en/pricing) (Advanced) | €240 a year | €2,399 a year | €11,994 a year |
| [CookieYes](https://www.cookieyes.com/pricing/) (Basic) | €90 a year | €900 a year | €4,500 a year |
| **OpenCookie** | **your server** | **the same server** | **the same server** |

<details>
<summary>How these were worked out</summary>

List prices excluding VAT, read on 26 November 2026, for a small business site on the cheapest plan that fits.

- **Cookiebot:** €30 a month for one domain. From four domains, sites of up to 350 subpages pay €15 a month each.
- **iubenda:** €19.99 a month per site, billed yearly, with 50,000 page views a month included.
- **CookieYes:** €90 a year per domain.

</details>

## Rule packs

| Pack | Model | What it adds |
|---|---|---|
| `nl-ap` | Opt-in | Telecommunicatiewet 11.7a and AP guidance. Privacy-friendly analytics can run without consent once you confirm the conditions. |
| `eu-edpb` | Opt-in | The EDPB baseline and the 2023 cookie banner taskforce findings. |
| `fr-cnil` | Opt-in | Consent lasts 13 months and a refusal is remembered for 6. |
| `de-tdddg` | Opt-in | TDDDG §25. |
| `uk-duaa` | Opt-in | Statistics cookies can be exempt under the Data (Use and Access) Act 2025, if visitors can object. |
| `us-gpc` | Opt-out | "Do not sell or share", with the Global Privacy Control signal honoured. |

## What's in it

- **Banner:** about 19 KB, no dependencies, in a Shadow DOM so site CSS can't break it. Bar, corner box or popup. Reject looks the same as Accept, nothing is pre-ticked, no cookie wall. Keyboard and screen-reader friendly.
- **Scanner:** a headless browser visits up to 20 pages before and after consent and flags cookies set too early.
- **Compliance check** per site, and a **consent log** with CSV export.
- **Texts** in Dutch, English, German, French, Spanish and Italian, all editable per site.
- **Clients and teams:** owners, editors and viewers; passkeys, authenticator apps and recovery codes; an activity log.
- **MCP server:** connect Claude Code or another AI assistant with an access token from Your account.

## FAQ

**Does it phone home?** No. The banner only talks to your server. The cookie database is downloaded from GitHub when you ask for it.

**Can my clients log in?** Yes. Invite them to their own client; they see only their own sites.

**Does it support IAB TCF?** Not yet. TCF is only needed for programmatic advertising.

**What does AGPL mean for me?** You can use, change and host it freely, also for paying clients. If you offer a changed version to others as a service, publish your changes.

## Development

Needs Node 24 or newer.

```sh
npm install
npx playwright install chromium
npm run build
SETUP_KEY=dev npm start
```

`npm test` runs the tests. The code is in [`src/banner`](src/banner) (the visitor script), [`src/scanner`](src/scanner), [`src/server`](src/server) (API, accounts, database), [`src/admin`](src/admin) (the admin UI) and [`src/core`](src/core) (rule packs, texts, cookie matching). `docker compose up --build` builds the image from source.

## Licence

[AGPL-3.0](LICENSE). Cookie data comes from the [Open Cookie Database](https://github.com/jkwakman/Open-Cookie-Database) under its own licence.
