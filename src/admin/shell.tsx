import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

// ------------------------------------------------------------------- icons
const paths: Record<string, string> = {
  dashboard: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z',
  sites: 'M3 5h18v14H3zM3 9h18M7 7h.01M10 7h.01',
  team: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.87M16 3.13a3.5 3.5 0 0 1 0 6.75',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  clients: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01',
  users: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  chevrons: 'M7 15l5 5 5-5M7 9l5-5 5 5',
  check: 'M20 6 9 17l-5-5',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  menu: 'M3 6h18M3 12h18M3 18h18',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
};
export function Icon({ name, size = 18 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ''} />
    </svg>
  );
}

/** The product mark: a cookie with a bite out of it. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3a13 13 0 1 0 13 13 5 5 0 0 1-5-5 5 5 0 0 1-5-5 3 3 0 0 1-3-3z" fill="#d9a35b" />
      <circle cx="11" cy="13" r="1.8" fill="#5b3a17" /><circle cx="18" cy="20" r="2" fill="#5b3a17" /><circle cx="11" cy="21" r="1.4" fill="#5b3a17" /><circle cx="22" cy="14" r="1.2" fill="#5b3a17" />
    </svg>
  );
}

// ----------------------------------------------------------------- avatars
const AVATAR_COLOURS = ['#3f4fc4', '#1f7a6b', '#8a4fb8', '#b5532f', '#2b6cb0', '#6b7d1f', '#b03f6b', '#4b5563'];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const initials = (name: string, email = '') => {
  const src = name.trim() || email.split('@')[0]!.replace(/[._-]+/g, ' ');
  const parts = src.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase();
};

/** Initials on a colour picked from the email; a Gravatar photo on top when the server allows it and one exists. */
export function Avatar({ name, email, url, size = '' }: { name: string; email: string; url?: string | null; size?: '' | 'sm' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  return (
    <span class={`avatar ${size}`} style={`background:${AVATAR_COLOURS[hash(email.toLowerCase()) % AVATAR_COLOURS.length]}`} aria-hidden="true">
      {url && !failed ? <img src={url} alt="" referrerpolicy="no-referrer" onError={() => setFailed(true)} /> : initials(name, email)}
    </span>
  );
}

/** Square tile for a client in the switcher. */
function OrgTile({ name, all }: { name: string; all?: boolean }) {
  return (
    <span class="orgtile" style={all ? '' : `background:${AVATAR_COLOURS[hash(name) % AVATAR_COLOURS.length]}`} aria-hidden="true">
      {all ? <Icon name="globe" size={15} /> : initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------- switcher
export interface ScopeOrg { id: number; name: string; role: string | null; siteCount?: number }

/** Client switcher: a custom listbox with search, keyboard support and an "All clients" entry for platform admins. */
export function Switcher({ orgs, current, allowAll, onSelect, footer }: {
  orgs: ScopeOrg[];
  current: number | 'all' | null;
  allowAll: boolean;
  onSelect: (v: number | 'all') => void;
  footer?: ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const items: { value: number | 'all'; label: string; sub?: string }[] = [
    ...(allowAll ? [{ value: 'all' as const, label: 'All clients', sub: `${orgs.length} client${orgs.length === 1 ? '' : 's'}` }] : []),
    ...orgs.map((o) => ({ value: o.id, label: o.name, sub: o.siteCount !== undefined ? `${o.siteCount} site${o.siteCount === 1 ? '' : 's'}` : undefined })),
  ].filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()));

  const cur = current === 'all' ? { label: 'All clients', all: true } : { label: orgs.find((o) => o.id === current)?.name ?? 'Choose a client', all: false };

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, items.findIndex((i) => i.value === current)));
    setTimeout(() => search.current?.focus(), 0);
    const onDoc = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const choose = (v: number | 'all') => {
    onSelect(v);
    setOpen(false);
    setQ('');
    button.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); button.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); choose(items[active]!.value); }
  };

  return (
    <div class="switcher" ref={root}>
      <button ref={button} type="button" class="switcher-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <OrgTile name={cur.label} all={cur.all} />
        <span class="switcher-label"><span class="switcher-kicker">Client</span>{cur.label}</span>
        <Icon name="chevrons" size={16} />
      </button>
      {open && (
        <div class="switcher-pop" onKeyDown={onKey}>
          {(orgs.length > 6 || q) && (
            <label class="switcher-search">
              <Icon name="search" size={15} />
              <input ref={search} placeholder="Find a client" value={q} onInput={(e) => { setQ(e.currentTarget.value); setActive(0); }} aria-label="Find a client" aria-controls="switcher-list" aria-activedescendant={items[active] ? `sw-${items[active]!.value}` : undefined} />
            </label>
          )}
          <ul id="switcher-list" role="listbox" aria-label="Clients" tabIndex={-1} ref={(el) => { if (el && !(orgs.length > 6 || q)) setTimeout(() => el.focus(), 0); }} aria-activedescendant={items[active] ? `sw-${items[active]!.value}` : undefined}>
            {items.map((i, idx) => (
              <li id={`sw-${i.value}`} role="option" aria-selected={i.value === current} class={idx === active ? 'active' : ''} onMouseEnter={() => setActive(idx)} onClick={() => choose(i.value)}>
                <OrgTile name={i.label} all={i.value === 'all'} />
                <span class="switcher-label">{i.label}{i.sub && <span class="switcher-kicker">{i.sub}</span>}</span>
                {i.value === current && <Icon name="check" size={16} />}
              </li>
            ))}
            {items.length === 0 && <li class="empty">No client matches “{q}”.</li>}
          </ul>
          {footer && <div class="switcher-foot" onClick={() => setOpen(false)}>{footer}</div>}
        </div>
      )}
    </div>
  );
}
