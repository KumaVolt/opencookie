/**
 * OpenCookie banner. Served per site from /s/<key>/banner.js, which prepends
 * `window.__OC_BOOT = {...}` with the settings needed synchronously (blocking rules, consent model).
 * Place it as the FIRST script in <head>, without async/defer, so it can block trackers.
 */
import type { BlockRule } from '../core/blocklist.ts';
import type { Category } from '../core/categories.ts';
import type { BannerConfig } from '../server/render.ts';
import { css } from './styles.ts';

export interface Boot {
  key: string;
  api: string;
  /** Rule pack chosen for this visitor (the site's own, or a country rule). */
  pack: string;
  policyVersion: number;
  model: 'opt-in' | 'opt-out';
  exempt: Category[];
  honorGpc: boolean;
  showGpcConfirmation: boolean;
  consentMaxAgeDays: number;
  refusalReaskDays: number;
  autoBlock: boolean;
  blockRules: BlockRule[];
  cookieNames: Record<string, string[]>;
}

type Action = 'accept_all' | 'reject_all' | 'custom' | 'gpc' | 'opt_out';
interface Stored {
  id: string;
  v: number;
  c: Category[];
  t: number;
  a: Action;
  /** Consent model the choice was made under. Missing in records from before country rules. */
  m?: 'opt-in' | 'opt-out';
}

interface Api {
  version: string;
  getConsent(): Stored | null;
  hasConsent(category: Category): boolean;
  acceptAll(): void;
  rejectAll(): void;
  show(): void;
  showSettings(): void;
  onChange(cb: (granted: Category[]) => void): void;
}

declare global {
  interface Window {
    __OC_BOOT?: Boot;
    OpenCookie?: Api;
    dataLayer?: unknown[];
  }
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
}

const ALL: Category[] = ['necessary', 'preferences', 'statistics', 'marketing'];
const COOKIE = 'oc_consent';

(function main() {
  const boot = window.__OC_BOOT;
  if (!boot || window.OpenCookie) return;
  // Sandboxed frames have no cookie access; consent cannot be stored there, so stay out.
  try {
    void document.cookie;
  } catch {
    return;
  }

  const gpc = boot.honorGpc && navigator.globalPrivacyControl === true;
  let stored = readStored();
  let config: BannerConfig | null = null;
  const listeners: ((g: Category[]) => void)[] = [];

  // ------------------------------------------------------------------ state
  function storedIsValid(s: Stored | null): s is Stored {
    if (!s || s.v !== boot!.policyVersion) return false;
    // A choice made under opt-out rules (say, in the US) is not consent where opt-in applies.
    if (s.m === 'opt-out' && boot!.model === 'opt-in') return false;
    const refusedEverything = s.c.every((c) => boot!.exempt.includes(c));
    const maxDays = refusedEverything ? boot!.refusalReaskDays : boot!.consentMaxAgeDays;
    return Date.now() - s.t < maxDays * 86_400_000;
  }
  if (!storedIsValid(stored)) stored = null;

  function isGranted(cat: Category): boolean {
    if (cat === 'necessary' || boot!.exempt.includes(cat)) return true;
    if (stored) return stored.c.includes(cat);
    if (boot!.model === 'opt-out') return !(cat === 'marketing' && gpc);
    return false;
  }
  const grantedList = () => ALL.filter(isGranted);

  // ------------------------------------------------------- Google Consent Mode v2
  function gtag(..._args: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    (window.dataLayer = window.dataLayer || []).push(arguments);
  }
  function consentModeState() {
    const g = (c: Category) => (isGranted(c) ? 'granted' : 'denied');
    return {
      ad_storage: g('marketing'),
      ad_user_data: g('marketing'),
      ad_personalization: g('marketing'),
      analytics_storage: g('statistics'),
      functionality_storage: g('preferences'),
      personalization_storage: g('preferences'),
      security_storage: 'granted',
    };
  }
  gtag('consent', 'default', { ...consentModeState(), wait_for_update: 500 });
  gtag('set', 'ads_data_redaction', !isGranted('marketing'));

  // ------------------------------------------------------------- script blocking
  function ruleFor(src: string): Category | null {
    if (!boot!.autoBlock || !src) return null;
    let u: URL;
    try {
      u = new URL(src, location.href);
    } catch {
      return null;
    }
    const host = u.hostname;
    for (const r of boot!.blockRules) {
      if ((host === r.host || host.endsWith('.' + r.host)) && (!r.path || u.pathname.includes(r.path))) return r.category;
    }
    return null;
  }

  // True while the banner stays hidden because nothing on the site needs consent.
  let quiet = false;
  /** Something that needs consent turned up after all (e.g. a tag manager added a tracker): ask. */
  function consentNowNeeded(cat: Category) {
    askAbout([cat]);
    if (!quiet) return;
    quiet = false;
    if (!config) return;
    if (stored) showFab();
    else showBanner();
  }

  function blockScript(el: HTMLScriptElement, cat: Category) {
    consentNowNeeded(cat);
    el.setAttribute('data-oc-category', cat);
    el.setAttribute('data-oc-type', el.getAttribute('type') || '');
    el.setAttribute('data-oc-auto', '');
    // setAttribute, not .type: the patched .type setter would store the value instead of applying it.
    el.setAttribute('type', 'text/plain');
  }

  function blockIframe(el: HTMLIFrameElement, cat: Category) {
    const src = el.getAttribute('src');
    if (!src || src === 'about:blank') return;
    consentNowNeeded(cat);
    el.setAttribute('data-oc-category', cat);
    el.setAttribute('data-oc-src', src);
    el.setAttribute('src', 'about:blank');
    placeholderFor(el, cat);
  }

  function inspect(node: Node) {
    if (node instanceof HTMLScriptElement) {
      if (node.hasAttribute('data-oc-category')) return;
      const cat = ruleFor(node.src);
      if (cat && !isGranted(cat)) blockScript(node, cat);
    } else if (node instanceof HTMLIFrameElement) {
      const manual = node.getAttribute('data-oc-category') as Category | null;
      if (manual && node.hasAttribute('data-oc-src')) {
        if (!isGranted(manual)) placeholderFor(node, manual);
        return;
      }
      const cat = ruleFor(node.getAttribute('src') || '');
      if (cat && !isGranted(cat)) blockIframe(node, cat);
    }
  }

  // Parser-inserted elements.
  new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach((n) => {
        inspect(n);
        if (n instanceof Element) n.querySelectorAll('script,iframe').forEach(inspect);
      });
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Firefox fires this event; cancelling it is the most reliable block there.
  document.addEventListener('beforescriptexecute', (e) => {
    const t = e.target as HTMLScriptElement;
    if (t.getAttribute('type') === 'text/plain') e.preventDefault();
  });

  // Script-inserted elements (document.createElement('script') + .src = ...).
  const scriptSrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src')!;
  const scriptType = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'type')!;
  const origCreate = document.createElement.bind(document) as (t: string, o?: ElementCreationOptions) => HTMLElement;
  document.createElement = function (tag: string, opts?: ElementCreationOptions) {
    const el = origCreate(tag, opts);
    if (String(tag).toLowerCase() === 'script') {
      Object.defineProperties(el, {
        src: {
          configurable: true,
          get() {
            return scriptSrc.get!.call(this);
          },
          set(v: string) {
            const cat = ruleFor(String(v));
            if (cat && !isGranted(cat)) blockScript(el as HTMLScriptElement, cat);
            scriptSrc.set!.call(this, v);
          },
        },
        type: {
          configurable: true,
          get() {
            return scriptType.get!.call(this);
          },
          set(v: string) {
            if (el.hasAttribute('data-oc-category') && !isGranted(el.getAttribute('data-oc-category') as Category)) {
              el.setAttribute('data-oc-type', v);
            } else scriptType.set!.call(this, v);
          },
        },
      });
    }
    return el;
  } as typeof document.createElement;

  /** Activates every blocked element whose category is now granted. */
  function unblock() {
    document.querySelectorAll<HTMLElement>('[data-oc-category]').forEach((el) => {
      const cat = el.getAttribute('data-oc-category') as Category;
      if (!isGranted(cat)) return;
      if (el instanceof HTMLScriptElement && el.type === 'text/plain') {
        const s = origCreate('script') as HTMLScriptElement;
        for (const a of Array.from(el.attributes)) {
          if (a.name === 'type' || a.name.startsWith('data-oc-')) continue;
          s.setAttribute(a.name, a.value);
        }
        const t = el.getAttribute('data-oc-type');
        if (t && t !== 'text/plain') s.setAttribute('type', t);
        if (!el.src) s.text = el.text;
        else s.async = el.hasAttribute('async');
        s.setAttribute('data-oc-category', cat);
        el.replaceWith(s);
      } else if (el instanceof HTMLIFrameElement && el.hasAttribute('data-oc-src')) {
        el.setAttribute('src', el.getAttribute('data-oc-src')!);
        el.removeAttribute('data-oc-src');
        el.style.display = '';
        el.previousElementSibling?.matches('.oc-placeholder') && el.previousElementSibling.remove();
      }
    });
  }

  function placeholderFor(iframe: HTMLIFrameElement, cat: Category) {
    if (iframe.previousElementSibling?.matches('.oc-placeholder')) return;
    const box = origCreate('div');
    box.className = 'oc-placeholder';
    box.setAttribute('style', `display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;padding:16px;background:#f2f2f2;color:#222;border:1px solid #ccc;min-height:${iframe.height || 200}px;width:${iframe.width ? iframe.width + 'px' : '100%'};font:14px/1.4 system-ui,sans-serif`);
    box.setAttribute('data-oc-placeholder', cat);
    iframe.style.display = 'none';
    iframe.before(box);
    renderPlaceholders();
  }
  function renderPlaceholders() {
    if (!config) return;
    const t = config.texts;
    document.querySelectorAll<HTMLElement>('[data-oc-placeholder]').forEach((box) => {
      if (box.childElementCount) return;
      const cat = box.getAttribute('data-oc-placeholder') as Category;
      const p = origCreate('p');
      p.textContent = `${t.categories[cat].label}: ${t.categories[cat].description}`;
      const b = origCreate('button') as HTMLButtonElement;
      b.type = 'button';
      b.textContent = `${t.acceptAll.split(' ')[0]} — ${t.categories[cat].label}`;
      b.addEventListener('click', () => save(uniq([...grantedList(), cat]), 'custom'));
      box.append(p, b);
    });
  }

  // ----------------------------------------------------------------- storage
  function readStored(): Stored | null {
    const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
    if (!m) return null;
    try {
      const s = JSON.parse(atob(m[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as Stored;
      return s && Array.isArray(s.c) ? s : null;
    } catch {
      return null;
    }
  }
  function writeStored(s: Stored) {
    const val = btoa(JSON.stringify(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const days = s.c.every((c) => boot!.exempt.includes(c)) ? boot!.refusalReaskDays : boot!.consentMaxAgeDays;
    document.cookie = `${COOKIE}=${val}; Path=/; Max-Age=${Math.round(days * 86400)}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  }
  function deleteCookies(names: string[]) {
    const parts = location.hostname.split('.');
    const domains = [''];
    for (let i = 0; i < parts.length - 1; i++) domains.push('; Domain=.' + parts.slice(i).join('.'));
    for (const name of names) {
      for (const d of domains) document.cookie = `${name}=; Path=/; Max-Age=0${d}`;
      try {
        localStorage.removeItem(name);
        sessionStorage.removeItem(name);
      } catch {
        /* storage blocked */
      }
    }
  }
  function newId() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ------------------------------------------------------------------ consent
  function save(categories: Category[], action: Action) {
    const before = grantedList();
    const c = uniq<Category>(['necessary', ...boot!.exempt, ...categories.filter((x) => ALL.includes(x))]);
    const next: Stored = { id: stored?.id || readStored()?.id || newId(), v: boot!.policyVersion, c, t: Date.now(), a: action, m: boot!.model };
    stored = next;
    writeStored(next);
    log(next);
    gtag('consent', 'update', consentModeState());
    gtag('set', 'ads_data_redaction', !isGranted('marketing'));
    const revoked = before.filter((x) => !isGranted(x));
    closeUi();
    showFab();
    listeners.forEach((cb) => cb(grantedList()));
    window.dispatchEvent(new CustomEvent('opencookie:change', { detail: { granted: grantedList(), action } }));
    if (revoked.length) {
      // Scripts that already ran cannot be unloaded: remove their cookies and reload.
      deleteCookies(revoked.flatMap((r) => boot!.cookieNames[r] ?? []));
      location.reload();
      return;
    }
    unblock();
  }
  function log(s: Stored) {
    const body = JSON.stringify({ id: s.id, action: s.a, categories: s.c, policyVersion: s.v, pack: boot!.pack, locale: config?.locale ?? '', gpc, url: location.href.split('?')[0] });
    const url = `${boot!.api}/api/v1/sites/${boot!.key}/consent`;
    const blob = new Blob([body], { type: 'text/plain' });
    if (!navigator.sendBeacon?.(url, blob)) fetch(url, { method: 'POST', body, keepalive: true, mode: 'cors' }).catch(() => {});
  }
  const acceptAll = () => save(config?.categories ?? ALL, 'accept_all');
  const rejectAll = () => save([], 'reject_all');

  // ----------------------------------------------------------------------- UI
  let host: HTMLElement | null = null;
  let root: ShadowRoot | null = null;
  let returnFocus: HTMLElement | null = null;

  function ensureRoot(): ShadowRoot {
    if (root) return root;
    host = origCreate('div');
    host.id = 'opencookie';
    root = host.attachShadow({ mode: 'open' });
    const style = origCreate('style');
    style.textContent = css(config!.theme);
    root.append(style);
    document.body.append(host);
    return root;
  }
  function closeUi() {
    root?.querySelectorAll('.oc-banner,.oc-dialog,.oc-overlay').forEach((n) => n.remove());
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }
  function el(html: string): HTMLElement {
    const t = origCreate('template') as HTMLTemplateElement;
    t.innerHTML = html.trim();
    return t.content.firstElementChild as HTMLElement;
  }
  function bodyWithLink(text: string) {
    const t = config!.texts;
    const link = config!.privacyPolicyUrl ? `<a href="${esc(config!.privacyPolicyUrl)}">${esc(t.policyLinkText)}</a>` : esc(t.policyLinkText);
    return esc(text).replace('{policyLink}', link);
  }

  function showBanner() {
    if (!config) return;
    const r = ensureRoot();
    closeUi();
    const t = config.texts;
    const optOut = config.model === 'opt-out';
    const b = el(`
      <div class="oc oc-banner oc-pos-${config.theme.position}" role="dialog" aria-modal="false" aria-labelledby="oc-title" aria-describedby="oc-body" tabindex="-1" lang="${esc(config.locale)}">
        <div class="oc-inner">
        <div class="oc-text">
        <h2 id="oc-title">${esc(optOut ? t.optOutTitle : t.title)}</h2>
        ${gpc ? `<p class="oc-notice">${esc(t.gpcHonored)}</p>` : ''}
        <p id="oc-body">${bodyWithLink(optOut ? t.optOutBody : t.body)}</p>
        </div>
        <div class="oc-actions">
          ${optOut
            ? `<button type="button" class="oc-btn" data-act="optout">${esc(t.optOutButton)}</button>
               <button type="button" class="oc-btn" data-act="accept">${esc(t.okButton)}</button>`
            : `<button type="button" class="oc-btn" data-act="reject">${esc(t.rejectAll)}</button>
               <button type="button" class="oc-btn" data-act="accept">${esc(t.acceptAll)}</button>`}
          <button type="button" class="${config.theme.position === 'bottom' ? 'oc-textlink' : 'oc-btn oc-btn-link'}" data-act="settings">${esc(t.customize)}</button>
        </div>
        </div>
      </div>`);
    b.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
      if (act === 'accept') acceptAll();
      else if (act === 'reject') rejectAll();
      else if (act === 'optout') save(grantedList().filter((c) => c !== 'marketing'), 'opt_out');
      else if (act === 'settings') showSettings();
    });
    r.append(b);
    hideFab();
    b.focus({ preventScroll: true });
  }

  function showSettings() {
    if (!config) return;
    const r = ensureRoot();
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== host) returnFocus = active;
    r.querySelectorAll('.oc-banner,.oc-dialog,.oc-overlay').forEach((n) => n.remove());
    const t = config.texts;
    const d = t.declaration;
    const cats = config.categories.map((cat) => {
      const exempt = cat === 'necessary' || config!.exempt.includes(cat);
      const checked = exempt || isGranted(cat);
      const rows = config!.cookies[cat];
      const table = rows.length
        ? `<details><summary>${esc(d.showCookies)} (${rows.length})</summary><table>
             <thead><tr><th scope="col">${esc(d.name)}</th><th scope="col">${esc(d.provider)}</th><th scope="col">${esc(d.purpose)}</th><th scope="col">${esc(d.expiry)}</th></tr></thead>
             <tbody>${rows.map((c) => `<tr><td><code>${esc(c.name)}</code></td><td>${esc(c.provider)}</td><td>${esc(c.purpose)}</td><td>${esc(c.expiry)}</td></tr>`).join('')}</tbody>
           </table></details>`
        : '';
      return `
        <div class="oc-cat">
          <div class="oc-cat-head">
            <h3 id="oc-cat-${cat}">${esc(t.categories[cat].label)}</h3>
            ${exempt
              ? `<span class="oc-always">${esc(t.alwaysActive)}</span>`
              : `<label class="oc-switch"><input type="checkbox" role="switch" data-cat="${cat}" aria-labelledby="oc-cat-${cat}" ${checked ? 'checked' : ''}><span aria-hidden="true"></span></label>`}
          </div>
          <p>${esc(t.categories[cat].description)}</p>
          ${table}
        </div>`;
    }).join('');
    const overlay = el(`<div class="oc-overlay"></div>`);
    const dlg = el(`
      <div class="oc oc-dialog" role="dialog" aria-modal="true" aria-labelledby="oc-s-title" lang="${esc(config.locale)}">
        <button type="button" class="oc-close" data-act="close" aria-label="${esc(t.close)}">×</button>
        <h2 id="oc-s-title">${esc(t.settingsTitle)}</h2>
        ${gpc ? `<p class="oc-notice">${esc(t.gpcHonored)}</p>` : ''}
        <p>${esc(t.settingsBody)}</p>
        ${cats}
        <div class="oc-actions">
          <button type="button" class="oc-btn" data-act="reject">${esc(t.rejectAll)}</button>
          <button type="button" class="oc-btn" data-act="accept">${esc(t.acceptAll)}</button>
          <button type="button" class="oc-btn oc-btn-link" data-act="save">${esc(t.save)}</button>
        </div>
      </div>`);
    const close = () => {
      closeUi();
      if (stored) showFab();
      else if (!quiet) showBanner();
    };
    dlg.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
      if (act === 'accept') acceptAll();
      else if (act === 'reject') rejectAll();
      else if (act === 'close') close();
      else if (act === 'save') {
        const chosen = Array.from(dlg.querySelectorAll<HTMLInputElement>('input[data-cat]')).filter((i) => i.checked).map((i) => i.dataset.cat as Category);
        save(chosen, 'custom');
      }
    });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const f = Array.from(dlg.querySelectorAll<HTMLElement>('button,input,summary,a[href]'));
        const first = f[0]!;
        const last = f[f.length - 1]!;
        const cur = root!.activeElement;
        if (e.shiftKey && cur === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && cur === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    r.append(overlay, dlg);
    hideFab();
    (dlg.querySelector('.oc-close') as HTMLElement).focus();
  }

  function showGpcConfirmation() {
    if (!config) return;
    const r = ensureRoot();
    const b = el(`
      <div class="oc oc-banner oc-pos-bottom-left" role="status" lang="${esc(config.locale)}">
        <p>${esc(config.texts.gpcHonored)}</p>
        <div class="oc-actions"><button type="button" class="oc-btn" data-act="ok">${esc(config.texts.okButton)}</button></div>
      </div>`);
    b.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act]')) {
        b.remove();
        showFab();
      }
    });
    r.append(b);
  }

  function showFab() {
    // Off when the site owner offers their own link (data-oc-open) or the policy block instead.
    if (!config || quiet || config.theme.floatingButton === false) return;
    const r = ensureRoot();
    if (r.querySelector('.oc-fab')) return;
    const label = config.texts.withdrawButton;
    const fab = el(`
      <button type="button" class="oc-fab" aria-label="${esc(label)}" title="${esc(label)}">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5zm-3.5 6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm-7 1a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/></svg>
      </button>`);
    fab.addEventListener('click', showSettings);
    r.append(fab);
  }
  function hideFab() {
    root?.querySelector('.oc-fab')?.remove();
  }

  // Cookie declaration on the site's cookie policy page: <div data-oc-declaration></div>
  function renderDeclarations() {
    if (!config) return;
    const t = config.texts;
    const d = t.declaration;
    document.querySelectorAll<HTMLElement>('[data-oc-declaration]').forEach((box) => {
      box.innerHTML = ALL.map((cat) => {
        const rows = config!.cookies[cat];
        return `<h3>${esc(t.categories[cat].label)}</h3><p>${esc(t.categories[cat].description)}</p>` +
          (rows.length
            ? `<table><thead><tr><th scope="col">${esc(d.name)}</th><th scope="col">${esc(d.provider)}</th><th scope="col">${esc(d.purpose)}</th><th scope="col">${esc(d.expiry)}</th></tr></thead><tbody>` +
              rows.map((c) => `<tr><td><code>${esc(c.name)}</code></td><td>${esc(c.provider)}</td><td>${esc(c.purpose)}</td><td>${esc(c.expiry)}</td></tr>`).join('') +
              '</tbody></table>'
            : `<p><em>${esc(d.noCookies)}</em></p>`);
      }).join('') +
        (config!.lastScanned ? `<p><small>${esc(d.lastScanned)}: ${new Date(config!.lastScanned).toLocaleDateString(config!.locale)}</small></p>` : '') +
        `<p><button type="button" data-oc-open>${esc(d.changeSettings)}</button></p>`;
    });
  }

  // The whole cookie policy, in the site's own styles: <div data-oc-policy></div>
  function renderPolicies() {
    const boxes = document.querySelectorAll<HTMLElement>('[data-oc-policy]');
    if (!boxes.length || !config || !boot) return;
    fetch(`${boot.api}/api/v1/sites/${boot.key}/policy?format=fragment&lang=${encodeURIComponent(config.locale)}`)
      .then((r) => (r.ok ? r.text() : ''))
      .then((html) => {
        // Server-rendered from the site's settings, with every value escaped.
        if (html) boxes.forEach((box) => (box.innerHTML = html));
      })
      .catch(() => {});
  }

  // Any element with data-oc-open (e.g. a footer link) opens the settings.
  document.addEventListener('click', (e) => {
    const t = (e.target as Element | null)?.closest?.('[data-oc-open]');
    if (t) {
      e.preventDefault();
      showSettings();
    }
  });

  // -------------------------------------------------------------------- start
  const api: Api = {
    version: '0.1.0',
    getConsent: () => stored,
    hasConsent: isGranted,
    acceptAll,
    rejectAll,
    show: () => showBanner(),
    showSettings: () => showSettings(),
    onChange: (cb) => listeners.push(cb),
  };
  window.OpenCookie = api;

  const lang = document.documentElement.lang || navigator.language || '';
  const configReady = fetch(`${boot.api}/api/v1/sites/${boot.key}/config?lang=${encodeURIComponent(lang)}&pack=${encodeURIComponent(boot.pack)}`)
    .then((r) => (r.ok ? (r.json() as Promise<BannerConfig>) : null))
    .catch(() => null);

  const domReady = new Promise<void>((res) =>
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', () => res(), { once: true }) : res(),
  );

  if (stored) unblock();
  else if (boot.model === 'opt-out') unblock();

  void Promise.all([configReady, domReady]).then(([cfg]) => {
    unblock(); // pick up elements tagged by hand after the parser finished
    if (!cfg) return;
    config = cfg;
    renderPlaceholders();
    renderDeclarations();
    renderPolicies();
    // Only necessary cookies: no banner and no settings button. Links with data-oc-open still work.
    askAbout(waitingCategories());
    quiet = !cfg.consentNeeded && !pageWaitsForConsent();
    if (stored) {
      showFab();
    } else if (cfg.model === 'opt-out' && gpc) {
      save(grantedList().filter((c) => c !== 'marketing'), 'gpc');
      if (cfg.showGpcConfirmation) showGpcConfirmation();
    } else if (!quiet) {
      showBanner();
    }
  });

  /** Categories of scripts or embeds on this page that are held back for consent. */
  function waitingCategories(): Category[] {
    return Array.from(document.querySelectorAll('[data-oc-category]'))
      .map((el) => el.getAttribute('data-oc-category') as Category)
      .filter((c) => ALL.includes(c) && !isGranted(c));
  }
  function pageWaitsForConsent(): boolean {
    return waitingCategories().length > 0;
  }
  /**
   * The banner offers the categories the scan found. Something on the page held back for another
   * category (a tag added after the last scan) must be offered too, or "Accept all" could never run it.
   */
  function askAbout(cats: Category[]) {
    if (!config) return;
    const missing = cats.filter((c) => !config!.categories.includes(c));
    if (missing.length) config.categories = ALL.filter((c) => config!.categories.includes(c) || missing.includes(c));
  }

  function uniq<T>(a: T[]): T[] {
    return [...new Set(a)];
  }
  function esc(s: string): string {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  }
})();
