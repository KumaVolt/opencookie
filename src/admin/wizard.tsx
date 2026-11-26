import { useEffect, useState } from 'preact/hooks';
import type { RulePack } from '../core/rulepacks.ts';
import { api } from './api.ts';
import { Field, type Me } from './auth.tsx';
import { Icon, Mark } from './shell.tsx';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const WIZARD_KEY = 'oc-setup-dismissed';
export const dismissWizard = () => {
  try {
    localStorage.setItem(WIZARD_KEY, '1');
  } catch {}
};
export const wizardDismissed = () => {
  try {
    return localStorage.getItem(WIZARD_KEY) === '1';
  } catch {
    return false;
  }
};

/** Languages to turn on for each rule pack. English is always added as a fallback for visitors from abroad. */
const PACK_LANGS: Record<string, string[]> = {
  'nl-ap': ['nl', 'en'], 'fr-cnil': ['fr', 'en'], 'de-tdddg': ['de', 'en'], 'uk-duaa': ['en'], 'us-gpc': ['en'], 'eu-edpb': ['en'],
};
const PACK_HINT: Record<string, string> = {
  'nl-ap': 'Dutch sites. Follows the Autoriteit Persoonsgegevens guidance.',
  'eu-edpb': 'Any EU site when no country pack fits. The strict baseline.',
  'fr-cnil': 'French sites. Adds the CNIL rules, such as asking again 6 months after a refusal.',
  'de-tdddg': 'German sites. Follows §25 TDDDG.',
  'uk-duaa': 'UK sites. Allows simple first-party statistics without consent, under conditions.',
  'us-gpc': 'US sites. Opt-out model that honours Global Privacy Control.',
};
const LAYOUTS = [['bottom', 'Bar at the bottom'], ['bottom-left', 'Box, bottom left'], ['center', 'Popup in the centre']] as const;
const STEPS = ['Client', 'Site', 'Rules', 'Look', 'Install'];
/** Neutral first; the rest are common brand tones that keep white text readable. */
const SWATCHES: [string, string][] = [['#1a1a1a', 'Black'], ['#3f4fc4', 'Indigo'], ['#1f6f5c', 'Green'], ['#8c2f39', 'Wine'], ['#2b5f9e', 'Blue'], ['#5b4636', 'Brown']];

interface WizardMeta { rulePacks: RulePack[]; locales: { code: string; name: string }[] }
interface OrgLite { id: number; name: string; role: string | null }

/**
 * First-run setup: client → site → rules → look → install snippet.
 * Platform admins start at "Client"; client owners skip it and add a site to their own client.
 */
export function SetupWizard({ me, meta, orgs, preferOrg, onDone }: {
  me: Me;
  meta: WizardMeta;
  orgs: OrgLite[];
  preferOrg: number | null;
  onDone: (orgId: number, siteId: number | null) => void;
}) {
  const platform = me.user.isPlatformAdmin;
  const ownable = orgs.filter((o) => platform || o.role === 'owner');
  const [step, setStep] = useState(platform ? 0 : 1);
  const [orgChoice, setOrgChoice] = useState<number | 'new'>(preferOrg && ownable.some((o) => o.id === preferOrg) ? preferOrg : ownable[0]?.id ?? 'new');
  const [orgName, setOrgName] = useState('');
  const [site, setSite] = useState({ name: '', domain: '' });
  const [pack, setPack] = useState('nl-ap');
  const [layout, setLayout] = useState<'bottom' | 'bottom-left' | 'center'>('bottom');
  const [colour, setColour] = useState('#1a1a1a');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [made, setMade] = useState<{ orgId: number; siteId: number; head: string } | null>(null);
  const [scan, setScan] = useState<'idle' | 'started' | 'failed'>('idle');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setErr('');
    setTimeout(() => (document.querySelector('.wizard-body input:not([type=radio]):not([type=color])') as HTMLInputElement | null)?.focus(), 0);
  }, [step]);
  const first = platform ? 0 : 1;
  const domain = site.domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  const create = async () => {
    setBusy(true);
    setErr('');
    try {
      const orgId = orgChoice === 'new' ? (await api<{ id: number }>('POST', '/orgs', { name: orgName.trim() })).id : orgChoice;
      const langs = (PACK_LANGS[pack] ?? ['en']).filter((l) => meta.locales.some((x) => x.code === l));
      const s = await api<{ id: number }>('POST', '/sites', {
        orgId, name: site.name.trim() || domain, domain, rulePack: pack, defaultLocale: langs[0] ?? 'en', locales: langs.length ? langs : ['en'],
        theme: { primary: colour, position: layout },
      });
      const embed = await api<{ head: string }>('GET', `/sites/${s.id}/embed`);
      setMade({ orgId, siteId: s.id, head: embed.head });
      setOrgChoice(orgId);
      setStep(4);
    } catch (x) {
      setErr(msg(x));
    } finally {
      setBusy(false);
    }
  };

  const next = (e: Event) => {
    e.preventDefault();
    if (step === 3) void create();
    else setStep(step + 1);
  };
  const finish = () => {
    dismissWizard();
    if (made) onDone(made.orgId, made.siteId);
  };
  const skip = () => {
    dismissWizard();
    location.hash = '#/';
  };

  return (
    <div class="wizard">
      <div class="wizard-head">
        <Mark size={28} />
        <div>
          <h1>Set up your first banner</h1>
          <p class="muted">About two minutes. You can change everything later.</p>
        </div>
        {!made && <button class="link" onClick={skip}>Skip setup</button>}
      </div>

      <ol class="stepper" aria-label="Setup steps">
        {STEPS.map((label, i) => i < first ? null : (
          <li class={i === step ? 'now' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span class="dot">{i < step ? <Icon name="check" size={13} /> : i - first + 1}</span>{label}
          </li>
        ))}
      </ol>

      <form class="panel wizard-body" onSubmit={next}>
        {step === 0 && (
          <>
            <h2>{ownable.length ? 'Who is this site for?' : 'Name your first client'}</h2>
            <p class="muted">Sites belong to a client. A client has its own team, logins and statistics. For your own sites, make a client for yourself.</p>
            {ownable.length > 0 && <div class="choices" role="radiogroup">
              {ownable.map((o) => (
                <label class={`choice ${orgChoice === o.id ? 'on' : ''}`}>
                  <input type="radio" name="org" checked={orgChoice === o.id} onChange={() => setOrgChoice(o.id)} />
                  <span><strong>{o.name}</strong><span class="muted">Existing client</span></span>
                </label>
              ))}
              <label class={`choice ${orgChoice === 'new' ? 'on' : ''}`}>
                <input type="radio" name="org" checked={orgChoice === 'new'} onChange={() => setOrgChoice('new')} />
                <span><strong>A new client</strong><span class="muted">A company you manage sites for, or yourself</span></span>
              </label>
            </div>}
            {orgChoice === 'new' && (
              <Field label="Client name" hint="You can invite their team after setup.">
                <input required value={orgName} onInput={(e) => setOrgName(e.currentTarget.value)} placeholder="Bakkerij de Vries" />
              </Field>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <h2>Which site?</h2>
            <div>
              <Field label="Domain" hint="Without https://. Add other domains later in the site settings.">
                <input required value={site.domain} onInput={(e) => setSite({ ...site, domain: e.currentTarget.value })} placeholder="example.nl" inputMode="url" autoComplete="off" />
              </Field>
              <Field label="Name (optional)" hint="How it shows in this dashboard.">
                <input value={site.name} onInput={(e) => setSite({ ...site, name: e.currentTarget.value })} placeholder={domain || 'Webshop'} />
              </Field>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Which rules apply?</h2>
            <p class="muted">Pick the country where the site's visitors mostly are. The banner and the compliance check follow these rules.</p>
            <div class="choices" role="radiogroup">
              {meta.rulePacks.map((p) => (
                <label class={`choice ${pack === p.id ? 'on' : ''}`}>
                  <input type="radio" name="pack" checked={pack === p.id} onChange={() => setPack(p.id)} />
                  <span><strong>{p.name.split(' — ')[0]}</strong><span class="muted">{PACK_HINT[p.id] ?? p.name}</span></span>
                </label>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>How should the banner look?</h2>
            <div class="layouts" role="radiogroup" aria-label="Layout" style={`--btn:${colour}`}>
              {LAYOUTS.map(([v, label]) => (
                <label class={`layout ${layout === v ? 'on' : ''}`}>
                  <input type="radio" name="layout" checked={layout === v} onChange={() => setLayout(v)} />
                  <span class={`thumb thumb-${v}`} aria-hidden="true"><i /></span>
                  {label}
                </label>
              ))}
            </div>
            <Field label="Button colour" hint="Accept and Reject always get the same colour, as the rules require.">
              <div class="swatches" role="radiogroup" aria-label="Button colour">
                {SWATCHES.map(([c, name]) => (
                  <button type="button" role="radio" aria-checked={colour === c} aria-label={name} title={name} class={colour === c ? 'on' : ''} style={`--sw:${c}`} onClick={() => setColour(c)} />
                ))}
                <label class="swatch-custom" title="Your own colour">
                  <input type="color" value={colour} onInput={(e) => setColour(e.currentTarget.value)} aria-label="Your own colour" />
                  Own colour
                </label>
              </div>
            </Field>
          </>
        )}

        {step === 4 && made && (
          <>
            <h2>Add this line to your site</h2>
            <p class="muted">Paste it as the first item in the <code>&lt;head&gt;</code> of every page, before analytics and other tags. In WordPress, use a header-scripts plugin; in Google Tag Manager, do not: it must load before GTM.</p>
            <div class="snippet">
              <pre>{made.head}</pre>
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(made.head); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <h3>Find the cookies</h3>
            <p class="muted">The scanner visits pages of {domain} and lists every cookie it finds, with its purpose from the Open Cookie Database.</p>
            {scan === 'idle' && <button type="button" onClick={() => api('POST', `/sites/${made.siteId}/scans`, {}).then(() => setScan('started')).catch(() => setScan('failed'))}>Scan {domain} now</button>}
            {scan === 'started' && <p class="badge ok">Scan started. Results show on the site's Cookies tab in a minute or two.</p>}
            {scan === 'failed' && <p class="error-text">The scan could not start. You can try again from the site's Scans tab.</p>}
          </>
        )}

        {err && <p class="error-text" role="alert">{err}</p>}

        <div class="wizard-foot">
          {step > first && step < 4 && <button type="button" onClick={() => setStep(step - 1)}>Back</button>}
          <span style="flex:1" />
          {step < 4 && <button class="primary" type="submit" disabled={busy}>{step === 3 ? (busy ? 'Creating…' : 'Create banner') : 'Continue'}</button>}
          {step === 4 && <button class="primary" type="button" onClick={finish}>Open the site</button>}
        </div>
      </form>
    </div>
  );
}
