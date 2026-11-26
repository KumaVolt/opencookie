import { useEffect, useState } from 'preact/hooks';
import { api, fmtDate, ROLE_HELP, ROLE_LABEL } from './api.ts';
import { Field, type Me } from './auth.tsx';
import { Avatar, Icon } from './shell.tsx';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ================================================================== statistics
type Counts = { total: number; accept_all: number; reject_all: number; custom: number; gpc: number; opt_out: number };
interface Stats {
  days: number;
  scope: 'platform' | 'mine' | 'client';
  totals: { clients: number; sites: number; users: number; sitesWithProblems: number; consents: Counts };
  series: ({ day: string } & Counts)[];
  orgs: { id: number; name: string; sites: number; members: number; consents: Counts; problems: number }[];
  sites: { id: number; name: string; domain: string; orgId: number | null; consents: Counts; cookies: number; problems: number; warnings: number; lastScan: string | null }[];
}

const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : '—');
const other = (c: Counts) => c.custom + c.gpc + c.opt_out;

/** Stacked daily bars: accepted all / rejected all / custom choice. */
function ConsentChart({ series }: { series: Stats['series'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 180, pad = { l: 36, r: 8, t: 8, b: 22 };
  const max = Math.max(1, ...series.map((d) => d.total));
  const nice = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
  const bw = (W - pad.l - pad.r) / series.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  const keys: [keyof Counts | 'other', string][] = [['accept_all', 'var(--series-1)'], ['reject_all', 'var(--series-2)'], ['other', 'var(--series-3)']];
  const h = hover !== null ? series[hover] : null;
  return (
    <div class="viz">
      <div class="legend" aria-hidden="true">
        <span><i style="background:var(--series-1)" />Accepted all</span>
        <span><i style="background:var(--series-2)" />Rejected all</span>
        <span><i style="background:var(--series-3)" />Own choice, GPC or opt-out</span>
      </div>
      <div class="viz-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Consent choices per day over ${series.length} days`} onMouseLeave={() => setHover(null)}>
          {[0, nice / 2, nice].map((v) => (
            <g>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} class="grid" />
              <text x={pad.l - 6} y={y(v) + 4} text-anchor="end" class="axis">{v}</text>
            </g>
          ))}
          {series.map((d, i) => {
            let acc = 0;
            const x = pad.l + i * bw + bw * 0.15, w = Math.max(1, bw * 0.7);
            const vals = { accept_all: d.accept_all, reject_all: d.reject_all, other: other(d) } as Record<string, number>;
            const segs = keys.filter(([k]) => vals[k]! > 0);
            return (
              <g onMouseEnter={() => setHover(i)}>
                <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
                {segs.map(([k, color], j) => {
                  const v = vals[k]!;
                  const top = y(acc + v), bottom = y(acc);
                  acc += v;
                  const gap = j < segs.length - 1 ? 0 : 0;
                  const hgt = Math.max(0, bottom - top - (j > 0 ? 2 : 0));
                  return <rect x={x} y={top + gap} width={w} height={hgt} rx={j === segs.length - 1 ? Math.min(3, w / 2) : 0} fill={color} opacity={hover === null || hover === i ? 1 : 0.45} />;
                })}
                {(i === series.length - 1 || (i % Math.ceil(series.length / 5) === 0 && series.length - 1 - i >= Math.ceil(series.length / 10))) && <text x={pad.l + i * bw + bw / 2} y={H - 6} text-anchor="middle" class="axis">{d.day.slice(5)}</text>}
              </g>
            );
          })}
        </svg>
        {h && (
          <div class="tip" style={`left:${Math.min(80, ((hover! + 0.5) / series.length) * 100)}%`} role="status">
            <strong>{new Date(h.day).toLocaleDateString()}</strong>
            <div>{h.total} choices</div>
            <div><i style="background:var(--series-1)" />Accepted all {h.accept_all}</div>
            <div><i style="background:var(--series-2)" />Rejected all {h.reject_all}</div>
            <div><i style="background:var(--series-3)" />Other {other(h)}</div>
          </div>
        )}
      </div>
      <details><summary>Show as table</summary>
        <div class="table-wrap"><table>
          <thead><tr><th>Day</th><th>Total</th><th>Accepted all</th><th>Rejected all</th><th>Other</th></tr></thead>
          <tbody>{series.filter((d) => d.total).map((d) => <tr><td>{d.day}</td><td>{d.total}</td><td>{d.accept_all}</td><td>{d.reject_all}</td><td>{other(d)}</td></tr>)}</tbody>
        </table></div>
      </details>
    </div>
  );
}

export function StatsView({ orgId, title }: { orgId?: number; title?: string }) {
  const [days, setDays] = useState(30);
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<Stats>('GET', `/stats?days=${days}${orgId ? `&orgId=${orgId}` : ''}`).then(setS).catch((e) => setErr(msg(e)));
  }, [orgId, days]);
  if (err) return <p class="error-text">{err}</p>;
  if (!s) return <p class="muted">Loading…</p>;
  const c = s.totals.consents;
  return (
    <>
      <div class="toolbar">
        {title ? <h2 style="margin:0">{title}</h2> : <span />}
        <div class="seg" role="group" aria-label="Period">
          {[7, 30, 90, 365].map((d) => <button class={d === days ? 'on' : ''} aria-pressed={d === days} onClick={() => setDays(d)}>{d === 365 ? '1 year' : `${d} days`}</button>)}
        </div>
      </div>
      <div class="grid stats">
        {s.scope !== 'client' && <div class="panel"><div class="muted">Clients</div><div class="stat">{s.totals.clients}</div></div>}
        <div class="panel"><div class="muted">Sites</div><div class="stat">{s.totals.sites}</div>{s.totals.sitesWithProblems > 0 && <div><span class="badge error">{s.totals.sitesWithProblems} with problems</span></div>}</div>
        <div class="panel"><div class="muted">Consent choices</div><div class="stat">{c.total.toLocaleString()}</div></div>
        <div class="panel"><div class="muted">Accepted all</div><div class="stat">{pct(c.accept_all, c.total)}</div></div>
        <div class="panel"><div class="muted">Rejected all</div><div class="stat">{pct(c.reject_all, c.total)}</div></div>
        <div class="panel"><div class="muted">{s.scope === 'platform' ? 'Users' : 'Team members'}</div><div class="stat">{s.totals.users}</div></div>
      </div>
      <div class="panel"><ConsentChart series={s.series} /></div>
      {s.scope !== 'client' && s.orgs.length > 0 && (
        <div class="panel table-wrap">
          <table>
            <thead><tr><th>Client</th><th>Sites</th><th>People</th><th>Choices</th><th>Accepted all</th><th>Rejected all</th><th>Problems</th></tr></thead>
            <tbody>
              {s.orgs.map((o) => (
                <tr key={o.id}>
                  <td><a href={`#/clients/${o.id}`}>{o.name}</a></td>
                  <td>{o.sites}</td><td>{o.members}</td><td>{o.consents.total.toLocaleString()}</td>
                  <td>{pct(o.consents.accept_all, o.consents.total)}</td><td>{pct(o.consents.reject_all, o.consents.total)}</td>
                  <td>{o.problems ? <span class="badge error">{o.problems}</span> : <span class="badge ok">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.sites.length > 0 && (
        <div class="panel table-wrap">
          <table>
            <thead><tr><th>Site</th><th>Choices</th><th>Accepted all</th><th>Rejected all</th><th>Cookies</th><th>Last scan</th><th>Compliance</th></tr></thead>
            <tbody>
              {s.sites.map((x) => (
                <tr key={x.id}>
                  <td><a href={`#/sites/${x.id}`}>{x.name}</a><div class="muted">{x.domain}</div></td>
                  <td>{x.consents.total.toLocaleString()}</td>
                  <td>{pct(x.consents.accept_all, x.consents.total)}</td><td>{pct(x.consents.reject_all, x.consents.total)}</td>
                  <td>{x.cookies}</td><td>{x.lastScan ? new Date(x.lastScan).toLocaleDateString() : <span class="badge warning">never</span>}</td>
                  <td>{x.problems ? <span class="badge error">{x.problems} problem{x.problems > 1 ? 's' : ''}</span> : x.warnings ? <span class="badge warning">{x.warnings} warning{x.warnings > 1 ? 's' : ''}</span> : <span class="badge ok">OK</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ==================================================================== clients
interface OrgRow { id: number; name: string; require2fa: boolean; role: string | null; memberCount: number; siteCount: number }

export function ClientsPage({ me, cookieDbEntries, onOpen, onChanged }: { me: Me; cookieDbEntries: number; onOpen: (id: number) => void; onChanged: () => void }) {
  const [updating, setUpdating] = useState(false);
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [created, setCreated] = useState<{ link: string; emailed: boolean } | null>(null);
  const load = () => api<OrgRow[]>('GET', '/orgs').then(setOrgs);
  useEffect(() => void load(), []);
  const rows = orgs?.filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div class="pagehead">
        <div>
          <h1>All clients</h1>
          <p class="muted">Each client has its own sites, team and logins, and only sees its own. Pick one to work on it.</p>
        </div>
        <div class="row" style="flex:0 0 auto">
          <button disabled={updating} title={`${cookieDbEntries.toLocaleString()} cookies known`} onClick={() => {
            setUpdating(true);
            api('POST', '/cookie-db/update').then(() => location.reload()).finally(() => setUpdating(false));
          }}>{updating ? 'Updating…' : 'Update cookie database'}</button>
          {!adding && <button class="primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add client</button>}
        </div>
      </div>
      {adding && (
        <div class="panel">
          <h2 style="margin-top:0">Add a client</h2>
          {created ? (
            <InviteResult r={created} onClose={() => { setCreated(null); setAdding(false); }} />
          ) : (
            <form onSubmit={async (e) => {
              e.preventDefault();
              setErr('');
              try {
                const org = await api<{ id: number }>('POST', '/orgs', { name });
                if (ownerEmail) setCreated(await api('POST', `/orgs/${org.id}/invites`, { email: ownerEmail, role: 'owner' }));
                else setAdding(false);
                setName('');
                setOwnerEmail('');
                void load();
                onChanged();
              } catch (x) {
                setErr(msg(x));
              }
            }}>
              <div class="row">
                <Field label="Client name"><input required value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Bakkerij de Vries" /></Field>
                <Field label="Invite an owner (optional)" hint="They get their own login and can invite their team."><input type="email" value={ownerEmail} onInput={(e) => setOwnerEmail(e.currentTarget.value)} placeholder="eigenaar@bakkerij.nl" /></Field>
              </div>
              {err && <p class="error-text" role="alert">{err}</p>}
              <div class="row" style="justify-content:flex-start">
                <button class="primary" type="submit" style="flex:0 0 auto">Add client</button>
                <button type="button" style="flex:0 0 auto" onClick={() => setAdding(false)}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}
      {orgs && orgs.length > 6 && <div class="toolbar"><input style="max-width:320px" placeholder="Find a client" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></div>}
      {rows && rows.length > 0 && (
        <div class="panel flush table-wrap">
          <table class="clickable">
            <thead><tr><th>Client</th><th>Sites</th><th>People</th><th>Security</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} onClick={() => onOpen(o.id)}>
                  <td><a href="#/" onClick={(e) => { e.preventDefault(); onOpen(o.id); }}><strong>{o.name}</strong></a></td>
                  <td>{o.siteCount}</td>
                  <td>{o.memberCount}</td>
                  <td>{o.require2fa ? <span class="badge ok">2FA required</span> : <span class="muted">2FA optional</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {orgs && orgs.length > 0 && <><h2>Consent across all clients</h2><StatsView /></>}
      {orgs?.length === 0 && !adding && (
        <div class="panel empty-state">
          <h2>No clients yet</h2>
          <p>A client is a company you manage sites for. You can also make one for your own sites.</p>
          <button class="primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add client</button>
        </div>
      )}
    </>
  );
}

function InviteResult({ r, onClose }: { r: { link: string; emailed: boolean }; onClose: () => void }) {
  return (
    <div class="notice">
      <p>{r.emailed ? 'Invitation sent by email. You can also share this link:' : 'Email is not set up on this server, so send this link yourself. It works once, for 7 days:'}</p>
      <pre>{r.link}</pre>
      <div class="row" style="justify-content:flex-start">
        <button style="flex:0 0 auto" onClick={() => navigator.clipboard?.writeText(r.link)}>Copy link</button>
        <button style="flex:0 0 auto" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

interface OrgDetail {
  org: { id: number; name: string; require2fa: boolean };
  role: string;
  members: { id: number; email: string; name: string; avatarUrl?: string | null; role: string; has2fa: boolean; lastLoginAt: string | null; disabled: boolean }[];
  invites: { id: string; email: string; role: string; expiresAt: string }[];
  sites: { id: number; name: string; domain: string }[];
}

const SECTION: Record<string, [string, string]> = {
  team: ['Team', 'People with access to this client. Owners manage the team; editors change sites; viewers only look.'],
  activity: ['Activity', 'Logins and changes by this client\'s team. Kept for 2 years.'],
  settings: ['Client settings', 'Name and security rules for everyone in this client.'],
};

/** One part of the current client, picked from the sidebar. */
export function ClientSection({ orgId, section, me, onChanged }: { orgId: number; section: 'team' | 'activity' | 'settings'; me: Me; onChanged: () => void }) {
  const [d, setD] = useState<OrgDetail | null>(null);
  const [err, setErr] = useState('');
  const load = () => api<OrgDetail>('GET', `/orgs/${orgId}`).then(setD).catch((e) => setErr(msg(e)));
  useEffect(() => void load(), [orgId]);
  if (err) return <p class="error-text">{err}</p>;
  if (!d) return <p class="muted">Loading…</p>;
  const owner = d.role === 'owner';
  const [title, help] = SECTION[section]!;
  return (
    <>
      <div class="pagehead"><div><h1>{title}</h1><p class="muted">{d.org.name} · {help}</p></div></div>
      {section === 'team' && <Team d={d} me={me} reload={() => { void load(); onChanged(); }} />}
      {section === 'activity' && owner && <AuditView orgId={orgId} />}
      {section === 'settings' && owner && <ClientSettings d={d} me={me} reload={() => { void load(); onChanged(); }} />}
      {section !== 'team' && !owner && <p class="muted">Only owners of {d.org.name} can see this.</p>}
    </>
  );
}

export function AddSite({ orgId }: { orgId: number }) {
  const [form, setForm] = useState({ name: '', domain: '' });
  const [err, setErr] = useState('');
  return (
    <div class="panel">
      <h2 style="margin-top:0">Add a site</h2>
      <form onSubmit={(e) => {
        e.preventDefault();
        setErr('');
        api<{ id: number }>('POST', '/sites', { ...form, orgId, rulePack: 'nl-ap', defaultLocale: 'nl', locales: ['nl', 'en'] })
          .then((s) => (location.hash = `#/sites/${s.id}/settings`))
          .catch((x) => setErr(msg(x)));
      }}>
        <div class="row">
          <Field label="Name"><input required value={form.name} onInput={(e) => setForm({ ...form, name: e.currentTarget.value })} placeholder="Webshop" /></Field>
          <Field label="Domain"><input required value={form.domain} onInput={(e) => setForm({ ...form, domain: e.currentTarget.value })} placeholder="example.nl" /></Field>
          <button class="primary" type="submit" style="flex:0 0 auto;align-self:flex-end;margin-bottom:12px">Add site</button>
        </div>
        {err && <p class="error-text" role="alert">{err}</p>}
        <p class="muted" style="margin:0">A first cookie scan starts right away. You choose the country rules, languages and look on the next page.</p>
      </form>
    </div>
  );
}

function Team({ d, me, reload }: { d: OrgDetail; me: Me; reload: () => void }) {
  const owner = d.role === 'owner';
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ link: string; emailed: boolean } | null>(null);
  const act = (p: Promise<unknown>) => p.then(reload).catch((e) => setErr(msg(e)));
  return (
    <>
      {err && <p class="error-text" role="alert">{err}</p>}
      <div class="panel flush table-wrap">
        <table>
          <thead><tr><th>Person</th><th>Role</th><th>2FA</th><th>Last login</th><th></th></tr></thead>
          <tbody>
            {d.members.map((m) => (
              <tr key={m.id}>
                <td><div class="person"><Avatar name={m.name} email={m.email} url={m.avatarUrl} size="sm" /><div><strong>{m.name || m.email}</strong>{m.id === me.user.id && <span class="muted"> (you)</span>}<div class="muted">{m.email}</div>{m.disabled && <span class="badge error">disabled</span>}</div></div></td>
                <td>{owner ? (
                  <select aria-label={`Role of ${m.email}`} value={m.role} onChange={(e) => act(api('PUT', `/orgs/${d.org.id}/members/${m.id}`, { role: e.currentTarget.value }))}>
                    {['owner', 'editor', 'viewer'].map((r) => <option value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                ) : ROLE_LABEL[m.role]}</td>
                <td>{m.has2fa ? <span class="badge ok">on</span> : <span class={`badge ${d.org.require2fa ? 'error' : 'warning'}`}>off</span>}</td>
                <td>{fmtDate(m.lastLoginAt)}</td>
                <td>{(owner || m.id === me.user.id) && (
                  <button class="danger" onClick={() => confirm(m.id === me.user.id ? `Leave ${d.org.name}?` : `Remove ${m.email} from ${d.org.name}?`) && act(api('DELETE', `/orgs/${d.org.id}/members/${m.id}`).then(() => { if (m.id === me.user.id) location.hash = '#/'; }))}>
                    {m.id === me.user.id ? 'Leave' : 'Remove'}
                  </button>
                )}</td>
              </tr>
            ))}
            {d.members.length === 0 && <tr><td colSpan={5} class="muted">Nobody yet. Invite the client's owner below.</td></tr>}
          </tbody>
        </table>
      </div>
      {owner && d.invites.length > 0 && (
        <div class="panel">
          <h2 style="margin-top:0">Open invitations</h2>
          <ul class="plain">
            {d.invites.map((i) => (
              <li class="row" key={i.id}>
                <span>{i.email} · {ROLE_LABEL[i.role]} · expires {fmtDate(i.expiresAt)}</span>
                <button style="flex:0 0 auto" onClick={() => act(api('DELETE', `/orgs/${d.org.id}/invites/${i.id}`))}>Revoke</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {owner && (
        <div class="panel">
          <h2 style="margin-top:0">Invite someone</h2>
          {result ? <InviteResult r={result} onClose={() => { setResult(null); reload(); }} /> : (
            <form onSubmit={(e) => {
              e.preventDefault();
              setErr('');
              api<{ link: string; emailed: boolean }>('POST', `/orgs/${d.org.id}/invites`, { email, role }).then((r) => { setResult(r); setEmail(''); }).catch((x) => setErr(msg(x)));
            }}>
              <div class="row">
                <Field label="Email"><input type="email" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} /></Field>
                <Field label="Role" hint={ROLE_HELP[role]}>
                  <select value={role} onChange={(e) => setRole(e.currentTarget.value)}>{['owner', 'editor', 'viewer'].map((r) => <option value={r}>{ROLE_LABEL[r]}</option>)}</select>
                </Field>
              </div>
              <button class="primary" type="submit">Send invitation</button>
            </form>
          )}
        </div>
      )}
    </>
  );
}

function ClientSettings({ d, me, reload }: { d: OrgDetail; me: Me; reload: () => void }) {
  const [name, setName] = useState(d.org.name);
  const [req2fa, setReq2fa] = useState(d.org.require2fa);
  const [status, setStatus] = useState('');
  return (
    <>
      <form class="panel" onSubmit={(e) => {
        e.preventDefault();
        api('PUT', `/orgs/${d.org.id}`, { name, require2fa: req2fa }).then(() => { setStatus('Saved.'); reload(); }).catch((x) => setStatus(msg(x)));
      }}>
        <Field label="Client name"><input required value={name} onInput={(e) => setName(e.currentTarget.value)} /></Field>
        <label class="check"><input type="checkbox" checked={req2fa} onChange={() => setReq2fa(!req2fa)} />
          <span><strong>Require two-step verification</strong> for everyone in this client. People without a passkey or authenticator app must set one up at their next login.</span></label>
        <div class="row" style="justify-content:flex-start"><button class="primary" type="submit" style="flex:0 0 auto">Save</button><span role="status">{status}</span></div>
      </form>
      {me.user.isPlatformAdmin && (
        <div class="panel">
          <h2 style="margin-top:0">Delete client</h2>
          <p>Deletes {d.org.name}, its {d.sites.length} site{d.sites.length === 1 ? '' : 's'} and all their consent records. People keep their accounts. This cannot be undone.</p>
          <button class="danger" onClick={() => prompt(`Type the client name to confirm: ${d.org.name}`) === d.org.name && api('DELETE', `/orgs/${d.org.id}`).then(() => (location.hash = '#/clients'))}>Delete client</button>
        </div>
      )}
    </>
  );
}

// ====================================================================== users
interface UserRow {
  id: number; email: string; name: string; avatarUrl?: string | null; isPlatformAdmin: boolean; disabled: boolean; createdAt: string; lastLoginAt: string | null;
  totpEnabled: boolean; passkeys: number; memberships: { orgId: number; orgName: string; role: string }[];
}

export function UsersPage({ me }: { me: Me }) {
  const [data, setData] = useState<{ users: UserRow[]; invites: { id: string; email: string; expiresAt: string }[] } | null>(null);
  const [err, setErr] = useState('');
  const [link, setLink] = useState<{ title: string; link: string; emailed: boolean } | null>(null);
  const [email, setEmail] = useState('');
  const [q, setQ] = useState('');
  const load = () => api<typeof data>('GET', '/users').then(setData);
  useEffect(() => void load(), []);
  const act = (p: Promise<unknown>) => p.then(load).catch((e) => setErr(msg(e)));
  const rows = data?.users.filter((u) => !q || `${u.email} ${u.name} ${u.memberships.map((m) => m.orgName).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div class="pagehead"><div><h1>Users</h1><p class="muted">Everyone with an account, across all clients. Platform admins manage every client.</p></div></div>
      {err && <p class="error-text" role="alert">{err}</p>}
      {link && <div class="panel"><h2 style="margin-top:0">{link.title}</h2><InviteResult r={link} onClose={() => setLink(null)} /></div>}
      <div class="toolbar"><input style="max-width:320px" placeholder="Search by name, email or client" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></div>
      <div class="panel flush table-wrap">
        <table>
          <thead><tr><th>Person</th><th>Clients</th><th>2FA</th><th>Last login</th><th></th></tr></thead>
          <tbody>
            {rows?.map((u) => (
              <tr key={u.id}>
                <td><div class="person"><Avatar name={u.name} email={u.email} url={u.avatarUrl} size="sm" /><div><strong>{u.name || u.email}</strong><div class="muted">{u.email}</div>
                  {u.isPlatformAdmin && <span class="badge info">Platform admin</span>} {u.disabled && <span class="badge error">disabled</span>}</div></div></td>
                <td>{u.memberships.map((m) => <div><a href={`#/clients/${m.orgId}`}>{m.orgName}</a> <span class="muted">{ROLE_LABEL[m.role]?.toLowerCase()}</span></div>)}</td>
                <td>{u.passkeys > 0 && <span class="badge ok">{u.passkeys} passkey{u.passkeys > 1 ? 's' : ''}</span>} {u.totpEnabled && <span class="badge ok">app</span>} {!u.passkeys && !u.totpEnabled && <span class="badge warning">off</span>}</td>
                <td>{fmtDate(u.lastLoginAt)}</td>
                <td>
                  {u.id !== me.user.id && (
                    <details class="menu">
                      <summary>Manage</summary>
                      <div>
                        <button onClick={() => act(api<{ link: string; emailed: boolean }>('POST', `/users/${u.id}/reset-link`).then((r) => setLink({ title: `Password reset link for ${u.email}`, ...r })))}>Password reset link</button>
                        {(u.totpEnabled || u.passkeys > 0) && <button onClick={() => confirm(`Remove all 2FA methods of ${u.email}? Only do this after checking who is asking, e.g. by phone.`) && act(api('DELETE', `/users/${u.id}/mfa`))}>Reset 2FA</button>}
                        <button onClick={() => act(api('PUT', `/users/${u.id}`, { isPlatformAdmin: !u.isPlatformAdmin }))}>{u.isPlatformAdmin ? 'Remove platform admin' : 'Make platform admin'}</button>
                        <button onClick={() => act(api('PUT', `/users/${u.id}`, { disabled: !u.disabled }))}>{u.disabled ? 'Enable account' : 'Disable account'}</button>
                        <button class="danger" onClick={() => confirm(`Delete the account of ${u.email}? This cannot be undone.`) && act(api('DELETE', `/users/${u.id}`))}>Delete account</button>
                      </div>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div class="panel">
        <h2 style="margin-top:0">Invite a platform admin</h2>
        <p class="muted">Platform admins see and manage every client, user and site. To give a client access, invite them from the client's Team tab instead.</p>
        {data && data.invites.length > 0 && (
          <ul class="plain">{data.invites.map((i) => <li class="row" key={i.id}><span>{i.email} · expires {fmtDate(i.expiresAt)}</span><button style="flex:0 0 auto" onClick={() => act(api('DELETE', `/users/invites/${i.id}`))}>Revoke</button></li>)}</ul>
        )}
        <form class="row" onSubmit={(e) => {
          e.preventDefault();
          act(api<{ link: string; emailed: boolean }>('POST', '/users/invite-admin', { email }).then((r) => { setLink({ title: `Invitation for ${email}`, ...r }); setEmail(''); }));
        }}>
          <input type="email" required placeholder="colleague@agency.nl" value={email} onInput={(e) => setEmail(e.currentTarget.value)} style="max-width:320px" />
          <button class="primary" type="submit" style="flex:0 0 auto">Invite</button>
        </form>
      </div>
    </>
  );
}

// ================================================================= audit log
const ACTION_LABEL: Record<string, string> = {
  login: 'Logged in', login_failed: 'Failed login', logout: 'Logged out', account_created: 'Account created',
  '2fa_totp_enabled': 'Authenticator app turned on', '2fa_totp_disabled': 'Authenticator app turned off', '2fa_reset_by_admin': '2FA reset by admin',
  passkey_added: 'Passkey added', passkey_removed: 'Passkey removed', recovery_codes_regenerated: 'New recovery codes',
  password_changed: 'Password changed', password_reset: 'Password reset', password_reset_requested: 'Password reset requested', password_reset_link_created: 'Reset link created',
  token_created: 'Access token created', token_revoked: 'Access token deleted',
  session_revoked: 'Session signed out', sessions_revoked: 'Other sessions signed out',
  org_created: 'Client created', org_updated: 'Client settings changed', org_deleted: 'Client deleted',
  invite_created: 'Invitation sent', invite_accepted: 'Invitation accepted', invite_revoked: 'Invitation revoked',
  member_role_changed: 'Role changed', member_removed: 'Member removed', user_updated: 'User changed', user_deleted: 'User deleted',
  site_created: 'Site added', site_updated: 'Site settings changed', site_deleted: 'Site deleted',
  cookie_added: 'Cookie added', cookie_updated: 'Cookie changed', cookie_deleted: 'Cookie removed', consents_exported: 'Consent log exported',
};

export function AuditView({ orgId }: { orgId?: number }) {
  const [data, setData] = useState<{ total: number; rows: { id: number; createdAt: string; userEmail: string; action: string; detail: string; ip: string; siteId: number | null }[] } | null>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    api<typeof data>('GET', `/audit?offset=${offset}${orgId ? `&orgId=${orgId}` : ''}`).then(setData);
  }, [orgId, offset]);
  return (
    <>
      <div class="panel flush table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Who</th><th>What</th><th>Details</th><th>IP address</th></tr></thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.createdAt)}</td>
                <td>{r.userEmail || '—'}</td>
                <td>{r.action === 'login_failed' ? <span class="badge warning">{ACTION_LABEL[r.action]}</span> : ACTION_LABEL[r.action] ?? r.action}{r.siteId && <> · <a href={`#/sites/${r.siteId}`}>site</a></>}</td>
                <td class="muted">{r.detail}</td>
                <td class="muted">{r.ip}</td>
              </tr>
            ))}
            {data?.rows.length === 0 && <tr><td colSpan={5} class="muted">Nothing yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {data && data.total > 50 && (
        <div class="row" style="justify-content:flex-start">
          <button style="flex:0 0 auto" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Newer</button>
          <span class="muted" style="flex:0 0 auto">{offset + 1}–{Math.min(offset + 50, data.total)} of {data.total}</span>
          <button style="flex:0 0 auto" disabled={offset + 50 >= data.total} onClick={() => setOffset(offset + 50)}>Older</button>
        </div>
      )}
    </>
  );
}
