import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

export const config = {
  root,
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  /** Public URL of this server, used in embed snippets, e.g. https://consent.example.com */
  publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8080}`).replace(/\/$/, ''),
  dataDir: resolve(process.env.DATA_DIR ?? resolve(root, 'data')),
  distDir: resolve(root, 'dist'),
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  /** Secret used to hash visitor IP addresses in the consent log. */
  secret: process.env.SECRET ?? randomBytes(32).toString('hex'),
  cookieDbUrl:
    process.env.COOKIE_DB_URL ??
    'https://raw.githubusercontent.com/jkwakman/Open-Cookie-Database/master/open-cookie-database.json',
  scanMaxPages: Number(process.env.SCAN_MAX_PAGES ?? 20),
  secureCookies: (process.env.PUBLIC_URL ?? '').startsWith('https://'),
};

if (!process.env.SECRET) {
  console.warn('[opencookie] SECRET is not set: IP hashes in the consent log will change after a restart. Set SECRET for production.');
}
