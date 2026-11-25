import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { renderSVG } from 'uqr';
import { api, describeAgent, fmtDate, HttpError, ROLE_HELP, ROLE_LABEL } from './api.ts';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ComponentChildren }) {
  return (
    <label class="field">
      <span>{label}</span>
      {children}
      {hint && <small class="muted">{hint}</small>}
    </label>
  );
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const passkeyError = (e: unknown) => {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return 'The passkey request was cancelled or timed out.';
  return msg(e);
};

function AuthCard({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <main class="login panel">
      <h1>🍪 {title}</h1>
      {children}
    </main>
  );
}

// ------------------------------------------------------------------ first run
export function Setup({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ setupKey: '', name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  return (
    <AuthCard title="Set up OpenCookie">
      <p class="muted">Create the first platform admin account. The setup key is <code>SETUP_KEY</code> (or <code>ADMIN_PASSWORD</code>) from the server settings, or the key printed in the server log.</p>
      <form onSubmit={(e) => {
        e.preventDefault();
        setErr('');
        api('POST', '/auth/setup', f).then(onDone).catch((x) => setErr(msg(x)));
      }}>
        <Field label="Setup key"><input required value={f.setupKey} onInput={(e) => setF({ ...f, setupKey: e.currentTarget.value })} autoComplete="off" /></Field>
        <Field label="Your name"><input value={f.name} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} autoComplete="name" /></Field>
        <Field label="Email"><input type="email" required value={f.email} onInput={(e) => setF({ ...f, email: e.currentTarget.value })} autoComplete="username" /></Field>
        <Field label="Password" hint="At least 10 characters. A passphrase of a few words works well."><input type="password" required minLength={10} value={f.password} onInput={(e) => setF({ ...f, password: e.currentTarget.value })} autoComplete="new-password" /></Field>
        {err && <p class="error-text" role="alert">{err}</p>}
        <button class="primary" type="submit">Create account</button>
      </form>
    </AuthCard>
  );
}

// ---------------------------------------------------------------------- login
type MfaMethods = { totp: boolean; passkey: boolean; recovery: boolean };

export function Login({ onDone, onMfa, mail }: { onDone: () => void; onMfa: (m: MfaMethods) => void; mail: boolean }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const passkeyLogin = async () => {
    setErr('');
    setBusy(true);
    try {
      const { challengeId, options } = await api<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>('POST', '/auth/passkey/options', {});
      const response = await startAuthentication({ optionsJSON: options });
      await api('POST', '/auth/passkey/verify', { challengeId, response });
      onDone();
    } catch (e) {
      setErr(passkeyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (forgot) {
    return (
      <AuthCard title="Reset your password">
        {!mail ? (
          <p>This server cannot send email. Ask your platform admin for a password reset link.</p>
        ) : sent ? (
          <p>If an account exists for <strong>{email}</strong>, we sent a link to reset the password. It works for 1 hour.</p>
        ) : (
          <form onSubmit={(e) => {
            e.preventDefault();
            api('POST', '/auth/forgot', { email }).then(() => setSent(true)).catch((x) => setErr(msg(x)));
          }}>
            <Field label="Email"><input type="email" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} autoComplete="username" autoFocus /></Field>
            {err && <p class="error-text" role="alert">{err}</p>}
            <button class="primary" type="submit">Send reset link</button>
          </form>
        )}
        <p><a href="#/" onClick={(e) => { e.preventDefault(); setForgot(false); setSent(false); setErr(''); }}>← Back to log in</a></p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Log in">
      <form onSubmit={(e) => {
        e.preventDefault();
        setErr('');
        setBusy(true);
        api<{ ok?: boolean; mfa?: MfaMethods }>('POST', '/auth/login', { email, password: pw })
          .then((r) => (r.mfa ? onMfa(r.mfa) : onDone()))
          .catch((x) => setErr(msg(x)))
          .finally(() => setBusy(false));
      }}>
        <Field label="Email"><input type="email" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} autoComplete="username webauthn" autoFocus /></Field>
        <Field label="Password"><input type="password" required value={pw} onInput={(e) => setPw(e.currentTarget.value)} autoComplete="current-password" /></Field>
        {err && <p class="error-text" role="alert">{err}</p>}
        <div class="stack">
          <button class="primary" type="submit" disabled={busy}>Log in</button>
          {browserSupportsWebAuthn() && <button type="button" disabled={busy} onClick={passkeyLogin}>🔑 Log in with a passkey</button>}
        </div>
      </form>
      <p><a href="#/" onClick={(e) => { e.preventDefault(); setForgot(true); setErr(''); }}>Forgot your password?</a></p>
    </AuthCard>
  );
}

export function MfaStep({ methods, onDone, onCancel }: { methods: MfaMethods; onDone: () => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'totp' | 'recovery'>(methods.totp ? 'totp' : 'recovery');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);

  const fail = (e: unknown) => {
    if (e instanceof HttpError && e.code === 'LOGIN_REQUIRED') return onCancel();
    setErr(passkeyError(e));
  };
  const usePasskey = async () => {
    setErr('');
    setBusy(true);
    try {
      const options = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('POST', '/auth/mfa/passkey/options', {});
      const response = await startAuthentication({ optionsJSON: options });
      await api('POST', '/auth/mfa/passkey/verify', { response });
      onDone();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  // Offer the passkey straight away when it is the only method.
  useEffect(() => {
    if (methods.passkey && !methods.totp) void usePasskey();
  }, []);

  if (left !== null) {
    return (
      <AuthCard title="Logged in with a recovery code">
        <p>You have <strong>{left}</strong> recovery code{left === 1 ? '' : 's'} left. {left <= 3 && 'Make new ones on your account page soon.'}</p>
        <button class="primary" onClick={onDone}>Continue</button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Two-step verification">
      <form onSubmit={(e) => {
        e.preventDefault();
        setErr('');
        setBusy(true);
        const req = mode === 'totp'
          ? api('POST', '/auth/mfa/totp', { code }).then(onDone)
          : api<{ recoveryCodesLeft: number }>('POST', '/auth/mfa/recovery', { code }).then((r) => setLeft(r.recoveryCodesLeft));
        req.catch(fail).finally(() => setBusy(false));
      }}>
        {mode === 'totp' ? (
          <Field label="Code from your authenticator app"><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required value={code} onInput={(e) => setCode(e.currentTarget.value)} autoFocus /></Field>
        ) : (
          <Field label="Recovery code" hint="One of the codes you saved when you set up two-step verification. Each code works once."><input required value={code} onInput={(e) => setCode(e.currentTarget.value)} autoComplete="off" autoFocus /></Field>
        )}
        {err && <p class="error-text" role="alert">{err}</p>}
        <div class="stack">
          <button class="primary" type="submit" disabled={busy}>Verify</button>
          {methods.passkey && <button type="button" disabled={busy} onClick={usePasskey}>🔑 Use a passkey instead</button>}
        </div>
      </form>
      <p class="row" style="justify-content:space-between">
        {mode === 'totp' && methods.recovery && <a href="#/" onClick={(e) => { e.preventDefault(); setMode('recovery'); setCode(''); setErr(''); }}>Use a recovery code</a>}
        {mode === 'recovery' && methods.totp && <a href="#/" onClick={(e) => { e.preventDefault(); setMode('totp'); setCode(''); setErr(''); }}>Use the authenticator app</a>}
        <a href="#/" onClick={(e) => { e.preventDefault(); api('POST', '/auth/logout', {}).finally(onCancel); }}>Cancel</a>
      </p>
    </AuthCard>
  );
}

// ---------------------------------------------------------- invite and reset
export function AcceptInvite({ token, onDone, onMfa }: { token: string; onDone: () => void; onMfa: (m: MfaMethods) => void }) {
  const [info, setInfo] = useState<{ email: string; orgName: string; role: string; userExists: boolean } | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [f, setF] = useState({ name: '', password: '' });
  const [err, setErr] = useState('');
  useEffect(() => {
    api<typeof info>('GET', `/auth/invite/${token}`).then(setInfo).catch((e) => setLoadErr(msg(e)));
  }, [token]);
  if (loadErr) return <AuthCard title="Invitation"><p class="error-text">{loadErr}</p><p><a href="#/">Go to log in</a></p></AuthCard>;
  if (!info) return <AuthCard title="Invitation"><p class="muted">Loading…</p></AuthCard>;
  const what = info.role === 'platform' ? 'as a platform admin' : <>to <strong>{info.orgName}</strong> as {ROLE_LABEL[info.role]?.toLowerCase()}</>;
  return (
    <AuthCard title="You are invited">
      <p>Join {what} with <strong>{info.email}</strong>.</p>
      <form onSubmit={(e) => {
        e.preventDefault();
        setErr('');
        api<{ mfa?: MfaMethods }>('POST', `/auth/invite/${token}`, f)
          .then((r) => { location.hash = '#/'; r.mfa ? onMfa(r.mfa) : onDone(); })
          .catch((x) => setErr(msg(x)));
      }}>
        {info.userExists ? (
          <Field label="Your password" hint="You already have an account. Confirm it's you."><input type="password" required value={f.password} onInput={(e) => setF({ ...f, password: e.currentTarget.value })} autoComplete="current-password" /></Field>
        ) : (
          <>
            <Field label="Your name"><input value={f.name} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} autoComplete="name" /></Field>
            <Field label="Choose a password" hint="At least 10 characters."><input type="password" required minLength={10} value={f.password} onInput={(e) => setF({ ...f, password: e.currentTarget.value })} autoComplete="new-password" /></Field>
          </>
        )}
        {err && <p class="error-text" role="alert">{err}</p>}
        <button class="primary" type="submit">Accept invitation</button>
      </form>
    </AuthCard>
  );
}

export function ResetPassword({ token }: { token: string }) {
  const [email, setEmail] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    api<{ email: string }>('GET', `/auth/reset/${token}`).then((r) => setEmail(r.email)).catch((e) => setLoadErr(msg(e)));
  }, [token]);
  if (loadErr) return <AuthCard title="Reset password"><p class="error-text">{loadErr}</p><p><a href="#/">Go to log in</a></p></AuthCard>;
  if (done) return <AuthCard title="Password changed"><p>You can now log in with your new password. Your two-step verification is still on.</p><p><a href="#/">Go to log in</a></p></AuthCard>;
  return (
    <AuthCard title="Choose a new password">
      <p class="muted">For {email ?? '…'}. All your open sessions will be signed out.</p>
      <form onSubmit={(e) => {
        e.preventDefault();
        api('POST', `/auth/reset/${token}`, { password: pw }).then(() => setDone(true)).catch((x) => setErr(msg(x)));
      }}>
        <input type="hidden" autoComplete="username" value={email ?? ''} />
        <Field label="New password" hint="At least 10 characters."><input type="password" required minLength={10} value={pw} onInput={(e) => setPw(e.currentTarget.value)} autoComplete="new-password" autoFocus /></Field>
        {err && <p class="error-text" role="alert">{err}</p>}
        <button class="primary" type="submit">Save password</button>
      </form>
    </AuthCard>
  );
}

// ----------------------------------------------------------------- account
export interface Me {
  user: { id: number; email: string; name: string; avatarUrl?: string | null; isPlatformAdmin: boolean; createdAt: string; lastLoginAt: string | null };
  memberships: { orgId: number; orgName: string; role: string; require2fa: boolean }[];
  totpEnabled: boolean;
  passkeys: { id: string; name: string; createdAt: string; lastUsedAt: string | null; backedUp: boolean }[];
  recoveryCodesLeft: number;
  twoFactorRequired: boolean;
  mustEnroll2fa: boolean;
  recentAuth: boolean;
  sessions: { id: string; current: boolean; createdAt: string; lastSeenAt: string; ip: string; userAgent: string }[];
  mail: boolean;
}

/** Runs a sensitive action; asks for the password when the server wants it. */
function useConfirmed() {
  const [ask, setAsk] = useState<null | { run: (pw: string) => Promise<unknown>; resolve: (ok: boolean) => void }>(null);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const run = async (action: (pw?: string) => Promise<unknown>) => {
    try {
      await action();
      return true;
    } catch (e) {
      if (!(e instanceof HttpError && e.code === 'PASSWORD_REQUIRED')) throw e;
      return new Promise<boolean>((resolve) => setAsk({ run: action, resolve }));
    }
  };
  const dialog = ask && (
    <div class="panel confirm" role="dialog" aria-modal="true" aria-labelledby="pw-title">
      <h3 id="pw-title" style="margin-top:0">Confirm it's you</h3>
      <form onSubmit={(e) => {
        e.preventDefault();
        setErr('');
        ask.run(pw).then(() => { ask.resolve(true); setAsk(null); setPw(''); }).catch((x) => setErr(msg(x)));
      }}>
        <Field label="Your password"><input type="password" required value={pw} onInput={(e) => setPw(e.currentTarget.value)} autoComplete="current-password" autoFocus /></Field>
        {err && <p class="error-text" role="alert">{err}</p>}
        <div class="row" style="justify-content:flex-start">
          <button class="primary" type="submit" style="flex:0 0 auto">Confirm</button>
          <button type="button" style="flex:0 0 auto" onClick={() => { ask.resolve(false); setAsk(null); setPw(''); }}>Cancel</button>
        </div>
      </form>
    </div>
  );
  return { run, dialog };
}

function RecoveryCodes({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const text = codes.join('\n');
  return (
    <div class="panel notice">
      <h3 style="margin-top:0">Save your recovery codes</h3>
      <p>If you lose your phone or passkeys, each of these codes lets you log in once. Store them in your password manager. <strong>They are shown only now.</strong></p>
      <pre class="codes">{text}</pre>
      <div class="row" style="justify-content:flex-start">
        <button style="flex:0 0 auto" onClick={() => navigator.clipboard?.writeText(text)}>Copy</button>
        <button style="flex:0 0 auto" onClick={() => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain' }));
          a.download = 'opencookie-recovery-codes.txt';
          a.click();
        }}>Download</button>
        <button class="primary" style="flex:0 0 auto" onClick={onClose}>I saved them</button>
      </div>
    </div>
  );
}

export function AccountPage({ me, reload, tab }: { me: Me; reload: () => void; tab: string }) {
  const t = me.mustEnroll2fa ? 'security' : ['security', 'profile', 'sessions'].includes(tab) ? tab : 'security';
  const { run, dialog } = useConfirmed();
  const [name, setName] = useState(me.user.name);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwMsg, setPwMsg] = useState('');
  const [totp, setTotp] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pkName, setPkName] = useState('');
  const [err, setErr] = useState('');
  const act = (p: Promise<unknown>) => p.then(reload).catch((e) => setErr(passkeyError(e)));

  const addPasskey = () => act(run(async (password?: string) => {
    const options = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('POST', '/me/passkeys/options', { password });
    const response = await startRegistration({ optionsJSON: options });
    await api('POST', '/me/passkeys/verify', { response, name: pkName || guessDeviceName() });
    setPkName('');
  }));

  return (
    <>
      <div class="pagehead"><div><h1>Your account</h1>
        <p class="muted">{me.user.email}{me.user.isPlatformAdmin && <> <span class="badge info">Platform admin</span></>}</p></div></div>
      {!me.mustEnroll2fa && (
        <nav class="tabs" aria-label="Account sections">
          {([['security', 'Sign-in & security'], ['profile', 'Profile'], ['sessions', `Devices (${me.sessions.length})`]] as const).map(([k, label]) => (
            <a href={`#/account/${k}`} class={t === k ? 'active' : ''} aria-current={t === k ? 'page' : undefined}>{label}</a>
          ))}
        </nav>
      )}
      {me.mustEnroll2fa && (
        <div class="issue warning" role="alert">
          <strong>Set up two-step verification to continue.</strong>
          <div>{me.memberships.some((m) => m.require2fa) ? `${me.memberships.filter((m) => m.require2fa).map((m) => m.orgName).join(', ')} requires` : 'This server requires'} it. Add a passkey (easiest) or an authenticator app below.</div>
        </div>
      )}
      {err && <p class="error-text" role="alert">{err}</p>}
      {dialog}
      {codes && <RecoveryCodes codes={codes} onClose={() => setCodes(null)} />}

      {t === 'security' && <>
      <section class="panel">
        <h2 style="margin-top:0">Passkeys</h2>
        <p class="muted">Log in with your fingerprint, face or device PIN instead of a password. A passkey counts as two-step verification on its own and cannot be phished.</p>
        {me.passkeys.length > 0 && (
          <div class="table-wrap"><table>
            <thead><tr><th>Name</th><th>Added</th><th>Last used</th><th></th></tr></thead>
            <tbody>
              {me.passkeys.map((p) => (
                <tr key={p.id}>
                  <td>{p.name} {p.backedUp && <span class="badge">synced</span>}</td>
                  <td>{fmtDate(p.createdAt)}</td>
                  <td>{fmtDate(p.lastUsedAt)}</td>
                  <td class="actions">
                    <button onClick={() => { const n = prompt('Name for this passkey', p.name); if (n) void act(api('PUT', `/me/passkeys/${encodeURIComponent(p.id)}`, { name: n })); }}>Rename</button>
                    <button class="danger" onClick={() => confirm(`Remove the passkey "${p.name}"?`) && act(run((password) => api('DELETE', `/me/passkeys/${encodeURIComponent(p.id)}`, { password })))}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {browserSupportsWebAuthn() ? (
          <div class="row" style="margin-top:12px">
            <input style="max-width:280px" placeholder={`Name, e.g. ${guessDeviceName()}`} value={pkName} onInput={(e) => setPkName(e.currentTarget.value)} />
            <button class="primary" style="flex:0 0 auto" onClick={addPasskey}>Add a passkey</button>
          </div>
        ) : <p class="muted">This browser does not support passkeys.</p>}
      </section>

      <section class="panel">
        <h2 style="margin-top:0">Authenticator app</h2>
        {me.totpEnabled ? (
          <div class="row">
            <span><span class="badge ok">On</span> Codes from an app such as 1Password, Google Authenticator or Microsoft Authenticator.</span>
            <button class="danger" style="flex:0 0 auto" onClick={() => confirm('Turn off the authenticator app?') && act(run((password) => api('DELETE', '/me/totp', { password })))}>Turn off</button>
          </div>
        ) : totp ? (
          <div class="totp-setup">
            <div class="qr" dangerouslySetInnerHTML={{ __html: renderSVG(totp.uri, { border: 1 }) }} aria-label="QR code for your authenticator app" role="img" />
            <div>
              <ol>
                <li>Scan the QR code with your authenticator app.</li>
                <li>Or enter this key by hand: <code class="secret">{totp.secret.match(/.{1,4}/g)!.join(' ')}</code></li>
                <li>Enter the 6-digit code the app shows:</li>
              </ol>
              <form class="row" onSubmit={(e) => {
                e.preventDefault();
                setErr('');
                api<{ recoveryCodes: string[] | null }>('POST', '/me/totp/enable', { code })
                  .then((r) => { setTotp(null); setCode(''); if (r.recoveryCodes) setCodes(r.recoveryCodes); reload(); })
                  .catch((x) => setErr(msg(x)));
              }}>
                <input style="max-width:160px" inputMode="numeric" autoComplete="one-time-code" required value={code} onInput={(e) => setCode(e.currentTarget.value)} />
                <button class="primary" type="submit" style="flex:0 0 auto">Turn on</button>
                <button type="button" style="flex:0 0 auto" onClick={() => setTotp(null)}>Cancel</button>
              </form>
            </div>
          </div>
        ) : (
          <div class="row">
            <span class="muted">Use a 6-digit code from an app on your phone when you log in.</span>
            <button style="flex:0 0 auto" onClick={() => act(run(async (password) => setTotp(await api('POST', '/me/totp/setup', { password }))))}>Set up</button>
          </div>
        )}
      </section>

      {(me.totpEnabled || me.passkeys.length > 0) && (
        <section class="panel">
          <h2 style="margin-top:0">Recovery codes</h2>
          <div class="row">
            <span>{me.recoveryCodesLeft > 0 ? <>{me.recoveryCodesLeft} unused code{me.recoveryCodesLeft === 1 ? '' : 's'} left.</> : <span class="badge warning">None</span>} Use one if you lose your phone and passkeys.</span>
            <button style="flex:0 0 auto" onClick={() => confirm('Make new recovery codes? Your old codes stop working.') && act(run(async (password) => setCodes((await api<{ recoveryCodes: string[] }>('POST', '/me/recovery-codes', { password })).recoveryCodes)))}>
              {me.recoveryCodesLeft > 0 ? 'Make new codes' : 'Create codes'}
            </button>
          </div>
        </section>
      )}
      {!me.mustEnroll2fa && (
          <section class="panel">
            <h2 style="margin-top:0">Password</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              setPwMsg('');
              api('POST', '/me/password', pw).then(() => { setPw({ current: '', next: '' }); setPwMsg('Password changed. Your other sessions were signed out.'); reload(); }).catch((x) => setPwMsg(msg(x)));
            }}>
              <input type="hidden" autoComplete="username" value={me.user.email} />
              <div class="row">
                <Field label="Current password"><input type="password" required value={pw.current} onInput={(e) => setPw({ ...pw, current: e.currentTarget.value })} autoComplete="current-password" /></Field>
                <Field label="New password"><input type="password" required minLength={10} value={pw.next} onInput={(e) => setPw({ ...pw, next: e.currentTarget.value })} autoComplete="new-password" /></Field>
              </div>
              <div class="row" style="justify-content:flex-start"><button type="submit" style="flex:0 0 auto">Change password</button><span role="status">{pwMsg}</span></div>
            </form>
          </section>
      )}
      </>}

      {t === 'profile' && (
        <>
          <section class="panel">
            <h2 style="margin-top:0">Profile</h2>
            <form class="row" onSubmit={(e) => { e.preventDefault(); void act(api('PUT', '/me', { name })); }}>
              <Field label="Name"><input value={name} onInput={(e) => setName(e.currentTarget.value)} autoComplete="name" /></Field>
              <button type="submit" style="flex:0 0 auto">Save</button>
            </form>
            <p class="muted">Your picture comes from {me.user.avatarUrl ? <a href="https://gravatar.com" target="_blank" rel="noopener">Gravatar</a> : 'your initials'}.</p>
          </section>
          {me.memberships.length > 0 && (
            <section class="panel flush table-wrap">
              <table>
                <thead><tr><th>Client</th><th>Your role</th><th>What you can do</th></tr></thead>
                <tbody>{me.memberships.map((m) => <tr><td>{m.orgName}</td><td>{ROLE_LABEL[m.role]}</td><td class="muted">{ROLE_HELP[m.role]}</td></tr>)}</tbody>
              </table>
            </section>
          )}
        </>
      )}
      {t === 'sessions' && (
        <>
          <section class="panel">
            <h2 style="margin-top:0">Where you're logged in</h2>
            <div class="table-wrap"><table>
              <thead><tr><th>Device</th><th>IP address</th><th>Logged in</th><th>Last active</th><th></th></tr></thead>
              <tbody>
                {me.sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{describeAgent(s.userAgent)} {s.current && <span class="badge ok">this device</span>}</td>
                    <td>{s.ip}</td>
                    <td>{fmtDate(s.createdAt)}</td>
                    <td>{fmtDate(s.lastSeenAt)}</td>
                    <td>{!s.current && <button onClick={() => act(api('DELETE', `/me/sessions/${s.id}`))}>Sign out</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {me.sessions.length > 1 && <button style="margin-top:8px" onClick={() => act(api('POST', '/me/sessions/revoke-others', {}))}>Sign out everywhere else</button>}
          </section>
        </>
      )}
    </>
  );
}

function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'This device';
}
