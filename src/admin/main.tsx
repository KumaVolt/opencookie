import { render } from 'preact';
import { useEffect, useState, useCallback } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Category } from '../core/categories.ts';
import type { ComplianceIssue } from '../core/compliance.ts';
import type { RulePack } from '../core/rulepacks.ts';
import type { BannerTexts } from '../core/templates/types.ts';
import type { ConsentRecord, ScanSummary, Site, SiteCookie } from '../core/types.ts';

// ---------------------------------------------------------------- API helper
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/admin/api${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), 'X-Requested-With': 'opencookie-admin' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 401 && path !== '/login') {
    window.dispatchEvent(new Event('oc-logout'));
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new HttpError(res.status, (data as { error?: string })?.error ?? res.statusText);
  return data as T;
}

interface Meta {
  publicUrl: string;
  rulePacks: RulePack[];
  locales: { code: string; name: string }[];
  categories: Category[];
  templates: Record<string, BannerTexts>;
  cookieDb: { entries: number };
  translations: Record<string, number>;
}
type SiteRow = Site & { latestScan: ScanSummary | null; cookieCount: number };
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

function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const hash = useHash();

  const loadMeta = useCallback(() => {
    api<Meta>('GET', '/meta').then((m) => {
      setMeta(m);
      setAuthed(true);
    }).catch(() => setAuthed(false));
  }, []);
  useEffect(() => {
    loadMeta();
    const out = () => setAuthed(false);
    window.addEventListener('oc-logout', out);
    return () => window.removeEventListener('oc-logout', out);
  }, [loadMeta]);

  if (authed === null) return <main><p class="muted">Loading…</p></main>;
  if (!authed) return <Login onDone={loadMeta} />;
  if (!meta) return null;

  const m = hash.match(/^\/sites\/(\d+)(?:\/(\w+))?/);
  return (
    <>
      <header class="top">
        <a href="#/" style="text-decoration:none;color:inherit"><strong>🍪 OpenCookie</strong></a>
        <button onClick={() => api('POST', '/logout').finally(() => setAuthed(false))}>Log out</button>
      </header>
      <main>{m ? <SitePage id={Number(m[1])} tab={m[2] ?? 'overview'} meta={meta} /> : <SitesPage meta={meta} reloadMeta={loadMeta} />}</main>
    </>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <main class="login panel">
      <h1>OpenCookie</h1>
      <p class="muted">Log in with the ADMIN_PASSWORD set on the server.</p>
      <form onSubmit={(e) => {
        e.preventDefault();
        api('POST', '/login', { password: pw }).then(onDone).catch((x: Error) => setErr(x.message));
      }}>
        <label class="field"><span>Password</span><input type="password" autoComplete="current-password" value={pw} onInput={(e) => setPw(e.currentTarget.value)} autoFocus /></label>
        {err && <p class="error-text" role="alert">{err}</p>}
        <button class="primary" type="submit">Log in</button>
      </form>
    </main>
  );
}

// -------------------------------------------------------------------- sites
function SitesPage({ meta, reloadMeta }: { meta: Meta; reloadMeta: () => void }) {
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [form, setForm] = useState({ name: '', domain: '', rulePack: 'nl-ap', defaultLocale: 'nl' });
  const [err, setErr] = useState('');
  const [updating, setUpdating] = useState(false);
  const load = () => api<SiteRow[]>('GET', '/sites').then(setSites);
  useEffect(() => void load(), []);

  return (
    <>
      <h1>Sites</h1>
      <p class="muted">Unlimited sites. Cookie database: {meta.cookieDb.entries.toLocaleString()} entries · Translations: {Object.entries(meta.translations).map(([l, n]) => `${l} ${n}`).join(', ') || 'none yet'}{' '}
        <button disabled={updating} onClick={() => {
          setUpdating(true);
          api('POST', '/cookie-db/update').then(reloadMeta).finally(() => setUpdating(false));
        }}>{updating ? 'Updating…' : 'Update cookie database'}</button>
      </p>
      <div class="grid" style="margin:16px 0">
        {sites?.map((s) => (
          <a class="card" href={`#/sites/${s.id}`} key={s.id}>
            <strong>{s.name}</strong>
            <div class="muted">{s.domain}</div>
            <div style="margin-top:8px" class="row">
              <span class="badge">{s.rulePack}</span>
              <span class="badge">{s.cookieCount} cookies</span>
              <span class={`badge ${s.latestScan?.status === 'done' ? 'ok' : 'warning'}`}>{s.latestScan?.finishedAt ? `scanned ${new Date(s.latestScan.finishedAt).toLocaleDateString()}` : 'not scanned'}</span>
            </div>
          </a>
        ))}
        {sites?.length === 0 && <p class="muted">No sites yet. Add your first one below.</p>}
      </div>
      <div class="panel">
        <h2 style="margin-top:0">Add a site</h2>
        <form onSubmit={(e) => {
          e.preventDefault();
          setErr('');
          api<Site>('POST', '/sites', { ...form, locales: [...new Set([form.defaultLocale, 'en'])] })
            .then((s) => (location.hash = `#/sites/${s.id}/settings`))
            .catch((x: Error) => setErr(x.message));
        }}>
          <div class="row">
            <label class="field"><span>Name</span><input required value={form.name} onInput={(e) => setForm({ ...form, name: e.currentTarget.value })} placeholder="My company" /></label>
            <label class="field"><span>Domain</span><input required value={form.domain} onInput={(e) => setForm({ ...form, domain: e.currentTarget.value })} placeholder="example.nl" /></label>
            <label class="field"><span>Rule pack</span>
              <select value={form.rulePack} onChange={(e) => setForm({ ...form, rulePack: e.currentTarget.value })}>
                {meta.rulePacks.map((p) => <option value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label class="field"><span>Default language</span>
              <select value={form.defaultLocale} onChange={(e) => setForm({ ...form, defaultLocale: e.currentTarget.value })}>
                {meta.locales.map((l) => <option value={l.code}>{l.name}</option>)}
              </select>
            </label>
          </div>
          {err && <p class="error-text" role="alert">{err}</p>}
          <button class="primary" type="submit">Add site</button>
        </form>
      </div>
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

function SitePage({ id, tab, meta }: { id: number; tab: string; meta: Meta }) {
  const [site, setSite] = useState<Site | null>(null);
  const reload = () => api<Site>('GET', `/sites/${id}`).then(setSite);
  useEffect(() => void reload(), [id]);
  if (!site) return <p class="muted">Loading…</p>;
  return (
    <>
      <p><a href="#/">← All sites</a></p>
      <h1>{site.name}</h1>
      <div class="muted">{site.domain} · {meta.rulePacks.find((p) => p.id === site.rulePack)?.name} · policy version {site.policyVersion}</div>
      <nav class="tabs" aria-label="Site sections">
        {TABS.map(([k, label]) => <a href={`#/sites/${id}/${k}`} class={tab === k ? 'active' : ''} aria-current={tab === k ? 'page' : undefined}>{label}</a>)}
      </nav>
      {tab === 'overview' && <Overview site={site} />}
      {tab === 'cookies' && <Cookies site={site} meta={meta} />}
      {tab === 'scans' && <Scans site={site} />}
      {tab === 'settings' && <Settings site={site} meta={meta} onSaved={setSite} />}
      {tab === 'texts' && <Texts site={site} meta={meta} onSaved={setSite} />}
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
          <p>2. On your cookie policy page, this renders the always-up-to-date cookie table in the visitor's language:</p>
          <pre>{embed.policy}</pre>
          <p>Or link to the generated policy page: <a href={embed.policyUrl} target="_blank" rel="noreferrer">{embed.policyUrl}</a></p>
          <p>3. Scripts the auto-blocker does not know can be blocked by hand:</p>
          <pre>{embed.manualBlocking}</pre>
          <p>Add <code>data-oc-open</code> to any link or button (e.g. in your footer) to open the cookie settings.</p>
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

function Settings({ site, meta, onSaved }: { site: Site; meta: Meta; onSaved: (s: Site) => void }) {
  const [s, setS] = useState(site);
  const [msg, setMsg] = useState('');
  const pack = meta.rulePacks.find((p) => p.id === s.rulePack)!;
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <form class="panel" onSubmit={(e) => {
      e.preventDefault();
      api<Site>('PUT', `/sites/${site.id}`, s).then((x) => { onSaved(x); setS(x); setMsg('Saved.'); }).catch((x: Error) => setMsg(x.message));
    }}>
      <div class="row">
        <Field label="Name"><input value={s.name} onInput={(e) => setS({ ...s, name: e.currentTarget.value })} /></Field>
        <Field label="Domain"><input value={s.domain} onInput={(e) => setS({ ...s, domain: e.currentTarget.value })} /></Field>
        <Field label="Extra domains (comma separated)"><input value={s.extraDomains.join(', ')} onInput={(e) => setS({ ...s, extraDomains: e.currentTarget.value.split(',').map((x) => x.trim()) })} /></Field>
      </div>
      <div class="row">
        <Field label="Rule pack">
          <select value={s.rulePack} onChange={(e) => setS({ ...s, rulePack: e.currentTarget.value, exemptConfirmed: [] })}>
            {meta.rulePacks.map((p) => <option value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Cookie / privacy policy URL"><input type="url" value={s.privacyPolicyUrl} onInput={(e) => setS({ ...s, privacyPolicyUrl: e.currentTarget.value })} placeholder="https://example.nl/cookies" /></Field>
        <Field label="Privacy contact"><input value={s.contact} onInput={(e) => setS({ ...s, contact: e.currentTarget.value })} placeholder="privacy@example.nl" /></Field>
      </div>
      <fieldset class="panel">
        <legend>Languages</legend>
        <div class="row">
          {meta.locales.map((l) => (
            <label class="check" style="flex:0 0 auto"><input type="checkbox" checked={s.locales.includes(l.code)} disabled={l.code === s.defaultLocale} onChange={() => setS({ ...s, locales: toggle(s.locales, l.code) })} />{l.name}</label>
          ))}
        </div>
        <Field label="Default language (used when the visitor's language is not enabled)">
          <select value={s.defaultLocale} onChange={(e) => setS({ ...s, defaultLocale: e.currentTarget.value, locales: [...new Set([e.currentTarget.value, ...s.locales])] })}>
            {meta.locales.map((l) => <option value={l.code}>{l.name}</option>)}
          </select>
        </Field>
      </fieldset>
      <fieldset class="panel">
        <legend>Blocking</legend>
        <label class="check"><input type="checkbox" checked={s.autoBlock} onChange={() => setS({ ...s, autoBlock: !s.autoBlock })} />
          <span><strong>Auto-block known trackers</strong> (Meta, LinkedIn, TikTok, Hotjar, YouTube embeds and more) until the visitor consents.</span></label>
        <label class="check"><input type="checkbox" checked={s.consentMode} onChange={() => setS({ ...s, consentMode: !s.consentMode })} />
          <span><strong>Google Consent Mode v2.</strong> Google tags load but stay in restricted mode until consent. Turn off to block Google tags completely instead.</span></label>
      </fieldset>
      {pack.conditionalExemptCategories.length > 0 && (
        <fieldset class="panel">
          <legend>Exemptions ({pack.name})</legend>
          {pack.conditionalExemptCategories.map((c) => (
            <div>
              <label class="check"><input type="checkbox" checked={s.exemptConfirmed.includes(c.category)} onChange={() => setS({ ...s, exemptConfirmed: toggle(s.exemptConfirmed, c.category) })} />
                <span><strong>Run "{c.category}" without consent.</strong> Only tick this if all of these are true:</span></label>
              <ul class="muted">{c.conditions.map((x) => <li>{x}</li>)}</ul>
            </div>
          ))}
        </fieldset>
      )}
      <fieldset class="panel">
        <legend>Appearance</legend>
        <div class="row">
          <Field label="Button colour (Accept and Reject always look the same)"><input type="color" value={s.theme.primary} onInput={(e) => setS({ ...s, theme: { ...s.theme, primary: e.currentTarget.value } })} /></Field>
          <Field label="Background"><input type="color" value={s.theme.background} onInput={(e) => setS({ ...s, theme: { ...s.theme, background: e.currentTarget.value } })} /></Field>
          <Field label="Text"><input type="color" value={s.theme.text} onInput={(e) => setS({ ...s, theme: { ...s.theme, text: e.currentTarget.value } })} /></Field>
          <Field label="Position">
            <select value={s.theme.position} onChange={(e) => setS({ ...s, theme: { ...s.theme, position: e.currentTarget.value as Site['theme']['position'] } })}>
              <option value="bottom">Bottom bar</option><option value="bottom-left">Bottom left box</option><option value="center">Centre</option>
            </select>
          </Field>
        </div>
      </fieldset>
      <div class="row" style="justify-content:flex-start">
        <button class="primary" type="submit" style="flex:0 0 auto">Save settings</button>
        <span role="status">{msg}</span>
        <span style="flex:1"></span>
        <button type="button" class="danger" style="flex:0 0 auto" onClick={() => confirm(`Delete ${site.name} and all its consent records? This cannot be undone.`) && api('DELETE', `/sites/${site.id}`).then(() => (location.hash = '#/'))}>Delete site</button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return <label class="field"><span>{label}</span>{children}</label>;
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
