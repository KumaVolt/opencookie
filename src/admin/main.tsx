import { render } from 'preact';
import { useEffect, useState, useCallback } from 'preact/hooks';
import type { Category } from '../core/categories.ts';
import type { ComplianceIssue } from '../core/compliance.ts';
import type { RulePack } from '../core/rulepacks.ts';
import type { BannerTexts } from '../core/templates/types.ts';
import type { ConsentRecord, ScanSummary, Site, SiteCookie } from '../core/types.ts';
import { api } from './api.ts';
import { AcceptInvite, AccountPage, Field, Login, MfaStep, ResetPassword, Setup, type Me } from './auth.tsx';
import { AddSite, AuditView, ClientSection, ClientsPage, StatsView, UsersPage } from './manage.tsx';
import { Avatar, Icon, Mark, Switcher, type ScopeOrg } from './shell.tsx';
import { SetupWizard, wizardDismissed } from './wizard.tsx';

interface Meta {
  publicUrl: string;
  appName: string;
  rulePacks: RulePack[];
  locales: { code: string; name: string }[];
  categories: Category[];
  templates: Record<string, BannerTexts>;
  cookieDb: { entries: number };
  translations: Record<string, number>;
}
type Role = 'owner' | 'editor' | 'viewer';
type SiteRow = Site & { latestScan: ScanSummary | null; cookieCount: number; orgName: string; yourRole: Role };
type SiteFull = Site & { yourRole: Role; orgName: string };
type CookieRow = SiteCookie & { translations: Record<string, string | null> };

// ------------------------------------------------------------------- router
function useHash() {
  const [hash, setHash] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

type AuthState = { setupNeeded: boolean; mail: boolean; appName: string; stage: 'mfa' | 'full' | null; mfa: { totp: boolean; passkey: boolean; recovery: boolean } | null };
type OrgRow = ScopeOrg & { require2fa: boolean; memberCount: number; siteCount: number };
type Scope = number | 'all';

const SCOPE_KEY = 'oc-admin-scope';
const readScope = (): Scope | null => {
  try {
    const v = localStorage.getItem(SCOPE_KEY);
    return v && v !== 'all' ? Number(v) : null;
  } catch {
    return null;
  }
};
const writeScope = (v: Scope) => {
  try {
    localStorage.setItem(SCOPE_KEY, String(v));
  } catch {}
};

function App() {
  const [state, setState] = useState<AuthState | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [scope, setScopeState] = useState<Scope | null>(null);
  const [mfa, setMfa] = useState<AuthState['mfa']>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [orgsLoaded, setOrgsLoaded] = useState(false);
  const hash = useHash();

  const loadOrgs = useCallback(async (m: Me) => {
    const list = await api<OrgRow[]>('GET', '/orgs');
    setOrgs(list);
    setOrgsLoaded(true);
    const saved = readScope();
    setScopeState(saved !== null && list.some((o) => o.id === saved) ? saved : list[0]?.id ?? null);
  }, []);

  const boot = useCallback(async () => {
    const st = await api<AuthState>('GET', '/auth/state');
    setState(st);
    setMfa(st.stage === 'mfa' ? st.mfa : null);
    if (st.stage !== 'full') return setMe(null);
    try {
      const m = await api<Me>('GET', '/me');
      setMe(m);
      if (!m.mustEnroll2fa) {
        setMeta(await api<Meta>('GET', '/meta'));
        await loadOrgs(m);
      }
    } catch {
      setMe(null);
    }
  }, [loadOrgs]);
  const reloadMe = useCallback(async () => {
    const m = await api<Me>('GET', '/me');
    setMe(m);
    if (!m.mustEnroll2fa && !meta) {
      setMeta(await api<Meta>('GET', '/meta'));
      await loadOrgs(m);
    }
  }, [meta, loadOrgs]);

  useEffect(() => {
    void boot();
    const out = () => { setMe(null); void boot(); };
    const enrol = () => void reloadMe();
    window.addEventListener('oc-logout', out);
    window.addEventListener('oc-enrol', enrol);
    return () => { window.removeEventListener('oc-logout', out); window.removeEventListener('oc-enrol', enrol); };
  }, [boot]);
  useEffect(() => setNavOpen(false), [hash]);

  const setScope = (v: Scope) => {
    setScopeState(v);
    writeScope(v);
  };
  // Old-style links to a client page switch the scope instead.
  useEffect(() => {
    const m = hash.match(/^\/clients\/(\d+)/);
    if (m && orgs.some((o) => o.id === Number(m[1]))) {
      setScope(Number(m[1]));
      location.hash = '#/';
    }
  }, [hash, orgs]);

  // A fresh install (or a new client owner) with no sites starts in the setup wizard, once.
  useEffect(() => {
    if (!me || !orgsLoaded || me.mustEnroll2fa || wizardDismissed()) return;
    const canAdd = me.user.isPlatformAdmin || orgs.some((o) => o.role === 'owner');
    const noSites = orgs.reduce((n, o) => n + o.siteCount, 0) === 0;
    if (canAdd && noSites && (location.hash === '' || location.hash === '#/')) location.hash = '#/welcome';
  }, [me, orgsLoaded]);

  if (!state) return <main><p class="muted">Loading…</p></main>;
  const invite = hash.match(/^\/invite\/([\w-]+)/);
  const reset = hash.match(/^\/reset\/([\w-]+)/);
  if (reset) return <ResetPassword token={reset[1]!} />;
  if (invite && !me) return <AcceptInvite token={invite[1]!} onDone={boot} onMfa={setMfa} />;
  if (state.setupNeeded) return <Setup onDone={boot} />;
  if (mfa) return <MfaStep methods={mfa} onDone={() => { setMfa(null); void boot(); }} onCancel={() => { setMfa(null); void boot(); }} />;
  if (!me) return <Login mail={state.mail} onDone={boot} onMfa={setMfa} />;

  const logout = () => api('POST', '/auth/logout', {}).finally(() => { setMe(null); setMeta(null); void boot(); });
  const platform = me.user.isPlatformAdmin;
  const org = typeof scope === 'number' ? orgs.find((o) => o.id === scope) ?? null : null;
  const orgRole = org ? (platform ? 'owner' : org.role) : null;
  const path = hash.split('?')[0]!;
  const site = path.match(/^\/sites\/(\d+)(?:\/(\w+))?/);

  const nav: [string, string, string][] = me.mustEnroll2fa ? [] : [
    ...(org ? [['/', 'Overview', 'dashboard'], ['/sites', 'Sites', 'sites'], ['/team', 'Team', 'team']] as [string, string, string][] : []),
    ...(org && orgRole === 'owner' ? [['/client-activity', 'Activity', 'activity'], ['/client-settings', 'Settings', 'settings']] as [string, string, string][] : []),
  ];
  const platformNav: [string, string, string][] = platform && !me.mustEnroll2fa ? [['/clients', 'All clients', 'clients'], ['/users', 'Users', 'users'], ['/activity', 'Activity log', 'activity']] : [];
  const isActive = (href: string) => (href === '/' ? path === '/' : path === href || (href === '/sites' && !!site));

  const canAddSites = platform || orgs.some((o) => o.role === 'owner');
  let page;
  if (path === '/welcome' && meta && canAddSites && !me.mustEnroll2fa) {
    return (
      <div class="wizard-shell">
        <SetupWizard me={me} meta={meta} orgs={orgs} preferOrg={typeof scope === 'number' ? scope : null} onDone={(orgId, siteId) => {
          void loadOrgs(me).then(() => { setScope(orgId); location.hash = siteId ? `#/sites/${siteId}` : '#/'; });
        }} />
      </div>
    );
  }
  if (me.mustEnroll2fa || path.startsWith('/account')) page = <AccountPage me={me} reload={reloadMe} tab={path.split('/')[2] ?? 'security'} />;
  else if (!meta) page = <p class="muted">Loading…</p>;
  else if (site) page = <SitePage id={Number(site[1])} tab={site[2] ?? 'overview'} meta={meta} onScope={(id) => { if (id && id !== scope) setScope(id); }} />;
  else if (path === '/sites') page = <SitesPage meta={meta} me={me} scope={scope} org={org} orgRole={orgRole} />;
  else if (path === '/team' && org) page = <ClientSection orgId={org.id} section="team" me={me} onChanged={() => loadOrgs(me)} />;
  else if (path === '/client-activity' && org) page = <ClientSection orgId={org.id} section="activity" me={me} onChanged={() => loadOrgs(me)} />;
  else if (path === '/client-settings' && org) page = <ClientSection orgId={org.id} section="settings" me={me} onChanged={() => loadOrgs(me)} />;
  else if (path === '/clients' && platform) page = <ClientsPage me={me} cookieDbEntries={meta.cookieDb.entries} onOpen={(id) => { setScope(id); location.hash = '#/'; }} onChanged={() => loadOrgs(me)} />;
  else if (path === '/users' && platform) page = <UsersPage me={me} />;
  else if (path === '/activity' && platform) page = <><div class="pagehead"><div><h1>Activity log</h1><p class="muted">Logins, security changes and site changes across all clients. Kept for 2 years.</p></div></div><AuditView /></>;
  else if (scope === null) page = <div class="panel empty-state"><h1>Welcome</h1><p>{platform ? 'Set up your first client and site. It takes about two minutes.' : 'You are not part of any client yet. Ask the person who invited you to check your invitation.'}</p>{platform && <a class="btn primary" href="#/welcome">Start setup</a>}</div>;
  else page = <><div class="pagehead"><div><h1>{org?.name}</h1><p class="muted">Consent choices and compliance for this client's sites.</p></div></div><StatsView key={String(scope)} orgId={org?.id} /></>;

  return (
    <div class="shell">
      <aside class="sidebar" data-open={navOpen} aria-label="Main">
        <a href="#/" class="brand"><Mark /> {meta?.appName ?? state.appName}</a>
        {!me.mustEnroll2fa && (orgs.length > 0 || platform) && <div class="group">Client</div>}
        {!me.mustEnroll2fa && (orgs.length > 0 || platform) && (
          <Switcher
            orgs={orgs}
            current={scope}
            allowAll={false}
            onSelect={(v) => { setScope(v); if (path.startsWith('/team') || path.startsWith('/client-') || site) location.hash = '#/'; }}
            footer={platform && <a href="#/clients"><Icon name="clients" size={16} /> Manage all clients</a>}
          />
        )}
        <nav class="sidenav">
          {nav.map(([href, label, icon]) => <a href={`#${href}`} class={isActive(href) ? 'active' : ''} aria-current={isActive(href) ? 'page' : undefined}><Icon name={icon} /> {label}</a>)}
          {platformNav.length > 0 && <div class="group admin">Admin <span>· clients don&apos;t see this</span></div>}
          {platformNav.map(([href, label, icon]) => <a href={`#${href}`} class={isActive(href) ? 'active' : ''} aria-current={isActive(href) ? 'page' : undefined}><Icon name={icon} /> {label}</a>)}
        </nav>
        <div class="grow" />
        <div class="me">
          <a href="#/account" class={`me-card ${path.startsWith('/account') ? 'active' : ''}`}>
            <Avatar name={me.user.name} email={me.user.email} url={me.user.avatarUrl} />
            <span class="who"><strong>{me.user.name || me.user.email}</strong><span>{me.user.email}</span></span>
          </a>
          <button class="link" onClick={logout}><Icon name="logout" /> Log out</button>
        </div>
      </aside>
      {navOpen && <div class="scrim" onClick={() => setNavOpen(false)} />}
      <div class="content">
        <div class="mobilebar">
          <button aria-label="Open menu" aria-expanded={navOpen} onClick={() => setNavOpen(true)}><Icon name="menu" size={22} /></button>
          <Mark size={20} /> <strong>{org?.name ?? meta?.appName ?? state.appName}</strong>
        </div>
        <main>{page}</main>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- sites
function SitesPage({ meta, me, scope, org, orgRole }: { meta: Meta; me: Me; scope: Scope | null; org: OrgRow | null; orgRole: string | null }) {
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => void api<SiteRow[]>('GET', '/sites').then(setSites), []);
  const shown = sites?.filter((s) => (scope === 'all' || s.orgId === scope) && (!q || `${s.name} ${s.domain} ${s.orgName}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div class="pagehead">
        <div>
          <h1>Sites</h1>
          <p class="muted">Sites of {org?.name}. Each site has its own banner, cookie list and consent log.</p>
        </div>
        <div class="row" style="flex:0 0 auto">

          {org && orgRole === 'owner' && <button class="primary" onClick={() => setAdding(!adding)}><Icon name="plus" size={16} /> Add site</button>}
        </div>
      </div>
      {adding && org && <AddSite orgId={org.id} />}
      {sites && sites.length > 3 && <div class="toolbar"><input placeholder="Find a site" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></div>}
      {shown && shown.length > 0 && (
        <div class="panel flush table-wrap">
          <table>
            <thead><tr><th>Site</th>{scope === 'all' && <th>Client</th>}<th>Rules</th><th>Cookies</th><th>Last scan</th><th></th></tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td><a href={`#/sites/${s.id}`}><strong>{s.name}</strong></a><div class="muted">{s.domain}</div></td>
                  {scope === 'all' && <td>{s.orgName}</td>}
                  <td>{meta.rulePacks.find((p) => p.id === s.rulePack)?.name.split(' — ')[0] ?? s.rulePack}</td>
                  <td>{s.cookieCount}</td>
                  <td>{s.latestScan?.finishedAt ? new Date(s.latestScan.finishedAt).toLocaleDateString() : <span class="badge warning">Not scanned</span>}</td>
                  <td>{s.yourRole === 'viewer' && <span class="badge">Read only</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown?.length === 0 && (
        <div class="panel empty-state">
          <h2>{q ? 'No sites match' : 'No sites yet'}</h2>
          <p>{q ? 'Try another name or domain.' : org && orgRole === 'owner' ? 'Add a site, then paste one line into its pages. The scanner finds its cookies for you.' : 'Sites added to this client will show here.'}</p>
          {!q && org && orgRole === 'owner' && !adding && <div class="row" style="justify-content:center"><a class="btn primary" href="#/welcome">Guided setup</a><button onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Quick add</button></div>}
        </div>
      )}
    </>
  );
}

// --------------------------------------------------------------- site page
const TABS = [
  ['overview', 'Overview'],
  ['cookies', 'Cookies'],
  ['scans', 'Scans'],
  ['settings', 'Settings'],
  ['texts', 'Texts'],
  ['consents', 'Consent log'],
] as const;

function SitePage({ id, tab, meta, onScope }: { id: number; tab: string; meta: Meta; onScope: (orgId: number | null) => void }) {
  const [site, setSite] = useState<SiteFull | null>(null);
  const reload = () => api<SiteFull>('GET', `/sites/${id}`).then((x) => { setSite(x); onScope(x.orgId); });
  useEffect(() => void reload(), [id]);
  if (!site) return <p class="muted">Loading…</p>;
  return (
    <>
      <a class="crumb" href="#/sites">← Sites{site.orgName ? ` · ${site.orgName}` : ''}</a>
      <div class="pagehead"><div>
        <h1>{site.name}</h1>
        <p class="muted">{site.domain} · {meta.rulePacks.find((p) => p.id === site.rulePack)?.name.split(' — ')[0]} · policy version {site.policyVersion} {site.yourRole === 'viewer' && <span class="badge">Read only</span>}</p>
      </div></div>
      <nav class="tabs" aria-label="Site sections">
        {TABS.map(([k, label]) => <a href={`#/sites/${id}/${k}`} class={tab === k ? 'active' : ''} aria-current={tab === k ? 'page' : undefined}>{label}</a>)}
      </nav>
      {tab === 'overview' && <Overview site={site} />}
      {tab === 'cookies' && <Cookies site={site} meta={meta} />}
      {tab === 'scans' && <Scans site={site} />}
      {tab === 'settings' && <fieldset class="bare" disabled={site.yourRole === 'viewer'}><Settings site={site} meta={meta} onSaved={(x) => setSite(x as SiteFull)} canDelete={site.yourRole === 'owner'} /></fieldset>}
      {tab === 'texts' && <fieldset class="bare" disabled={site.yourRole === 'viewer'}><Texts site={site} meta={meta} onSaved={(x) => setSite(x as SiteFull)} /></fieldset>}
      {tab === 'consents' && <Consents site={site} />}
    </>
  );
}

function Overview({ site }: { site: Site }) {
  const [c, setC] = useState<{ rulePack: RulePack; issues: ComplianceIssue[] } | null>(null);
  const [embed, setEmbed] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    api<typeof c>('GET', `/sites/${site.id}/compliance`).then(setC);
    api<Record<string, string>>('GET', `/sites/${site.id}/embed`).then(setEmbed);
  }, [site.id, site.policyVersion]);
  const errors = c?.issues.filter((i) => i.severity === 'error').length ?? 0;
  return (
    <>
      <h2>Compliance check</h2>
      {c && (
        <p>
          {errors ? <span class="badge error">{errors} problem{errors > 1 ? 's' : ''}</span> : <span class="badge ok">No blocking problems</span>}{' '}
          <span class="muted">against {c.rulePack.name}. The banner itself always shows Reject next to Accept with equal styling, has no pre-ticked boxes, no cookie wall and a permanent withdraw button.</span>
        </p>
      )}
      {c?.issues.map((i) => (
        <div class={`issue ${i.severity}`}>
          <span class={`badge ${i.severity}`}>{i.severity}</span> <strong>{i.code}</strong>
          <div>{i.message}</div>
          {i.items && <ul>{i.items.slice(0, 25).map((x) => <li>{x}</li>)}{i.items.length > 25 && <li>…and {i.items.length - 25} more</li>}</ul>}
        </div>
      ))}
      {c && (
        <details class="panel">
          <summary>Sources for this rule pack</summary>
          <ul>{c.rulePack.sources.map((s) => <li><a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></li>)}</ul>
          <p class="muted">These rules are a starting point, not legal advice.</p>
        </details>
      )}
      <h2>Install</h2>
      {embed && (
        <div class="panel">
          <p>1. Paste this as the <strong>first</strong> element in the <code>&lt;head&gt;</code> of every page (no <code>async</code>/<code>defer</code>, so it can block trackers):</p>
          <pre>{embed.head}</pre>
          <p>2. On your cookie policy page, this fills in the whole policy, always up to date and in the visitor's language. It uses your site's own fonts and colours:</p>
          <pre>{embed.policy}</pre>
          <p class="muted">Only want the cookie table? Use <code>{embed.declaration}</code>. Or link to the hosted page: <a href={embed.policyUrl} target="_blank" rel="noreferrer">{embed.policyUrl}</a></p>
          <p>3. A link that opens the cookie settings, for your footer. Needed on every page if you turn off the cookie button under Appearance:</p>
          <pre>{embed.settingsLink}</pre>
          <p>4. Scripts the auto-blocker does not know can be blocked by hand:</p>
          <pre>{embed.manualBlocking}</pre>
        </div>
      )}
    </>
  );
}

function Cookies({ site, meta }: { site: Site; meta: Meta }) {
  const [rows, setRows] = useState<CookieRow[] | null>(null);
  const [editing, setEditing] = useState<CookieRow | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () => api<CookieRow[]>('GET', `/sites/${site.id}/cookies`).then(setRows);
  useEffect(() => void load(), [site.id]);
  const otherLocales = site.locales.filter((l) => l !== 'en');
  return (
    <>
      <div class="toolbar">
        <p class="muted" style="margin:0">Cookies found by scans or added by hand. Unknown cookies count as marketing until you review them.</p>
        <button onClick={() => setAdding(true)}>Add cookie</button>
      </div>
      {adding && <CookieForm site={site} meta={meta} onClose={() => { setAdding(false); void load(); }} />}
      {editing && <CookieForm site={site} meta={meta} cookie={editing} onClose={() => { setEditing(null); void load(); }} />}
      <div class="panel table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Category</th><th>Provider</th><th>Description</th><th>Expiry</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows?.map((c) => (
              <tr key={c.id}>
                <td><code>{c.name}</code>{c.kind !== 'cookie' && <div class="muted">{c.kind}</div>}<div class="muted">{c.domain}</div></td>
                <td>{c.category}</td>
                <td>{c.provider}</td>
                <td>{c.description || <em class="muted">No description</em>}
                  {otherLocales.map((l) => (
                    <div class="muted">{l}: {c.translations[l] ?? <span class="badge warning">missing</span>}</div>
                  ))}
                </td>
                <td>{c.retention}</td>
                <td>
                  {c.setBeforeConsent && c.category !== 'necessary' && <div><span class="badge error">before consent</span></div>}
                  {c.ocdId ? <span class="badge ok">in database</span> : c.reviewed ? <span class="badge ok">reviewed</span> : <span class="badge warning">unknown</span>}
                </td>
                <td><button onClick={() => setEditing(c)}>Edit</button></td>
              </tr>
            ))}
            {rows?.length === 0 && <tr><td colSpan={7} class="muted">No cookies yet. Run a scan.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CookieForm({ site, meta, cookie, onClose }: { site: Site; meta: Meta; cookie?: CookieRow; onClose: () => void }) {
  const [f, setF] = useState({
    name: cookie?.name ?? '',
    domain: cookie?.domain ?? site.domain,
    kind: cookie?.kind ?? 'cookie',
    category: cookie?.category ?? 'marketing',
    provider: cookie?.provider ?? '',
    description: cookie?.description ?? '',
    retention: cookie?.retention ?? '',
    descriptionOverrides: { ...(cookie?.descriptionOverrides ?? {}) } as Record<string, string>,
  });
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  return (
    <div class="panel">
      <h2 style="margin-top:0">{cookie ? `Edit ${cookie.name}` : 'Add cookie'}</h2>
      <form onSubmit={(e) => {
        e.preventDefault();
        const req = cookie ? api('PUT', `/sites/${site.id}/cookies/${cookie.id}`, f) : api('POST', `/sites/${site.id}/cookies`, f);
        req.then(onClose).catch((x: Error) => setErr(x.message));
      }}>
        <div class="row">
          <label class="field"><span>Name</span><input required disabled={!!cookie} value={f.name} onInput={(e) => set('name', e.currentTarget.value)} /></label>
          <label class="field"><span>Category</span>
            <select value={f.category} onChange={(e) => set('category', e.currentTarget.value)}>{meta.categories.map((c) => <option value={c}>{c}</option>)}</select>
          </label>
          <label class="field"><span>Provider</span><input value={f.provider} onInput={(e) => set('provider', e.currentTarget.value)} /></label>
          <label class="field"><span>Expiry</span><input value={f.retention} onInput={(e) => set('retention', e.currentTarget.value)} placeholder="1 year, Session, 30 days" /></label>
        </div>
        <label class="field"><span>Description (English — used as the source for translations)</span><textarea value={f.description} onInput={(e) => set('description', e.currentTarget.value)} /></label>
        {site.locales.filter((l) => l !== 'en').map((l) => (
          <label class="field"><span>Description — {meta.locales.find((x) => x.code === l)?.name ?? l} {cookie?.translations[l] && !f.descriptionOverrides[l] ? '(translation from database; type to override)' : ''}</span>
            <textarea value={f.descriptionOverrides[l] ?? ''} placeholder={cookie?.translations[l] ?? ''} onInput={(e) => setF({ ...f, descriptionOverrides: { ...f.descriptionOverrides, [l]: e.currentTarget.value } })} />
          </label>
        ))}
        {err && <p class="error-text" role="alert">{err}</p>}
        <div class="row" style="justify-content:flex-start">
          <button class="primary" type="submit" style="flex:0 0 auto">Save</button>
          <button type="button" style="flex:0 0 auto" onClick={onClose}>Cancel</button>
          {cookie && <button type="button" class="danger" style="flex:0 0 auto" onClick={() => confirm(`Delete ${cookie.name}?`) && api('DELETE', `/sites/${site.id}/cookies/${cookie.id}`).then(onClose)}>Delete</button>}
        </div>
      </form>
    </div>
  );
}

function Scans({ site }: { site: Site }) {
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [err, setErr] = useState('');
  const load = () => api<ScanSummary[]>('GET', `/sites/${site.id}/scans`).then(setScans);
  useEffect(() => {
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [site.id]);
  const busy = scans[0]?.status === 'queued' || scans[0]?.status === 'running';
  return (
    <>
      <div class="toolbar">
        <p class="muted" style="margin:0">The scanner opens up to 20 pages of https://{site.domain} in a headless browser, first without consent and then after "Accept all", and matches every cookie and storage key against the Open Cookie Database.</p>
        <button class="primary" disabled={busy} onClick={() => api('POST', `/sites/${site.id}/scans`).then(load).catch((x: Error) => setErr(x.message))}>{busy ? 'Scanning…' : 'Scan now'}</button>
      </div>
      {err && <p class="error-text" role="alert">{err}</p>}
      <div class="panel table-wrap">
        <table>
          <thead><tr><th>Started</th><th>Status</th><th>Pages</th><th>Cookies</th><th>Banner found</th><th>Third parties before consent</th></tr></thead>
          <tbody>
            {scans.map((s) => (
              <tr>
                <td>{s.startedAt ? new Date(s.startedAt).toLocaleString() : '—'}</td>
                <td><span class={`badge ${s.status === 'done' ? 'ok' : s.status === 'failed' ? 'error' : 'info'}`}>{s.status}</span>{s.error && <div class="error-text">{s.error}</div>}</td>
                <td>{s.pagesScanned}</td>
                <td>{s.cookiesFound}</td>
                <td>{s.bannerDetected === null ? '—' : s.bannerDetected ? 'yes' : <span class="badge error">no</span>}</td>
                <td>{s.thirdPartyHostsBeforeConsent.join(', ') || '—'}</td>
              </tr>
            ))}
            {!scans.length && <tr><td colSpan={6} class="muted">No scans yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

const SETTINGS_SECTIONS = [
  ['general', 'General'],
  ['rules', 'Rules & exemptions'],
  ['languages', 'Languages'],
  ['blocking', 'Blocking'],
  ['appearance', 'Appearance'],
] as const;

function Settings({ site, meta, onSaved, canDelete }: { site: Site; meta: Meta; onSaved: (s: Site) => void; canDelete: boolean }) {
  const [s, setS] = useState(site);
  const [msg, setMsg] = useState('');
  const [sec, setSec] = useState<string>('general');
  const pack = meta.rulePacks.find((p) => p.id === s.rulePack)!;
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const dirty = JSON.stringify(s) !== JSON.stringify(site);
  const sections = [...SETTINGS_SECTIONS, ...(canDelete ? [['danger', 'Delete site'] as const] : [])];
  return (
    <form class="settings" onSubmit={(e) => {
      e.preventDefault();
      api<Site>('PUT', `/sites/${site.id}`, s).then((x) => { onSaved(x); setS(x); setMsg('Saved.'); }).catch((x: Error) => setMsg(x.message));
    }}>
      <nav class="subnav" aria-label="Settings sections">
        {sections.map(([k, label]) => (
          <button type="button" class={sec === k ? 'active' : ''} aria-current={sec === k ? 'true' : undefined} onClick={() => { setSec(k); setMsg(''); }}>{label}</button>
        ))}
      </nav>
      <div class="settings-body">
        {sec === 'general' && (
          <section class="panel">
            <h2>General</h2>
            <div class="row">
              <Field label="Name"><input value={s.name} onInput={(e) => setS({ ...s, name: e.currentTarget.value })} /></Field>
              <Field label="Domain"><input value={s.domain} onInput={(e) => setS({ ...s, domain: e.currentTarget.value })} /></Field>
            </div>
            <Field label="Extra domains" hint="Comma separated. The banner also runs on these, e.g. a shop on another domain."><input value={s.extraDomains.join(', ')} onInput={(e) => setS({ ...s, extraDomains: e.currentTarget.value.split(',').map((x) => x.trim()) })} /></Field>
            <div class="row">
              <Field label="Cookie / privacy policy URL" hint="Linked from the banner. Your own page, or the hosted cookie policy link from the site overview."><input type="url" value={s.privacyPolicyUrl} onInput={(e) => setS({ ...s, privacyPolicyUrl: e.currentTarget.value })} placeholder="https://example.nl/cookies" /></Field>
              <Field label="Privacy contact" hint="Shown in the cookie policy."><input value={s.contact} onInput={(e) => setS({ ...s, contact: e.currentTarget.value })} placeholder="privacy@example.nl" /></Field>
            </div>
          </section>
        )}
        {sec === 'rules' && (
          <section class="panel">
            <h2>Rules & exemptions</h2>
            <Field label="Rule pack" hint="The country rules the compliance check and the banner follow.">
              <select value={s.rulePack} onChange={(e) => setS({ ...s, rulePack: e.currentTarget.value, exemptConfirmed: [] })}>
                {meta.rulePacks.map((p) => <option value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            {pack.conditionalExemptCategories.length > 0 ? pack.conditionalExemptCategories.map((c) => (
              <div class="exempt">
                <label class="check"><input type="checkbox" checked={s.exemptConfirmed.includes(c.category)} onChange={() => setS({ ...s, exemptConfirmed: toggle(s.exemptConfirmed, c.category) })} />
                  <span><strong>Run "{c.category}" without consent.</strong> Only tick this if all of these are true:</span></label>
                <ul class="muted">{c.conditions.map((x) => <li>{x}</li>)}</ul>
              </div>
            )) : <p class="muted">These rules have no optional exemptions.</p>}
          </section>
        )}
        {sec === 'languages' && (
          <section class="panel">
            <h2>Languages</h2>
            <p class="muted">The banner shows in the visitor's browser language when it is turned on here.</p>
            <div class="checkgrid">
              {meta.locales.map((l) => (
                <label class="check"><input type="checkbox" checked={s.locales.includes(l.code)} disabled={l.code === s.defaultLocale} onChange={() => setS({ ...s, locales: toggle(s.locales, l.code) })} />{l.name}</label>
              ))}
            </div>
            <Field label="Default language" hint="Used when the visitor's language is not turned on.">
              <select value={s.defaultLocale} onChange={(e) => setS({ ...s, defaultLocale: e.currentTarget.value, locales: [...new Set([e.currentTarget.value, ...s.locales])] })}>
                {meta.locales.map((l) => <option value={l.code}>{l.name}</option>)}
              </select>
            </Field>
          </section>
        )}
        {sec === 'blocking' && (
          <section class="panel">
            <h2>Blocking</h2>
            <label class="check"><input type="checkbox" checked={s.autoBlock} onChange={() => setS({ ...s, autoBlock: !s.autoBlock })} />
              <span><strong>Auto-block known trackers</strong> (Meta, LinkedIn, TikTok, Reddit, Pinterest, Hotjar, YouTube embeds and more) until the visitor consents.</span></label>
            <label class="check"><input type="checkbox" checked={s.consentMode} onChange={() => setS({ ...s, consentMode: !s.consentMode })} />
              <span><strong>Google Consent Mode v2.</strong> Google tags load but stay in restricted mode until consent. Turn off to block Google tags completely instead.</span></label>
          </section>
        )}
        {sec === 'appearance' && (
          <section class="panel">
            <h2>Appearance</h2>
            <Field label="Layout">
              <div class="layouts" role="radiogroup" aria-label="Layout" style={`--btn:${s.theme.primary}`}>
                {([['bottom', 'Bar at the bottom'], ['bottom-left', 'Box, bottom left'], ['center', 'Popup in the centre']] as const).map(([v, label]) => (
                  <label class={`layout ${s.theme.position === v ? 'on' : ''}`}>
                    <input type="radio" name="position" value={v} checked={s.theme.position === v} onChange={() => setS({ ...s, theme: { ...s.theme, position: v } })} />
                    <span class={`thumb thumb-${v}`} aria-hidden="true"><i /></span>
                    {label}
                  </label>
                ))}
              </div>
            </Field>
            <div class="colours">
              {([['primary', 'Buttons'], ['background', 'Background'], ['text', 'Text']] as const).map(([k, label]) => (
                <label class="colour">
                  <input type="color" value={s.theme[k]} onInput={(e) => setS({ ...s, theme: { ...s.theme, [k]: e.currentTarget.value } })} />
                  <span><strong>{label}</strong><code>{s.theme[k]}</code></span>
                </label>
              ))}
            </div>
            <p class="muted">Accept and Reject always use the button colour, so neither stands out.</p>
            <label class="check"><input type="checkbox" checked={s.theme.floatingButton !== false} onChange={() => setS({ ...s, theme: { ...s.theme, floatingButton: s.theme.floatingButton === false } })} />
              <span><strong>Show the cookie button after a choice.</strong> A small round button in the bottom left corner that reopens the cookie settings.</span></label>
            {s.theme.floatingButton === false && (
              <div class="note">
                <p>Visitors must still be able to change their choice. Put a link like this on every page, for example in your footer:</p>
                <pre>{'<a href="#" data-oc-open>Cookie settings</a>'}</pre>
                <p>The cookie policy block (<code>{'<div data-oc-policy></div>'}</code>) has a button for it too. The next scan checks that one of them is there.</p>
              </div>
            )}
          </section>
        )}
        {sec === 'danger' && canDelete && (
          <section class="panel">
            <h2>Delete site</h2>
            <p>Deletes {site.name}, its cookie list, scans and all consent records. The banner stops loading on the site. This cannot be undone.</p>
            <button type="button" class="danger" onClick={() => confirm(`Delete ${site.name} and all its consent records? This cannot be undone.`) && api('DELETE', `/sites/${site.id}`).then(() => (location.hash = '#/sites'))}>Delete {site.name}</button>
          </section>
        )}
        {sec !== 'danger' && (
          <div class="savebar" data-dirty={dirty}>
            <span role="status" class="muted">{msg || (dirty ? 'You have unsaved changes.' : 'All changes saved.')}</span>
            <button class="primary" type="submit" disabled={!dirty}>Save changes</button>
          </div>
        )}
      </div>
    </form>
  );
}

/** Text overrides per language. Empty fields fall back to the default template. */
function Texts({ site, meta, onSaved }: { site: Site; meta: Meta; onSaved: (s: Site) => void }) {
  const [locale, setLocale] = useState(site.defaultLocale);
  const [overrides, setOverrides] = useState(site.textOverrides);
  const [msg, setMsg] = useState('');
  const tpl = meta.templates[locale]!;
  const cur = (overrides[locale] ?? {}) as Record<string, unknown>;
  const setKey = (path: string[], v: string) => {
    const next = structuredClone(overrides) as Record<string, Record<string, unknown>>;
    let o: Record<string, unknown> = (next[locale] ??= {});
    for (const p of path.slice(0, -1)) o = (o[p] ??= {}) as Record<string, unknown>;
    o[path[path.length - 1]!] = v;
    setOverrides(next as Site['textOverrides']);
  };
  const get = (path: string[]) => path.reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], cur) as string | undefined;
  const def = (path: string[]) => path.reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], tpl) as string;
  const fields: [string[], string][] = [
    [['title'], 'Title'], [['body'], 'Text ({policyLink} becomes the link)'], [['policyLinkText'], 'Policy link text'],
    [['acceptAll'], 'Accept all'], [['rejectAll'], 'Reject all'], [['customize'], 'Choose per category'], [['save'], 'Save choices'],
    [['settingsTitle'], 'Settings title'], [['settingsBody'], 'Settings text'], [['withdrawButton'], 'Withdraw button label'],
    ...meta.categories.flatMap((c) => [[['categories', c, 'label'], `${c} — label`], [['categories', c, 'description'], `${c} — description`]] as [string[], string][]),
    [['optOutTitle'], 'Opt-out title (US)'], [['optOutBody'], 'Opt-out text (US)'], [['optOutButton'], 'Opt-out button (US)'], [['gpcHonored'], 'GPC notice'],
  ];
  return (
    <form class="panel" onSubmit={(e) => {
      e.preventDefault();
      api<Site>('PUT', `/sites/${site.id}`, { textOverrides: overrides }).then((x) => { onSaved(x); setMsg('Saved. Visitors will be asked again because the text changed.'); }).catch((x: Error) => setMsg(x.message));
    }}>
      <p class="muted">Leave a field empty to use the default template text (shown greyed out). Changing texts bumps the policy version, so visitors are asked again.</p>
      <Field label="Language">
        <select value={locale} onChange={(e) => setLocale(e.currentTarget.value)}>
          {site.locales.map((l) => <option value={l}>{meta.locales.find((x) => x.code === l)?.name ?? l}</option>)}
        </select>
      </Field>
      {fields.map(([path, label]) => {
        const long = def(path).length > 80;
        const props = { value: get(path) ?? '', placeholder: def(path), onInput: (e: { currentTarget: { value: string } }) => setKey(path, e.currentTarget.value) };
        return <Field label={label}>{long ? <textarea {...props} /> : <input {...props} />}</Field>;
      })}
      <div class="row" style="justify-content:flex-start">
        <button class="primary" type="submit" style="flex:0 0 auto">Save texts</button>
        <span role="status">{msg}</span>
      </div>
    </form>
  );
}

function Consents({ site }: { site: Site }) {
  const [data, setData] = useState<{ total: number; rows: ConsentRecord[]; last30Days: Record<string, number> } | null>(null);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');
  useEffect(() => {
    api<typeof data>('GET', `/sites/${site.id}/consents?offset=${offset}&consentId=${encodeURIComponent(q)}`).then(setData);
  }, [site.id, offset, q]);
  const stats = data?.last30Days ?? {};
  const total30 = Object.values(stats).reduce((a, b) => a + b, 0);
  const pct = (n = 0) => (total30 ? Math.round((n / total30) * 100) + '%' : '—');
  return (
    <>
      <div class="grid" style="margin-bottom:16px">
        <div class="panel"><div class="muted">Choices (30 days)</div><div class="stat">{total30}</div></div>
        <div class="panel"><div class="muted">Accepted all</div><div class="stat">{pct(stats.accept_all)}</div></div>
        <div class="panel"><div class="muted">Rejected all</div><div class="stat">{pct(stats.reject_all)}</div></div>
        <div class="panel"><div class="muted">Custom / GPC / opt-out</div><div class="stat">{pct((stats.custom ?? 0) + (stats.gpc ?? 0) + (stats.opt_out ?? 0))}</div></div>
      </div>
      <div class="toolbar">
        <input style="max-width:360px" placeholder="Find by consent ID (visitor's oc_consent cookie)" value={q} onInput={(e) => { setOffset(0); setQ(e.currentTarget.value.trim()); }} />
        <a class="btn" href={`/admin/api/sites/${site.id}/consents.csv`}>Export CSV</a>
      </div>
      <div class="panel table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Consent ID</th><th>Choice</th><th>Categories</th><th>Version</th><th>Language</th><th>Page</th></tr></thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td><code>{r.consentId.slice(0, 12)}…</code></td>
                <td>{r.action}{r.gpc && <span class="badge info">GPC</span>}</td>
                <td>{r.categories.join(', ')}</td>
                <td>{r.policyVersion}</td>
                <td>{r.locale}</td>
                <td class="muted">{r.url}</td>
              </tr>
            ))}
            {data?.rows.length === 0 && <tr><td colSpan={7} class="muted">No consent records.</td></tr>}
          </tbody>
        </table>
      </div>
      {data && data.total > 50 && (
        <div class="row" style="justify-content:flex-start">
          <button style="flex:0 0 auto" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button>
          <span class="muted" style="flex:0 0 auto">{offset + 1}–{Math.min(offset + 50, data.total)} of {data.total}</span>
          <button style="flex:0 0 auto" disabled={offset + 50 >= data.total} onClick={() => setOffset(offset + 50)}>Next</button>
        </div>
      )}
    </>
  );
}

render(<App />, document.getElementById('app')!);
