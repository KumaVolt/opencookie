import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const ROLES = ['owner', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (v: unknown): v is Role => ROLES.includes(v as Role);
const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };
export const roleAtLeast = (have: Role | null, need: Role) => !!have && RANK[have] >= RANK[need];

export interface User {
  id: number;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  webauthnId: string;
  totpEnabled: boolean;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}
export interface UserSecrets {
  passwordHash: string | null;
  totpSecret: string | null;
  totpLastStep: number;
}
export interface Org {
  id: number;
  name: string;
  require2fa: boolean;
  createdAt: string;
}
export interface Membership {
  orgId: number;
  orgName: string;
  role: Role;
  require2fa: boolean;
}
export interface Passkey {
  id: string;
  userId: number;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  name: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}
export interface Session {
  id: string;
  userId: number;
  stage: 'mfa' | 'full';
  mfaAttempts: number;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  ip: string;
  userAgent: string;
}
export interface Token {
  id: string;
  kind: 'invite' | 'reset';
  email: string;
  userId: number | null;
  orgId: number | null;
  /** For invites: owner/editor/viewer, or "platform" for a platform admin. */
  role: string;
  createdBy: number | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}
export interface AuditEntry {
  id: number;
  createdAt: string;
  userId: number | null;
  userEmail: string;
  orgId: number | null;
  siteId: number | null;
  action: string;
  detail: string;
  ip: string;
}

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

const toUser = (r: Row): User => ({
  id: Number(r.id),
  email: String(r.email),
  name: String(r.name),
  isPlatformAdmin: Boolean(r.is_platform_admin),
  webauthnId: String(r.webauthn_id),
  totpEnabled: !!r.totp_secret,
  disabled: Boolean(r.disabled),
  createdAt: String(r.created_at),
  lastLoginAt: s(r.last_login_at),
});
const toOrg = (r: Row): Org => ({ id: Number(r.id), name: String(r.name), require2fa: Boolean(r.require_2fa), createdAt: String(r.created_at) });
const toPasskey = (r: Row): Passkey => ({
  id: String(r.id),
  userId: Number(r.user_id),
  publicKey: new Uint8Array(r.public_key as Uint8Array),
  counter: Number(r.counter),
  transports: JSON.parse(String(r.transports || '[]')),
  name: String(r.name),
  backedUp: Boolean(r.backed_up),
  createdAt: String(r.created_at),
  lastUsedAt: s(r.last_used_at),
});
const toSession = (r: Row): Session => ({
  id: String(r.id),
  userId: Number(r.user_id),
  stage: String(r.stage) as Session['stage'],
  mfaAttempts: Number(r.mfa_attempts),
  createdAt: String(r.created_at),
  expiresAt: String(r.expires_at),
  lastSeenAt: String(r.last_seen_at),
  ip: String(r.ip),
  userAgent: String(r.user_agent),
});
const toToken = (r: Row): Token => ({
  id: String(r.id),
  kind: String(r.kind) as Token['kind'],
  email: String(r.email),
  userId: n(r.user_id),
  orgId: n(r.org_id),
  role: String(r.role),
  createdBy: n(r.created_by),
  createdAt: String(r.created_at),
  expiresAt: String(r.expires_at),
  usedAt: s(r.used_at),
});

export function accounts(db: DatabaseSync) {
  const one = <T>(sql: string, map: (r: Row) => T, ...args: (string | number | null)[]): T | null => {
    const r = db.prepare(sql).get(...args) as Row | undefined;
    return r ? map(r) : null;
  };
  const all = <T>(sql: string, map: (r: Row) => T, ...args: (string | number | null)[]): T[] =>
    (db.prepare(sql).all(...args) as Row[]).map(map);

  return {
    // ---- users ----
    countUsers(): number {
      return Number((db.prepare('SELECT COUNT(*) AS n FROM users').get() as Row).n);
    },
    listUsers(): User[] {
      return all('SELECT * FROM users ORDER BY email', toUser);
    },
    getUser(id: number): User | null {
      return one('SELECT * FROM users WHERE id = ?', toUser, id);
    },
    getUserByEmail(email: string): User | null {
      return one('SELECT * FROM users WHERE email = ?', toUser, email.trim());
    },
    getUserByWebauthnId(wid: string): User | null {
      return one('SELECT * FROM users WHERE webauthn_id = ?', toUser, wid);
    },
    getUserSecrets(id: number): UserSecrets | null {
      return one('SELECT password_hash, totp_secret, totp_last_step FROM users WHERE id = ?', (r) => ({
        passwordHash: s(r.password_hash),
        totpSecret: s(r.totp_secret),
        totpLastStep: Number(r.totp_last_step),
      }), id);
    },
    createUser(u: { email: string; name: string; passwordHash: string | null; isPlatformAdmin?: boolean }): User {
      const r = db
        .prepare('INSERT INTO users (email, name, password_hash, is_platform_admin, webauthn_id, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
        .get(u.email.trim().toLowerCase(), u.name.trim(), u.passwordHash, u.isPlatformAdmin ? 1 : 0, randomBytes(16).toString('base64url'), now()) as Row;
      return this.getUser(Number(r.id))!;
    },
    updateUser(id: number, p: { name?: string; disabled?: boolean; isPlatformAdmin?: boolean }): void {
      if (p.name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(p.name.trim().slice(0, 120), id);
      if (p.disabled !== undefined) db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(p.disabled ? 1 : 0, id);
      if (p.isPlatformAdmin !== undefined) db.prepare('UPDATE users SET is_platform_admin = ? WHERE id = ?').run(p.isPlatformAdmin ? 1 : 0, id);
    },
    setPassword(id: number, hash: string): void {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
    },
    setTotp(id: number, encryptedSecret: string | null, lastStep = 0): void {
      db.prepare('UPDATE users SET totp_secret = ?, totp_last_step = ? WHERE id = ?').run(encryptedSecret, lastStep, id);
    },
    setTotpLastStep(id: number, step: number): void {
      db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?').run(step, id, step);
    },
    touchLogin(id: number): void {
      db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), id);
    },
    deleteUser(id: number): void {
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    },
    countPlatformAdmins(): number {
      return Number((db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_platform_admin = 1 AND disabled = 0').get() as Row).n);
    },

    // ---- organisations & memberships ----
    listOrgs(): Org[] {
      return all('SELECT * FROM organisations ORDER BY name', toOrg);
    },
    getOrg(id: number): Org | null {
      return one('SELECT * FROM organisations WHERE id = ?', toOrg, id);
    },
    createOrg(name: string): Org {
      const r = db.prepare('INSERT INTO organisations (name, created_at) VALUES (?, ?) RETURNING id').get(name.trim().slice(0, 200), now()) as Row;
      return this.getOrg(Number(r.id))!;
    },
    updateOrg(id: number, p: { name?: string; require2fa?: boolean }): void {
      if (p.name !== undefined) db.prepare('UPDATE organisations SET name = ? WHERE id = ?').run(p.name.trim().slice(0, 200), id);
      if (p.require2fa !== undefined) db.prepare('UPDATE organisations SET require_2fa = ? WHERE id = ?').run(p.require2fa ? 1 : 0, id);
    },
    deleteOrg(id: number): void {
      db.prepare('DELETE FROM organisations WHERE id = ?').run(id);
    },
    memberships(userId: number): Membership[] {
      return all(
        `SELECT m.org_id, m.role, o.name, o.require_2fa FROM memberships m JOIN organisations o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY o.name`,
        (r) => ({ orgId: Number(r.org_id), orgName: String(r.name), role: String(r.role) as Role, require2fa: Boolean(r.require_2fa) }),
        userId,
      );
    },
    roleIn(userId: number, orgId: number): Role | null {
      const r = db.prepare('SELECT role FROM memberships WHERE user_id = ? AND org_id = ?').get(userId, orgId) as Row | undefined;
      return r ? (String(r.role) as Role) : null;
    },
    orgMembers(orgId: number): (User & { role: Role })[] {
      return all('SELECT u.*, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY u.email', (r) => ({ ...toUser(r), role: String(r.role) as Role }), orgId);
    },
    setMembership(userId: number, orgId: number, role: Role): void {
      db.prepare(
        'INSERT INTO memberships (user_id, org_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, org_id) DO UPDATE SET role = excluded.role',
      ).run(userId, orgId, role, now());
    },
    removeMembership(userId: number, orgId: number): void {
      db.prepare('DELETE FROM memberships WHERE user_id = ? AND org_id = ?').run(userId, orgId);
    },
    countOwners(orgId: number): number {
      return Number((db.prepare(`SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'owner'`).get(orgId) as Row).n);
    },

    // ---- passkeys ----
    listPasskeys(userId: number): Passkey[] {
      return all('SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at', toPasskey, userId);
    },
    getPasskey(id: string): Passkey | null {
      return one('SELECT * FROM passkeys WHERE id = ?', toPasskey, id);
    },
    addPasskey(p: { id: string; userId: number; publicKey: Uint8Array; counter: number; transports: string[]; name: string; backedUp: boolean }): void {
      db.prepare('INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, backed_up, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        p.id, p.userId, p.publicKey, p.counter, JSON.stringify(p.transports), p.name.slice(0, 80), p.backedUp ? 1 : 0, now(),
      );
    },
    usePasskey(id: string, counter: number): void {
      db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').run(counter, now(), id);
    },
    renamePasskey(id: string, userId: number, name: string): void {
      db.prepare('UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?').run(name.trim().slice(0, 80), id, userId);
    },
    deletePasskey(id: string, userId: number): boolean {
      return Number(db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run(id, userId).changes) > 0;
    },

    // ---- recovery codes ----
    replaceRecoveryCodes(userId: number, hashes: string[]): void {
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
        const ins = db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)');
        for (const h of hashes) ins.run(userId, h);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    /** Marks a matching unused code as used. Returns true when one was found. */
    useRecoveryCode(userId: number, hash: string): boolean {
      return Number(db.prepare('UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL').run(now(), userId, hash).changes) > 0;
    },
    recoveryCodesLeft(userId: number): number {
      return Number((db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').get(userId) as Row).n);
    },

    // ---- sessions (id = sha256 of the cookie token) ----
    createSession(p: { id: string; userId: number; stage: Session['stage']; ttlMs: number; ip: string; userAgent: string }): void {
      const t = now();
      db.prepare('INSERT INTO sessions (id, user_id, stage, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        p.id, p.userId, p.stage, t, new Date(Date.now() + p.ttlMs).toISOString(), t, p.ip, p.userAgent.slice(0, 300),
      );
    },
    getSession(id: string): Session | null {
      return one('SELECT * FROM sessions WHERE id = ? AND expires_at > ?', toSession, id, now());
    },
    listSessions(userId: number): Session[] {
      return all(`SELECT * FROM sessions WHERE user_id = ? AND stage = 'full' AND expires_at > ? ORDER BY last_seen_at DESC`, toSession, userId, now());
    },
    upgradeSession(id: string, ttlMs: number): void {
      db.prepare(`UPDATE sessions SET stage = 'full', expires_at = ?, last_seen_at = ? WHERE id = ?`).run(new Date(Date.now() + ttlMs).toISOString(), now(), id);
    },
    countMfaAttempt(id: string): number {
      const r = db.prepare('UPDATE sessions SET mfa_attempts = mfa_attempts + 1 WHERE id = ? RETURNING mfa_attempts').get(id) as Row | undefined;
      return r ? Number(r.mfa_attempts) : 99;
    },
    touchSession(id: string): void {
      db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now(), id);
    },
    deleteSession(id: string, userId?: number): void {
      if (userId === undefined) db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      else db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(id, userId);
    },
    deleteUserSessions(userId: number, exceptId?: string): void {
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, exceptId ?? '');
    },
    purgeExpired(): void {
      const t = now();
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(t);
      // Keep used/expired links for 30 days so "this link was already used" can still be told apart from "unknown".
      db.prepare('DELETE FROM tokens WHERE expires_at <= ?').run(new Date(Date.now() - 30 * 86_400_000).toISOString());
    },

    // ---- invite / reset tokens (id = sha256 of the token in the link) ----
    createToken(p: Omit<Token, 'createdAt' | 'usedAt'>): void {
      db.prepare('INSERT INTO tokens (id, kind, email, user_id, org_id, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        p.id, p.kind, p.email.trim().toLowerCase(), p.userId, p.orgId, p.role, p.createdBy, now(), p.expiresAt,
      );
    },
    getValidToken(id: string, kind: Token['kind']): Token | null {
      return one('SELECT * FROM tokens WHERE id = ? AND kind = ? AND used_at IS NULL AND expires_at > ?', toToken, id, kind, now());
    },
    useToken(id: string): boolean {
      return Number(db.prepare('UPDATE tokens SET used_at = ? WHERE id = ? AND used_at IS NULL').run(now(), id).changes) > 0;
    },
    pendingInvites(orgId: number | null): Token[] {
      return orgId === null
        ? all(`SELECT * FROM tokens WHERE kind = 'invite' AND org_id IS NULL AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC`, toToken, now())
        : all(`SELECT * FROM tokens WHERE kind = 'invite' AND org_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC`, toToken, orgId, now());
    },
    revokeToken(id: string): void {
      db.prepare('DELETE FROM tokens WHERE id = ?').run(id);
    },
    revokeUserResetTokens(userId: number): void {
      db.prepare(`DELETE FROM tokens WHERE kind = 'reset' AND user_id = ?`).run(userId);
    },

    // ---- audit log ----
    audit(e: Omit<AuditEntry, 'id' | 'createdAt'>): void {
      db.prepare('INSERT INTO audit_log (created_at, user_id, user_email, org_id, site_id, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        now(), e.userId, e.userEmail, e.orgId, e.siteId, e.action, e.detail.slice(0, 1000), e.ip,
      );
    },
    listAudit(opts: { orgId?: number | null; userId?: number; limit?: number; offset?: number }): { total: number; rows: AuditEntry[] } {
      const where: string[] = [];
      const args: (number | null)[] = [];
      if (opts.orgId !== undefined) {
        if (opts.orgId === null) where.push('org_id IS NULL');
        else (where.push('org_id = ?'), args.push(opts.orgId));
      }
      if (opts.userId !== undefined) (where.push('user_id = ?'), args.push(opts.userId));
      const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${w}`).get(...args) as Row).n);
      const rows = all(
        `SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`,
        (r) => ({
          id: Number(r.id), createdAt: String(r.created_at), userId: n(r.user_id), userEmail: String(r.user_email), orgId: n(r.org_id),
          siteId: n(r.site_id), action: String(r.action), detail: String(r.detail), ip: String(r.ip),
        }),
        ...args, opts.limit ?? 50, opts.offset ?? 0,
      );
      return { total, rows };
    },
    purgeAudit(olderThanIso: string): void {
      db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(olderThanIso);
    },
  };
}
