export class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/admin/api${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), 'X-Requested-With': 'opencookie-admin' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  const err = data as { error?: string; code?: string } | null;
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('oc-logout'));
  if (res.status === 403 && err?.code === 'MFA_ENROLMENT_REQUIRED') window.dispatchEvent(new Event('oc-enrol'));
  if (!res.ok) throw new HttpError(res.status, err?.error ?? res.statusText, err?.code);
  return data as T;
}

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
  platform: 'Platform admin',
};
export const ROLE_HELP: Record<string, string> = {
  owner: 'Everything: sites, team members and settings for this client.',
  editor: 'Edit sites, cookies, texts and run scans. Cannot delete sites or manage people.',
  viewer: 'Read only, including the consent log.',
};

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');

/** Very short description of a browser user agent for the sessions list. */
export function describeAgent(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
