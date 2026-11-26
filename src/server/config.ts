import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const dataDir = resolve(process.env.DATA_DIR ?? resolve(root, 'data'));
const publicUrl = (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8080}`).replace(/\/$/, '');

/**
 * Secret used to hash visitor IPs and to encrypt 2FA secrets at rest.
 * Taken from SECRET, or generated once and kept in DATA_DIR/secret.key so it survives restarts.
 */
function loadSecret(): string {
  if (process.env.SECRET) return process.env.SECRET;
  const file = join(dataDir, 'secret.key');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dataDir, { recursive: true });
  const s = randomBytes(32).toString('hex');
  writeFileSync(file, s + '\n', { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {}
  console.warn(`[opencookie] SECRET is not set: generated one in ${file}. Back this file up; without it 2FA secrets cannot be read.`);
  return s;
}

export const config = {
  root,
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  /** Public URL of this server, used in embed snippets, e.g. https://consent.example.com */
  publicUrl,
  dataDir,
  distDir: resolve(root, 'dist'),
  /**
   * One-time key needed to create the first platform admin account. Falls back to the old
   * ADMIN_PASSWORD variable. When neither is set, a key is generated and printed at startup.
   */
  setupKey: process.env.SETUP_KEY ?? process.env.ADMIN_PASSWORD ?? '',
  secret: loadSecret(),
  cookieDbUrl:
    process.env.COOKIE_DB_URL ??
    'https://raw.githubusercontent.com/jkwakman/Open-Cookie-Database/master/open-cookie-database.json',
  scanMaxPages: Number(process.env.SCAN_MAX_PAGES ?? 20),
  secureCookies: publicUrl.startsWith('https://'),
  /** Passkeys are bound to this host name and origin. */
  rpId: new URL(publicUrl).hostname,
  origin: new URL(publicUrl).origin,
  /** Name shown in authenticator apps and passkey prompts. */
  appName: process.env.APP_NAME ?? 'OpenCookie',
  /** Require every user to set up 2FA (authenticator app or passkey). Organisations can also require it. */
  require2fa: /^(1|true|yes)$/i.test(process.env.REQUIRE_2FA ?? ''),
  /** e.g. smtps://user:pass@smtp.example.com:465 — used for invites and password resets. */
  smtpUrl: process.env.SMTP_URL ?? '',
  mailFrom: process.env.MAIL_FROM ?? '',
  sessionHours: Number(process.env.SESSION_HOURS ?? 12),
  /** Optional folder with a public homepage (index.html plus files), served at / instead of redirecting to the admin. */
  homepageDir: process.env.HOMEPAGE_DIR ? resolve(process.env.HOMEPAGE_DIR) : '',
  /** Show Gravatar photos. Off by default: it sends a hash of each email address to Gravatar. */
  /** Scan a site as soon as it is added. On by default; AUTO_SCAN=false turns it off. */
  autoScan: !/^(0|false|no)$/i.test(process.env.AUTO_SCAN ?? ''),
  gravatar: /^(1|true|yes)$/i.test(process.env.GRAVATAR ?? ''),
};
