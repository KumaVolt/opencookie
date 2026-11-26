import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Site } from '../core/types.ts';
import { isRole, roleAtLeast, type ApiToken, type Role, type Session, type User } from './accounts.ts';
import { config } from './config.ts';
import type { Db } from './db.ts';
import { mailEnabled, sendMail } from './mail.ts';
import {
  RateLimiter,
  decrypt,
  encrypt,
  hashPassword,
  newRecoveryCodes,
  newTotpSecret,
  normaliseRecoveryCode,
  passwordProblem,
  randomToken,
  sha256,
  totpUri,
  verifyPassword,
  verifyTotp,
} from './security.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    authSession: Session | null;
    /** Set when the request was made with a personal access token instead of a login session. */
    apiToken: ApiToken | null;
  }
}

const COOKIE = 'oc_admin';
const MFA_TTL = 10 * 60_000;
const RECENT_AUTH_MS = 10 * 60_000;
const INVITE_TTL = 7 * 86_400_000;
const RESET_TTL = 3600_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status: number, message: string, code?: string): never => {
  throw new ApiError(status, message, code);
};

/** Short-lived WebAuthn challenges and pending TOTP secrets, kept in memory. */
class Pending<T> {
  private m = new Map<string, { v: T; exp: number }>();
  set(k: string, v: T, ttl = 5 * 60_000) {
    if (this.m.size > 10_000) for (const [key, e] of this.m) if (e.exp < Date.now()) this.m.delete(key);
    this.m.set(k, { v, exp: Date.now() + ttl });
  }
  take(k: string): T | null {
    const e = this.m.get(k);
    this.m.delete(k);
    return e && e.exp > Date.now() ? e.v : null;
  }
  peek(k: string): T | null {
    const e = this.m.get(k);
    return e && e.exp > Date.now() ? e.v : null;
  }
}

/**
 * What a personal access token may do. Reading is allowed except account security and user management.
 * Writing is a short allow-list of site work; anything about logins, people or deleting stays in the dashboard.
 */
const TOKEN_WRITES: [string, RegExp][] = [
  ['POST', /^\/sites$/],
  ['PUT', /^\/sites\/\d+$/],
  ['POST', /^\/sites\/\d+\/cookies$/],
  ['PUT', /^\/sites\/\d+\/cookies\/\d+$/],
  ['POST', /^\/sites\/\d+\/cookies\/review$/],
  ['POST', /^\/sites\/\d+\/scans$/],
];
export function tokenAllowed(method: string, url: string, canWrite: boolean): boolean {
  const path = url.split('?')[0]!.replace(/^\/admin\/api/, '');
  if (method === 'GET' || method === 'HEAD') return path === '/me' || !/^\/(auth|me|users)(\/|$)/.test(path);
  return canWrite && TOKEN_WRITES.some(([m, re]) => m === method && re.test(path));
}

export function registerAuth(app: FastifyInstance, db: Db) {
  app.decorateRequest('user', null);
  app.decorateRequest('authSession', null);
  app.decorateRequest('apiToken', null);

  // First-run setup key: from SETUP_KEY/ADMIN_PASSWORD, or generated and printed once.
  let setupKey = config.setupKey;
  if (!setupKey && db.countUsers() === 0) {
    setupKey = randomToken(12);
    console.log(`[opencookie] No accounts yet. Open ${config.publicUrl}/admin/ and use this setup key to create the first admin: ${setupKey}`);
  }

  const ipLimiter = new RateLimiter(30, 15 * 60_000);
  const emailLimiter = new RateLimiter(10, 15 * 60_000);
  const passwordCheckLimiter = new RateLimiter(10, 15 * 60_000);
  const challenges = new Pending<string>();
  const pendingTotp = new Pending<string>();

  // ------------------------------------------------------------- helpers
  const tokenFrom = (req: FastifyRequest) =>
    (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);

  const setCookie = (reply: FastifyReply, token: string, maxAgeSec: number) =>
    reply.header('Set-Cookie', `${COOKIE}=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${config.secureCookies ? '; Secure' : ''}`);
  const clearCookie = (reply: FastifyReply) => reply.header('Set-Cookie', `${COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`);

  const startSession = (req: FastifyRequest, reply: FastifyReply, user: User, stage: Session['stage']) => {
    if (req.authSession) db.deleteSession(req.authSession.id); // new token at every step (no session fixation)
    const token = randomToken();
    const ttl = stage === 'mfa' ? MFA_TTL : config.sessionHours * 3600_000;
    db.createSession({ id: sha256(token), userId: user.id, stage, ttlMs: ttl, ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') });
    setCookie(reply, token, Math.floor(ttl / 1000));
  };

  const audit = (req: FastifyRequest, action: string, o: { orgId?: number | null; siteId?: number | null; detail?: string; user?: User | null } = {}) => {
    const u = o.user !== undefined ? o.user : req.user;
    db.audit({ userId: u?.id ?? null, userEmail: u?.email ?? '', orgId: o.orgId ?? null, siteId: o.siteId ?? null, action, detail: o.detail ?? '', ip: req.ip });
  };

  const hasSecondFactor = (u: User) => u.totpEnabled || db.listPasskeys(u.id).length > 0;
  const twoFactorRequired = (u: User) => config.require2fa || db.memberships(u.id).some((m) => m.require2fa);
  const mustEnroll = (u: User) => twoFactorRequired(u) && !hasSecondFactor(u);
  const mfaMethods = (u: User) => ({ totp: u.totpEnabled, passkey: db.listPasskeys(u.id).length > 0, recovery: db.recoveryCodesLeft(u.id) > 0 });

  const completeLogin = (req: FastifyRequest, reply: FastifyReply, user: User, method: string) => {
    startSession(req, reply, user, 'full');
    db.touchLogin(user.id);
    audit(req, 'login', { user, detail: method });
    return { ok: true };
  };

  /** Sensitive changes need the password, unless the user signed in less than 10 minutes ago. */
  const confirmIdentity = async (req: FastifyRequest, password: unknown) => {
    const u = req.user!;
    if (req.authSession && Date.now() - Date.parse(req.authSession.createdAt) < RECENT_AUTH_MS) return;
    if (typeof password !== 'string' || !password) fail(403, 'Enter your password to confirm.', 'PASSWORD_REQUIRED');
    if (!passwordCheckLimiter.hit(`u${u.id}`)) fail(429, 'Too many attempts. Try again later.');
    if (!(await verifyPassword(password as string, db.getUserSecrets(u.id)?.passwordHash ?? null))) fail(403, 'Wrong password.', 'PASSWORD_REQUIRED');
  };

  const requirePlatform = (req: FastifyRequest) => {
    if (!req.user?.isPlatformAdmin) fail(403, 'Only platform admins can do this.');
  };
  const orgRole = (u: User, orgId: number): Role | null => (u.isPlatformAdmin ? 'owner' : db.roleIn(u.id, orgId));
  const requireOrg = (req: FastifyRequest, orgId: number, need: Role) => {
    const org = db.getOrg(orgId);
    if (!org) fail(404, 'Not found');
    const role = orgRole(req.user!, orgId);
    if (!role) fail(404, 'Not found');
    if (!roleAtLeast(role, need)) fail(403, `You need the ${need} role for this.`);
    return { org: org!, role: role! };
  };

  const avatarUrl = (email: string) => (config.gravatar ? `https://gravatar.com/avatar/${sha256(email.trim().toLowerCase())}?s=96&d=404` : null);
  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const link = (path: string, token: string) => `${config.publicUrl}/admin/#/${path}/${token}`;

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send({ error: err.message, code: err.code });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'Server error' : (err as Error).message });
  });

  // ------------------------------------------------------------- the gate
  const ENROLMENT_ALLOWED = /^\/admin\/api\/(me(\/|$|\?)|meta(\?|$))/;
  const tokenLimiter = new RateLimiter(600, 60_000);
  const authFailLimiter = new RateLimiter(30, 15 * 60_000);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/admin/api/')) return;
    const bearer = /^Bearer\s+(oc_pat_[\w-]+)$/i.exec(String(req.headers.authorization ?? ''))?.[1];
    if (req.headers.authorization) {
      // Personal access token: no cookies involved, so no CSRF header needed.
      if (authFailLimiter.blocked(req.ip)) return reply.code(429).send({ error: 'Too many attempts. Try again later.' });
      const t = bearer ? db.getApiTokenByHash(sha256(bearer)) : null;
      const user = t ? db.getUser(t.userId) : null;
      if (!t || !user || user.disabled) {
        authFailLimiter.hit(req.ip);
        return reply.code(401).header('WWW-Authenticate', 'Bearer realm="OpenCookie"').send({ error: 'Invalid or expired access token', code: 'TOKEN_INVALID' });
      }
      if (!tokenLimiter.hit(`t${t.id}`)) return reply.code(429).send({ error: 'Too many requests for this token. Slow down.' });
      if (mustEnroll(user)) return reply.code(403).send({ error: 'Set up two-factor authentication first.', code: 'MFA_ENROLMENT_REQUIRED' });
      if (!tokenAllowed(req.method, req.url, t.canWrite)) {
        return reply.code(403).send({ error: t.canWrite ? 'Access tokens cannot do this. Log in to the dashboard instead.' : 'This token is read-only.', code: 'TOKEN_SCOPE' });
      }
      req.user = user;
      req.apiToken = t;
      req.authSession = { id: `token:${t.id}`, userId: user.id, stage: 'full', createdAt: t.createdAt, expiresAt: t.expiresAt ?? '', lastSeenAt: new Date().toISOString(), ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') } as Session;
      if (!t.lastUsedAt || Date.now() - Date.parse(t.lastUsedAt) > 60_000) db.touchApiToken(t.id, req.ip);
      return;
    }
    // CSRF: every state-changing request must come from the admin page (custom header + SameSite=Strict cookie).
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-requested-with'] !== 'opencookie-admin') {
      return reply.code(403).send({ error: 'Missing CSRF header' });
    }
    const token = tokenFrom(req);
    const sess = token ? db.getSession(sha256(token)) : null;
    const user = sess ? db.getUser(sess.userId) : null;
    if (sess && (!user || user.disabled)) {
      db.deleteSession(sess.id);
      clearCookie(reply);
    } else if (sess) {
      req.authSession = sess;
      req.user = user;
    }
    if (req.url.startsWith('/admin/api/auth/')) return;
    if (!req.authSession || req.authSession.stage !== 'full' || !req.user) {
      req.user = null;
      return reply.code(401).send({ error: 'Not logged in', code: 'LOGIN_REQUIRED' });
    }
    if (Date.now() - Date.parse(req.authSession.lastSeenAt) > 60_000) db.touchSession(req.authSession.id);
    if (mustEnroll(req.user) && !ENROLMENT_ALLOWED.test(req.url)) {
      return reply.code(403).send({ error: 'Set up two-factor authentication first.', code: 'MFA_ENROLMENT_REQUIRED' });
    }
  });

  // ======================================================= public auth routes
  app.get('/admin/api/auth/state', async (req) => ({
    setupNeeded: db.countUsers() === 0,
    mail: mailEnabled(),
    appName: config.appName,
    stage: req.authSession?.stage ?? null,
    mfa: req.authSession?.stage === 'mfa' && req.user ? mfaMethods(req.user) : null,
  }));

  app.post('/admin/api/auth/setup', async (req, reply) => {
    if (db.countUsers() > 0) fail(409, 'Setup is already done. Log in instead.');
    if (!ipLimiter.hit(`setup:${req.ip}`)) fail(429, 'Too many attempts. Try again later.');
    const b = body(req);
    const a = sha256(str(b.setupKey)), e = sha256(setupKey);
    if (!setupKey || !timingSafeEqual(Buffer.from(a), Buffer.from(e))) fail(403, 'Wrong setup key. It is the SETUP_KEY (or ADMIN_PASSWORD) set on the server, or the key printed in the server log.');
    const email = str(b.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');
    const pwErr = passwordProblem(b.password, email);
    if (pwErr) fail(400, pwErr);
    const user = db.createUser({ email, name: str(b.name), passwordHash: await hashPassword(str(b.password)), isPlatformAdmin: true });
    // Sites from before accounts existed: give the first admin ownership of that organisation too.
    for (const o of db.listOrgs()) db.setMembership(user.id, o.id, 'owner');
    audit(req, 'account_created', { user, detail: 'first platform admin' });
    return completeLogin(req, reply, user, 'password');
  });

  app.post('/admin/api/auth/login', async (req, reply) => {
    const b = body(req);
    const email = str(b.email).trim().toLowerCase();
    if (ipLimiter.blocked(`login:${req.ip}`) || emailLimiter.blocked(`login:${email}`)) fail(429, 'Too many failed logins. Wait 15 minutes and try again.');
    const user = db.getUserByEmail(email);
    const ok = await verifyPassword(str(b.password), user ? db.getUserSecrets(user.id)?.passwordHash ?? null : null);
    if (!ok || !user || user.disabled) {
      ipLimiter.hit(`login:${req.ip}`);
      emailLimiter.hit(`login:${email}`);
      if (user) audit(req, 'login_failed', { user, detail: user.disabled ? 'account disabled' : 'wrong password' });
      fail(401, 'Wrong email or password.');
    }
    emailLimiter.reset(`login:${email}`);
    if (hasSecondFactor(user!)) {
      startSession(req, reply, user!, 'mfa');
      return { mfa: mfaMethods(user!) };
    }
    return completeLogin(req, reply, user!, 'password');
  });

  const mfaUser = (req: FastifyRequest) => {
    if (req.authSession?.stage !== 'mfa' || !req.user) fail(401, 'Your login expired. Start again.', 'LOGIN_REQUIRED');
    if (db.countMfaAttempt(req.authSession!.id) > 5) {
      db.deleteSession(req.authSession!.id);
      fail(429, 'Too many wrong codes. Log in again.', 'LOGIN_REQUIRED');
    }
    return req.user!;
  };

  app.post('/admin/api/auth/mfa/totp', async (req, reply) => {
    const user = mfaUser(req);
    const sec = db.getUserSecrets(user.id);
    if (!sec?.totpSecret) fail(400, 'No authenticator app is set up for this account.');
    const step = verifyTotp(decrypt(sec!.totpSecret!, config.secret), str(body(req).code), sec!.totpLastStep);
    if (step === null) {
      audit(req, 'login_failed', { user, detail: 'wrong authenticator code' });
      fail(401, 'That code is not right. Check the time on your phone and try the newest code.');
    }
    db.setTotpLastStep(user.id, step!);
    return completeLogin(req, reply, user, 'password + authenticator app');
  });

  app.post('/admin/api/auth/mfa/recovery', async (req, reply) => {
    const user = mfaUser(req);
    if (!db.useRecoveryCode(user.id, sha256(normaliseRecoveryCode(str(body(req).code))))) {
      audit(req, 'login_failed', { user, detail: 'wrong recovery code' });
      fail(401, 'That recovery code is not valid or was already used.');
    }
    const left = db.recoveryCodesLeft(user.id);
    completeLogin(req, reply, user, `password + recovery code (${left} left)`);
    return { ok: true, recoveryCodesLeft: left };
  });

  app.post('/admin/api/auth/mfa/passkey/options', async (req) => {
    if (req.authSession?.stage !== 'mfa' || !req.user) fail(401, 'Your login expired. Start again.', 'LOGIN_REQUIRED');
    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      allowCredentials: db.listPasskeys(req.user!.id).map((p) => ({ id: p.id, transports: p.transports })),
      userVerification: 'preferred',
    });
    challenges.set(`mfa:${req.authSession!.id}`, options.challenge);
    return options;
  });

  const checkAssertion = async (response: AuthenticationResponseJSON, expectedChallenge: string, userVerification: boolean) => {
    const pk = response?.id ? db.getPasskey(response.id) : null;
    if (!pk) fail(401, 'This passkey is not registered here.');
    let v;
    try {
      v = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        credential: { id: pk!.id, publicKey: pk!.publicKey as Uint8Array<ArrayBuffer>, counter: pk!.counter, transports: pk!.transports as never },
        requireUserVerification: userVerification,
      });
    } catch (e) {
      fail(401, `Passkey check failed: ${(e as Error).message}`);
    }
    if (!v!.verified) fail(401, 'Passkey check failed.');
    db.usePasskey(pk!.id, v!.authenticationInfo.newCounter);
    return pk!;
  };

  app.post('/admin/api/auth/mfa/passkey/verify', async (req, reply) => {
    const user = mfaUser(req);
    const challenge = challenges.take(`mfa:${req.authSession!.id}`);
    if (!challenge) fail(400, 'The passkey request expired. Try again.');
    const pk = await checkAssertion(body(req).response as AuthenticationResponseJSON, challenge!, false);
    if (pk.userId !== user.id) fail(401, 'This passkey belongs to another account.');
    return completeLogin(req, reply, user, `password + passkey "${pk.name}"`);
  });

  // Passwordless: sign in with a passkey only (user verification = the second factor).
  app.post('/admin/api/auth/passkey/options', async (req) => {
    if (!ipLimiter.hit(`pk:${req.ip}`)) fail(429, 'Too many attempts. Try again later.');
    const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: 'required' });
    const challengeId = randomToken(16);
    challenges.set(`pl:${challengeId}`, options.challenge);
    return { challengeId, options };
  });

  app.post('/admin/api/auth/passkey/verify', async (req, reply) => {
    const b = body(req);
    const challenge = challenges.take(`pl:${str(b.challengeId)}`);
    if (!challenge) fail(400, 'The passkey request expired. Try again.');
    const response = b.response as AuthenticationResponseJSON;
    const pk = await checkAssertion(response, challenge!, true);
    const user = db.getUser(pk.userId);
    if (!user || user.disabled) fail(401, 'This account is disabled.');
    if (response.response?.userHandle && response.response.userHandle !== user!.webauthnId) fail(401, 'Passkey does not match the account.');
    return completeLogin(req, reply, user!, `passkey "${pk.name}"`);
  });

  app.post('/admin/api/auth/logout', async (req, reply) => {
    if (req.authSession) {
      db.deleteSession(req.authSession.id);
      if (req.authSession.stage === 'full') audit(req, 'logout');
    }
    clearCookie(reply);
    return { ok: true };
  });

  // ---- invitations ----
  const validInvite = (token: string) => {
    const t = db.getValidToken(sha256(token), 'invite');
    if (!t) fail(404, 'This invitation link is invalid, has expired or was already used. Ask for a new one.');
    return t!;
  };

  app.get<{ Params: { token: string } }>('/admin/api/auth/invite/:token', async (req) => {
    const t = validInvite(req.params.token);
    return {
      email: t.email,
      orgName: t.orgId ? db.getOrg(t.orgId)?.name ?? '' : '',
      role: t.role,
      userExists: !!db.getUserByEmail(t.email),
    };
  });

  app.post<{ Params: { token: string } }>('/admin/api/auth/invite/:token', async (req, reply) => {
    if (!ipLimiter.hit(`invite:${req.ip}`)) fail(429, 'Too many attempts. Try again later.');
    const t = validInvite(req.params.token);
    const b = body(req);
    let user = db.getUserByEmail(t.email);
    if (user) {
      if (user.disabled) fail(403, 'This account is disabled.');
      if (!(await verifyPassword(str(b.password), db.getUserSecrets(user.id)?.passwordHash ?? null))) fail(401, 'Wrong password for this account.');
    } else {
      const pwErr = passwordProblem(b.password, t.email);
      if (pwErr) fail(400, pwErr);
      const hash = await hashPassword(str(b.password));
      user = db.createUser({ email: t.email, name: str(b.name), passwordHash: hash });
      audit(req, 'account_created', { user, orgId: t.orgId, detail: 'via invitation' });
    }
    if (!db.useToken(t.id)) fail(409, 'This invitation was already used.');
    if (t.role === 'platform') db.updateUser(user.id, { isPlatformAdmin: true });
    else if (t.orgId && isRole(t.role)) db.setMembership(user.id, t.orgId, t.role);
    audit(req, 'invite_accepted', { user, orgId: t.orgId, detail: t.role });
    user = db.getUser(user.id)!;
    if (hasSecondFactor(user)) {
      startSession(req, reply, user, 'mfa');
      return { mfa: mfaMethods(user) };
    }
    return completeLogin(req, reply, user, 'password (invitation)');
  });

  // ---- password reset ----
  const issueReset = (req: FastifyRequest, user: User) => {
    db.revokeUserResetTokens(user.id);
    const token = randomToken();
    db.createToken({ id: sha256(token), kind: 'reset', email: user.email, userId: user.id, orgId: null, role: '', createdBy: req.user?.id ?? null, expiresAt: new Date(Date.now() + RESET_TTL).toISOString() });
    return link('reset', token);
  };

  app.post('/admin/api/auth/forgot', async (req) => {
    const email = str(body(req).email).trim().toLowerCase();
    if (!ipLimiter.hit(`forgot:${req.ip}`) || !emailLimiter.hit(`forgot:${email}`)) fail(429, 'Too many requests. Try again later.');
    const user = db.getUserByEmail(email);
    if (mailEnabled() && user && !user.disabled) {
      const url = issueReset(req, user);
      await sendMail(user.email, `${config.appName}: reset your password`,
        `Someone asked to reset the password for ${user.email}.\n\nOpen this link within 1 hour to choose a new password:\n${url}\n\nIf this was not you, you can ignore this email. Your two-factor authentication stays on.`);
      audit(req, 'password_reset_requested', { user });
    }
    // Same answer whether or not the account exists.
    return { ok: true, mail: mailEnabled() };
  });

  app.get<{ Params: { token: string } }>('/admin/api/auth/reset/:token', async (req) => {
    const t = db.getValidToken(sha256(req.params.token), 'reset');
    if (!t) fail(404, 'This reset link is invalid, has expired or was already used.');
    return { email: t!.email };
  });

  app.post<{ Params: { token: string } }>('/admin/api/auth/reset/:token', async (req) => {
    if (!ipLimiter.hit(`reset:${req.ip}`)) fail(429, 'Too many attempts. Try again later.');
    const t = db.getValidToken(sha256(req.params.token), 'reset');
    if (!t || !t.userId) fail(404, 'This reset link is invalid, has expired or was already used.');
    const user = db.getUser(t!.userId!);
    if (!user) fail(404, 'Account not found.');
    const pw = body(req).password;
    const pwErr = passwordProblem(pw, user!.email);
    if (pwErr) fail(400, pwErr);
    if (!db.useToken(t!.id)) fail(409, 'This link was already used.');
    db.setPassword(user!.id, await hashPassword(String(pw)));
    db.deleteUserSessions(user!.id);
    audit(req, 'password_reset', { user });
    return { ok: true };
  });

  // ============================================================ your account
  const accountView = (req: FastifyRequest) => {
    const u = req.user!;
    return {
      user: { id: u.id, email: u.email, name: u.name, isPlatformAdmin: u.isPlatformAdmin, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, avatarUrl: avatarUrl(u.email) },
      memberships: db.memberships(u.id),
      /** null in the dashboard; true/false when called with an access token. */
      tokenCanWrite: req.apiToken ? req.apiToken.canWrite : null,
      totpEnabled: u.totpEnabled,
      passkeys: db.listPasskeys(u.id).map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt, backedUp: p.backedUp })),
      recoveryCodesLeft: db.recoveryCodesLeft(u.id),
      twoFactorRequired: twoFactorRequired(u),
      mustEnroll2fa: mustEnroll(u),
      recentAuth: !!req.authSession && Date.now() - Date.parse(req.authSession.createdAt) < RECENT_AUTH_MS,
      sessions: db.listSessions(u.id).map((s) => ({ id: s.id, current: s.id === req.authSession?.id, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, ip: s.ip, userAgent: s.userAgent })),
      mail: mailEnabled(),
    };
  };

  app.get('/admin/api/me', async (req) => accountView(req));

  app.put('/admin/api/me', async (req) => {
    db.updateUser(req.user!.id, { name: str(body(req).name) });
    req.user = db.getUser(req.user!.id);
    return accountView(req);
  });

  app.post('/admin/api/me/password', async (req) => {
    const b = body(req);
    const u = req.user!;
    if (!passwordCheckLimiter.hit(`u${u.id}`)) fail(429, 'Too many attempts. Try again later.');
    if (!(await verifyPassword(str(b.current), db.getUserSecrets(u.id)?.passwordHash ?? null))) fail(403, 'Your current password is wrong.');
    const pwErr = passwordProblem(b.next, u.email);
    if (pwErr) fail(400, pwErr);
    db.setPassword(u.id, await hashPassword(str(b.next)));
    db.deleteUserSessions(u.id, req.authSession!.id);
    audit(req, 'password_changed', { detail: 'other sessions signed out' });
    return { ok: true };
  });

  // ---- authenticator app (TOTP) ----
  app.post('/admin/api/me/totp/setup', async (req) => {
    await confirmIdentity(req, body(req).password);
    const secret = newTotpSecret();
    pendingTotp.set(`u${req.user!.id}`, secret, 10 * 60_000);
    return { secret, uri: totpUri(secret, req.user!.email, config.appName) };
  });

  app.post('/admin/api/me/totp/enable', async (req) => {
    const u = req.user!;
    const secret = pendingTotp.peek(`u${u.id}`);
    if (!secret) fail(400, 'The setup expired. Start again.');
    const step = verifyTotp(secret!, str(body(req).code));
    if (step === null) fail(400, 'That code is not right. Enter the 6-digit code your app shows now.');
    pendingTotp.take(`u${u.id}`);
    db.setTotp(u.id, encrypt(secret!, config.secret), step!);
    audit(req, '2fa_totp_enabled');
    const codes = db.recoveryCodesLeft(u.id) === 0 ? newRecoveryCodes() : null;
    if (codes) db.replaceRecoveryCodes(u.id, codes.map((c) => sha256(normaliseRecoveryCode(c))));
    return { ok: true, recoveryCodes: codes };
  });

  const blockRemovingLastFactor = (u: User, removing: 'totp' | 'passkey') => {
    const passkeys = db.listPasskeys(u.id).length;
    const left = removing === 'totp' ? passkeys : (u.totpEnabled ? 1 : 0) + passkeys - 1;
    if (left === 0 && twoFactorRequired(u)) fail(409, 'Two-factor authentication is required for your account. Add another method before removing this one.');
  };

  app.delete('/admin/api/me/totp', async (req) => {
    await confirmIdentity(req, body(req).password);
    blockRemovingLastFactor(req.user!, 'totp');
    db.setTotp(req.user!.id, null);
    audit(req, '2fa_totp_disabled');
    return { ok: true };
  });

  app.post('/admin/api/me/recovery-codes', async (req) => {
    await confirmIdentity(req, body(req).password);
    const codes = newRecoveryCodes();
    db.replaceRecoveryCodes(req.user!.id, codes.map((c) => sha256(normaliseRecoveryCode(c))));
    audit(req, 'recovery_codes_regenerated');
    return { recoveryCodes: codes };
  });

  // ---- passkeys ----
  app.post('/admin/api/me/passkeys/options', async (req) => {
    await confirmIdentity(req, body(req).password);
    const u = req.user!;
    const options = await generateRegistrationOptions({
      rpName: config.appName,
      rpID: config.rpId,
      userName: u.email,
      userDisplayName: u.name || u.email,
      userID: new Uint8Array(Buffer.from(u.webauthnId, 'base64url')),
      attestationType: 'none',
      excludeCredentials: db.listPasskeys(u.id).map((p) => ({ id: p.id, transports: p.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    challenges.set(`reg:${u.id}`, options.challenge);
    return options;
  });

  app.post('/admin/api/me/passkeys/verify', async (req) => {
    const u = req.user!;
    const b = body(req);
    const challenge = challenges.take(`reg:${u.id}`);
    if (!challenge) fail(400, 'The passkey request expired. Try again.');
    let v;
    try {
      v = await verifyRegistrationResponse({
        response: b.response as RegistrationResponseJSON,
        expectedChallenge: challenge!,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        requireUserVerification: true,
      });
    } catch (e) {
      fail(400, `Could not add the passkey: ${(e as Error).message}`);
    }
    if (!v!.verified || !v!.registrationInfo) fail(400, 'Could not add the passkey.');
    const info = v!.registrationInfo!;
    if (db.getPasskey(info.credential.id)) fail(409, 'This passkey is already registered.');
    const name = str(b.name).trim() || 'Passkey';
    db.addPasskey({ id: info.credential.id, userId: u.id, publicKey: info.credential.publicKey, counter: info.credential.counter, transports: info.credential.transports ?? [], name, backedUp: info.credentialBackedUp });
    audit(req, 'passkey_added', { detail: name });
    return accountView(req);
  });

  app.put<{ Params: { id: string } }>('/admin/api/me/passkeys/:id', async (req) => {
    db.renamePasskey(req.params.id, req.user!.id, str(body(req).name) || 'Passkey');
    return accountView(req);
  });

  app.delete<{ Params: { id: string } }>('/admin/api/me/passkeys/:id', async (req) => {
    await confirmIdentity(req, body(req).password);
    blockRemovingLastFactor(req.user!, 'passkey');
    const pk = db.getPasskey(req.params.id);
    if (!pk || pk.userId !== req.user!.id) fail(404, 'Not found');
    db.deletePasskey(pk!.id, req.user!.id);
    audit(req, 'passkey_removed', { detail: pk!.name });
    return accountView(req);
  });

  // ---- sessions ----
  app.delete<{ Params: { id: string } }>('/admin/api/me/sessions/:id', async (req) => {
    db.deleteSession(req.params.id, req.user!.id);
    audit(req, 'session_revoked');
    return accountView(req);
  });
  app.post('/admin/api/me/sessions/revoke-others', async (req) => {
    db.deleteUserSessions(req.user!.id, req.authSession!.id);
    audit(req, 'sessions_revoked', { detail: 'all other sessions' });
    return accountView(req);
  });

  // ======================================================= personal access tokens
  const tokenView = (t: ApiToken) => ({ id: t.id, name: t.name, prefix: t.prefix, canWrite: t.canWrite, createdAt: t.createdAt, expiresAt: t.expiresAt, lastUsedAt: t.lastUsedAt, lastUsedIp: t.lastUsedIp });
  app.get('/admin/api/me/tokens', async (req) => db.listApiTokens(req.user!.id).map(tokenView));
  app.post('/admin/api/me/tokens', async (req) => {
    const b = body(req);
    await confirmIdentity(req, b.password);
    const name = String(b.name ?? '').trim().slice(0, 80);
    if (!name) fail(400, 'Give the token a name, e.g. "Claude on my laptop".');
    if (db.listApiTokens(req.user!.id).length >= 25) fail(400, 'You have 25 tokens. Delete some before making more.');
    const days = Number(b.expiresDays);
    const expiresAt = days > 0 ? new Date(Date.now() + Math.min(days, 366) * 86400_000).toISOString() : null;
    const token = `oc_pat_${randomToken(32)}`;
    const t = db.createApiToken({ userId: req.user!.id, name, hash: sha256(token), prefix: token.slice(0, 14), canWrite: b.canWrite === true, expiresAt });
    audit(req, 'token_created', { detail: `${name} (${t.canWrite ? 'read and write' : 'read only'})` });
    return { token, ...tokenView(t) };
  });
  app.delete<{ Params: { id: string } }>('/admin/api/me/tokens/:id', async (req) => {
    if (db.deleteApiToken(req.user!.id, Number(req.params.id))) audit(req, 'token_revoked', { detail: `token ${req.params.id}` });
    return { ok: true };
  });

  // ======================================================= organisations (clients)
  app.get('/admin/api/orgs', async (req) => {
    const u = req.user!;
    const orgs = u.isPlatformAdmin ? db.listOrgs() : db.memberships(u.id).map((m) => db.getOrg(m.orgId)!).filter(Boolean);
    return orgs.map((o) => ({
      ...o,
      role: orgRole(u, o.id),
      memberCount: db.orgMembers(o.id).length,
      siteCount: db.listSitesInOrgs([o.id]).length,
    }));
  });

  app.post('/admin/api/orgs', async (req) => {
    requirePlatform(req);
    const name = str(body(req).name).trim();
    if (!name) fail(400, 'Enter a name.');
    const org = db.createOrg(name);
    audit(req, 'org_created', { orgId: org.id, detail: name });
    return org;
  });

  app.get<{ Params: { id: string } }>('/admin/api/orgs/:id', async (req) => {
    const { org, role } = requireOrg(req, Number(req.params.id), 'viewer');
    const members = db.orgMembers(org.id).map((m) => ({ id: m.id, email: m.email, name: m.name, avatarUrl: avatarUrl(m.email), role: m.role, has2fa: hasSecondFactor(m), lastLoginAt: m.lastLoginAt, disabled: m.disabled }));
    const canManage = roleAtLeast(role, 'owner');
    return {
      org,
      role,
      members,
      invites: canManage ? db.pendingInvites(org.id).map((t) => ({ id: t.id, email: t.email, role: t.role, expiresAt: t.expiresAt })) : [],
      sites: db.listSitesInOrgs([org.id]).map((s) => ({ id: s.id, name: s.name, domain: s.domain })),
    };
  });

  app.put<{ Params: { id: string } }>('/admin/api/orgs/:id', async (req) => {
    const { org } = requireOrg(req, Number(req.params.id), 'owner');
    const b = body(req);
    db.updateOrg(org.id, { name: typeof b.name === 'string' && b.name.trim() ? b.name : undefined, require2fa: typeof b.require2fa === 'boolean' ? b.require2fa : undefined });
    audit(req, 'org_updated', { orgId: org.id, detail: JSON.stringify({ name: b.name, require2fa: b.require2fa }) });
    return db.getOrg(org.id);
  });

  app.delete<{ Params: { id: string } }>('/admin/api/orgs/:id', async (req) => {
    requirePlatform(req);
    const org = db.getOrg(Number(req.params.id));
    if (!org) fail(404, 'Not found');
    db.deleteOrg(org!.id);
    audit(req, 'org_deleted', { detail: org!.name });
    return { ok: true };
  });

  const createInvite = async (req: FastifyRequest, email: string, orgId: number | null, role: string, orgName: string) => {
    if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');
    const existing = db.getUserByEmail(email);
    if (existing && orgId && db.roleIn(existing.id, orgId)) fail(409, 'This person is already a member.');
    if (existing && role === 'platform' && existing.isPlatformAdmin) fail(409, 'This person is already a platform admin.');
    const token = randomToken();
    db.createToken({ id: sha256(token), kind: 'invite', email, userId: null, orgId, role, createdBy: req.user!.id, expiresAt: new Date(Date.now() + INVITE_TTL).toISOString() });
    const url = link('invite', token);
    const what = role === 'platform' ? `manage ${config.appName} as a platform admin` : `manage the cookie banners of ${orgName} (${role})`;
    const emailed = await sendMail(email, `${config.appName}: you are invited`,
      `${req.user!.name || req.user!.email} invited you to ${what}.\n\nOpen this link within 7 days to accept:\n${url}\n`);
    audit(req, 'invite_created', { orgId, detail: `${email} as ${role}${emailed ? ' (emailed)' : ''}` });
    return { link: url, emailed };
  };

  app.post<{ Params: { id: string } }>('/admin/api/orgs/:id/invites', async (req) => {
    const { org } = requireOrg(req, Number(req.params.id), 'owner');
    const b = body(req);
    if (!isRole(b.role)) fail(400, 'Choose a role: owner, editor or viewer.');
    return createInvite(req, str(b.email).trim().toLowerCase(), org.id, b.role as Role, org.name);
  });

  app.delete<{ Params: { id: string; inviteId: string } }>('/admin/api/orgs/:id/invites/:inviteId', async (req) => {
    const { org } = requireOrg(req, Number(req.params.id), 'owner');
    if (!db.pendingInvites(org.id).some((t) => t.id === req.params.inviteId)) fail(404, 'Not found');
    db.revokeToken(req.params.inviteId);
    audit(req, 'invite_revoked', { orgId: org.id });
    return { ok: true };
  });

  app.put<{ Params: { id: string; userId: string } }>('/admin/api/orgs/:id/members/:userId', async (req) => {
    const { org } = requireOrg(req, Number(req.params.id), 'owner');
    const userId = Number(req.params.userId);
    const role = body(req).role;
    if (!isRole(role)) fail(400, 'Choose a role: owner, editor or viewer.');
    const current = db.roleIn(userId, org.id);
    if (!current) fail(404, 'Not a member.');
    if (current === 'owner' && role !== 'owner' && db.countOwners(org.id) <= 1) fail(409, 'Every client needs at least one owner.');
    db.setMembership(userId, org.id, role as Role);
    audit(req, 'member_role_changed', { orgId: org.id, detail: `${db.getUser(userId)?.email}: ${current} → ${role}` });
    return { ok: true };
  });

  app.delete<{ Params: { id: string; userId: string } }>('/admin/api/orgs/:id/members/:userId', async (req) => {
    const orgId = Number(req.params.id);
    const userId = Number(req.params.userId);
    // Owners can remove anyone; everyone can leave.
    if (userId !== req.user!.id) requireOrg(req, orgId, 'owner');
    const current = db.roleIn(userId, orgId);
    if (!current) fail(404, 'Not a member.');
    if (current === 'owner' && db.countOwners(orgId) <= 1) fail(409, 'Every client needs at least one owner.');
    db.removeMembership(userId, orgId);
    audit(req, 'member_removed', { orgId, detail: db.getUser(userId)?.email ?? '' });
    return { ok: true };
  });

  // ============================================================ platform: users
  app.get('/admin/api/users', async (req) => {
    requirePlatform(req);
    return {
      users: db.listUsers().map((u) => ({
        id: u.id, email: u.email, name: u.name, avatarUrl: avatarUrl(u.email), isPlatformAdmin: u.isPlatformAdmin, disabled: u.disabled, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
        totpEnabled: u.totpEnabled, passkeys: db.listPasskeys(u.id).length, memberships: db.memberships(u.id),
      })),
      invites: db.pendingInvites(null).map((t) => ({ id: t.id, email: t.email, role: t.role, expiresAt: t.expiresAt })),
    };
  });

  app.post('/admin/api/users/invite-admin', async (req) => {
    requirePlatform(req);
    return createInvite(req, str(body(req).email).trim().toLowerCase(), null, 'platform', '');
  });

  app.delete<{ Params: { inviteId: string } }>('/admin/api/users/invites/:inviteId', async (req) => {
    requirePlatform(req);
    if (!db.pendingInvites(null).some((t) => t.id === req.params.inviteId)) fail(404, 'Not found');
    db.revokeToken(req.params.inviteId);
    audit(req, 'invite_revoked');
    return { ok: true };
  });

  const otherUser = (req: FastifyRequest, id: number) => {
    requirePlatform(req);
    const u = db.getUser(id);
    if (!u) fail(404, 'Not found');
    return u!;
  };

  app.put<{ Params: { id: string } }>('/admin/api/users/:id', async (req) => {
    const u = otherUser(req, Number(req.params.id));
    const b = body(req);
    if (u.id === req.user!.id && (b.disabled === true || b.isPlatformAdmin === false)) fail(409, 'You cannot disable yourself or remove your own platform admin role.');
    if (u.isPlatformAdmin && (b.disabled === true || b.isPlatformAdmin === false) && db.countPlatformAdmins() <= 1) fail(409, 'There must be at least one active platform admin.');
    db.updateUser(u.id, {
      disabled: typeof b.disabled === 'boolean' ? b.disabled : undefined,
      isPlatformAdmin: typeof b.isPlatformAdmin === 'boolean' ? b.isPlatformAdmin : undefined,
    });
    if (b.disabled === true) db.deleteUserSessions(u.id);
    audit(req, 'user_updated', { detail: `${u.email}: ${JSON.stringify({ disabled: b.disabled, isPlatformAdmin: b.isPlatformAdmin })}` });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/admin/api/users/:id/reset-link', async (req) => {
    const u = otherUser(req, Number(req.params.id));
    const url = issueReset(req, u);
    const emailed = await sendMail(u.email, `${config.appName}: reset your password`, `An administrator created a password reset link for you.\n\nOpen it within 1 hour:\n${url}\n`);
    audit(req, 'password_reset_link_created', { detail: u.email });
    return { link: url, emailed };
  });

  /** For someone who lost their phone and recovery codes: removes all their 2FA methods. */
  app.delete<{ Params: { id: string } }>('/admin/api/users/:id/mfa', async (req) => {
    const u = otherUser(req, Number(req.params.id));
    if (u.id === req.user!.id) fail(409, 'Use your account page to change your own 2FA.');
    db.setTotp(u.id, null);
    for (const p of db.listPasskeys(u.id)) db.deletePasskey(p.id, u.id);
    db.replaceRecoveryCodes(u.id, []);
    db.deleteUserSessions(u.id);
    audit(req, '2fa_reset_by_admin', { detail: u.email });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/admin/api/users/:id', async (req) => {
    const u = otherUser(req, Number(req.params.id));
    if (u.id === req.user!.id) fail(409, 'You cannot delete yourself.');
    if (u.isPlatformAdmin && db.countPlatformAdmins() <= 1) fail(409, 'There must be at least one active platform admin.');
    for (const m of db.memberships(u.id)) if (m.role === 'owner' && db.countOwners(m.orgId) <= 1) fail(409, `${u.email} is the only owner of ${m.orgName}. Make someone else owner first.`);
    db.deleteUser(u.id);
    audit(req, 'user_deleted', { detail: u.email });
    return { ok: true };
  });

  // ============================================================ audit log
  app.get<{ Querystring: { orgId?: string; offset?: string } }>('/admin/api/audit', async (req) => {
    const offset = Number(req.query.offset ?? 0) || 0;
    if (req.query.orgId) {
      const { org } = requireOrg(req, Number(req.query.orgId), 'owner');
      return db.listAudit({ orgId: org.id, offset });
    }
    if (req.user!.isPlatformAdmin) return db.listAudit({ offset });
    return db.listAudit({ userId: req.user!.id, offset });
  });

  // Housekeeping
  const purge = () => {
    db.purgeExpired();
    db.purgeAudit(new Date(Date.now() - 2 * 365 * 86_400_000).toISOString());
  };
  purge();
  setInterval(purge, 3600_000).unref();

  /** The user's role for a site: platform admins are owners everywhere. */
  const siteRole = (u: User, site: Site): Role | null => (u.isPlatformAdmin ? 'owner' : site.orgId ? db.roleIn(u.id, site.orgId) : null);

  return { audit, siteRole, orgRole, fail, requirePlatform };
}

export { ApiError };
