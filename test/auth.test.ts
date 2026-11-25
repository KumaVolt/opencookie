import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SETUP_KEY = 'test-setup-key';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'oc-test-'));
process.env.SECRET = 'test-secret';
// Reuse the downloaded cookie database instead of fetching it again.
const ocd = join(import.meta.dirname, '../data/open-cookie-database.json');
if (existsSync(ocd)) copyFileSync(ocd, join(process.env.DATA_DIR, 'open-cookie-database.json'));

const { buildServer } = await import('../src/server/index.ts');
const { base32Decode, hotp, totpStep, verifyTotp, hashPassword, verifyPassword, encrypt, decrypt } = await import('../src/server/security.ts');

test('TOTP matches RFC 6238 test vectors (SHA-1, 8 digits)', () => {
  const key = Buffer.from('12345678901234567890');
  const vectors: [number, string][] = [[59, '94287082'], [1111111109, '07081804'], [1234567890, '89005924'], [2000000000, '69279037']];
  for (const [t, code] of vectors) assert.equal(hotp(key, Math.floor(t / 30), 8), code);
});

test('TOTP verify accepts ±1 step and rejects reuse', () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  const now = Date.now();
  const code = hotp(base32Decode(secret), totpStep(now));
  const step = verifyTotp(secret, code, 0, now);
  assert.equal(step, totpStep(now));
  assert.equal(verifyTotp(secret, code, step!, now), null, 'same code cannot be used twice');
  assert.equal(verifyTotp(secret, '000000x', 0, now), null);
});

test('password hashing and secret encryption', async () => {
  const h = await hashPassword('correct horse battery');
  assert.ok(await verifyPassword('correct horse battery', h));
  assert.ok(!(await verifyPassword('wrong', h)));
  assert.ok(!(await verifyPassword('anything', null)));
  assert.equal(decrypt(encrypt('hello', 's1'), 's1'), 'hello');
  assert.throws(() => decrypt(encrypt('hello', 's1'), 's2'));
});

// ---------------------------------------------------------------- HTTP flows
type Res = { status: number; json: any; cookie?: string };
function client(app: Awaited<ReturnType<typeof buildServer>>['app']) {
  let cookie = '';
  return {
    async call(method: string, url: string, body?: unknown): Promise<Res> {
      const r = await app.inject({
        method: method as 'GET',
        url: '/admin/api' + url,
        headers: { 'x-requested-with': 'opencookie-admin', ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        payload: body ? JSON.stringify(body) : undefined,
      });
      const set = r.headers['set-cookie'];
      if (set) {
        const c = String(Array.isArray(set) ? set[0] : set).split(';')[0]!;
        cookie = c.endsWith('=') ? '' : c;
      }
      return { status: r.statusCode, json: r.headers['content-type']?.includes('json') ? r.json() : r.body };
    },
  };
}

test('accounts: setup, 2FA, invites, roles and client separation', async () => {
  const { app, db } = await buildServer({ dbFile: ':memory:', logger: false });
  const admin = client(app);

  assert.equal((await admin.call('GET', '/sites')).status, 401);
  assert.equal((await admin.call('GET', '/auth/state')).json.setupNeeded, true);
  assert.equal((await admin.call('POST', '/auth/setup', { setupKey: 'nope', email: 'a@x.nl', password: 'long enough pw' })).status, 403);
  const setup = await admin.call('POST', '/auth/setup', { setupKey: 'test-setup-key', email: 'Admin@Example.nl', name: 'Admin', password: 'sturdy password 1' });
  assert.equal(setup.status, 200, JSON.stringify(setup.json));
  assert.equal((await admin.call('POST', '/auth/setup', { setupKey: 'test-setup-key', email: 'b@x.nl', password: 'long enough pw' })).status, 409);

  // CSRF header is required on writes.
  const noCsrf = await app.inject({ method: 'POST', url: '/admin/api/orgs', payload: { name: 'x' } });
  assert.equal(noCsrf.statusCode, 403);

  // Two clients, one site each.
  const acme = (await admin.call('POST', '/orgs', { name: 'Acme' })).json;
  const bakery = (await admin.call('POST', '/orgs', { name: 'Bakkerij' })).json;
  const acmeSite = (await admin.call('POST', '/sites', { orgId: acme.id, name: 'Acme', domain: 'acme.nl' })).json;
  const bakerySite = (await admin.call('POST', '/sites', { orgId: bakery.id, name: 'Bakkerij', domain: 'bakkerij.nl' })).json;
  assert.ok(acmeSite.id && bakerySite.id);

  // Invite an editor to Acme.
  const inv = await admin.call('POST', `/orgs/${acme.id}/invites`, { email: 'ed@acme.nl', role: 'editor' });
  assert.equal(inv.status, 200);
  const token = inv.json.link.split('/').pop();
  const ed = client(app);
  assert.equal((await ed.call('GET', `/auth/invite/${token}`)).json.orgName, 'Acme');
  assert.equal((await ed.call('POST', `/auth/invite/${token}`, { name: 'Ed', password: 'short' })).status, 400);
  assert.equal((await ed.call('POST', `/auth/invite/${token}`, { name: 'Ed', password: 'editor password 1' })).status, 200);
  assert.equal((await client(app).call('POST', `/auth/invite/${token}`, { password: 'editor password 1' })).status, 404, 'invite link works once');

  // Editor sees only Acme, can edit it, cannot delete it, cannot see the bakery.
  const sites = (await ed.call('GET', '/sites')).json;
  assert.deepEqual(sites.map((s: { name: string }) => s.name), ['Acme']);
  assert.equal((await ed.call('PUT', `/sites/${acmeSite.id}`, { contact: 'privacy@acme.nl' })).status, 200);
  assert.equal((await ed.call('DELETE', `/sites/${acmeSite.id}`)).status, 403);
  assert.equal((await ed.call('GET', `/sites/${bakerySite.id}`)).status, 404);
  assert.equal((await ed.call('GET', `/sites/${bakerySite.id}/consents`)).status, 404);
  assert.equal((await ed.call('POST', `/orgs/${acme.id}/invites`, { email: 'x@acme.nl', role: 'owner' })).status, 403);
  assert.equal((await ed.call('POST', '/sites', { orgId: acme.id, name: 'New', domain: 'new.nl' })).status, 403);
  assert.equal((await ed.call('GET', '/users')).status, 403);

  // Owner requires 2FA for Acme → editor must enrol before doing anything else.
  assert.equal((await admin.call('PUT', `/orgs/${acme.id}`, { require2fa: true })).status, 200);
  const blocked = await ed.call('GET', '/sites');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'MFA_ENROLMENT_REQUIRED');
  assert.equal((await ed.call('GET', '/me')).json.mustEnroll2fa, true);

  // Enrol an authenticator app (recent login, so no password needed).
  const totp = (await ed.call('POST', '/me/totp/setup', {})).json;
  const code = hotp(base32Decode(totp.secret), totpStep());
  const enabled = await ed.call('POST', '/me/totp/enable', { code });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.json.recoveryCodes.length, 10);
  assert.equal((await ed.call('GET', '/sites')).status, 200);
  assert.equal((await ed.call('DELETE', '/me/totp', {})).status, 409, 'cannot remove the only factor when 2FA is required');

  // Log in again: password alone is not enough.
  await ed.call('POST', '/auth/logout', {});
  const login = await ed.call('POST', '/auth/login', { email: 'ed@acme.nl', password: 'editor password 1' });
  assert.deepEqual(login.json.mfa, { totp: true, passkey: false, recovery: true });
  assert.equal((await ed.call('GET', '/sites')).status, 401, 'half-logged-in session has no access');
  assert.equal((await ed.call('POST', '/auth/mfa/totp', { code: '000000' })).status, 401);
  // Reusing the enrolment code is rejected (replay); a recovery code works.
  assert.equal((await ed.call('POST', '/auth/mfa/totp', { code })).status, 401);
  const rec = await ed.call('POST', '/auth/mfa/recovery', { code: enabled.json.recoveryCodes[0].toUpperCase() });
  assert.equal(rec.status, 200);
  assert.equal(rec.json.recoveryCodesLeft, 9);
  assert.equal((await ed.call('GET', '/sites')).status, 200);

  // Wrong password: generic error, and the attempt is in the audit log.
  const bad = await client(app).call('POST', '/auth/login', { email: 'ed@acme.nl', password: 'nope nope nope' });
  assert.equal(bad.status, 401);
  assert.equal(bad.json.error, 'Wrong email or password.');
  const unknown = await client(app).call('POST', '/auth/login', { email: 'nobody@acme.nl', password: 'nope nope nope' });
  assert.equal(unknown.json.error, 'Wrong email or password.');
  const log = (await admin.call('GET', `/audit?orgId=${acme.id}`)).json;
  assert.ok(log.rows.some((r: { action: string }) => r.action === 'site_updated'));
  const all = (await admin.call('GET', '/audit')).json;
  assert.ok(all.rows.some((r: { action: string }) => r.action === 'login_failed'));

  // Last owner protection and admin 2FA reset.
  const members = (await admin.call('GET', `/orgs/${bakery.id}`)).json.members;
  assert.equal(members.length, 0);
  const edUser = db.getUserByEmail('ed@acme.nl')!;
  assert.equal((await admin.call('DELETE', `/users/${edUser.id}/mfa`)).status, 200);
  assert.equal((await ed.call('GET', '/sites')).status, 401, 'sessions end when 2FA is reset');

  // Disabled users cannot log in.
  await admin.call('PUT', `/users/${edUser.id}`, { disabled: true });
  assert.equal((await client(app).call('POST', '/auth/login', { email: 'ed@acme.nl', password: 'editor password 1' })).status, 401);

  // Password reset link from the admin.
  await admin.call('PUT', `/users/${edUser.id}`, { disabled: false });
  const reset = (await admin.call('POST', `/users/${edUser.id}/reset-link`)).json;
  const rt = reset.link.split('/').pop();
  const anon = client(app);
  assert.equal((await anon.call('POST', `/auth/reset/${rt}`, { password: 'brand new password' })).status, 200);
  assert.equal((await anon.call('POST', `/auth/reset/${rt}`, { password: 'brand new password' })).status, 404);
  assert.equal((await anon.call('POST', '/auth/login', { email: 'ed@acme.nl', password: 'brand new password' })).status, 200);

  await app.close();
});
