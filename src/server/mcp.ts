/**
 * Remote MCP server (Streamable HTTP, stateless, JSON responses) at POST /mcp.
 *
 * People connect with a personal access token from their account page:
 *   Authorization: Bearer oc_pat_…
 * Every tool calls the same admin API the dashboard uses, as that person, so the
 * client scoping, roles, token limits and audit log all apply unchanged.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from './config.ts';

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const SERVER_VERSION = '0.2.0';

type Json = Record<string, unknown>;
type Call = (method: string, path: string, body?: unknown) => Promise<unknown>;
interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  write?: boolean;
  run: (args: Json, call: Call) => Promise<unknown>;
}

class ToolError extends Error {}

const id = (desc: string) => ({ type: 'integer', minimum: 1, description: desc });
const siteArg = { siteId: id('Site id, from list_sites.') };
const num = (v: unknown, name: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new ToolError(`${name} must be a positive whole number.`);
  return n;
};

const TOOLS: Tool[] = [
  {
    name: 'list_clients',
    title: 'List clients',
    description: 'Clients (organisations) you have access to, with your role, number of sites and people.',
    inputSchema: { type: 'object', properties: {} },
    run: (_a, call) => call('GET', '/orgs'),
  },
  {
    name: 'list_sites',
    title: 'List sites',
    description: 'Sites you have access to, with rule pack, number of cookies and last scan. Optionally only those of one client.',
    inputSchema: { type: 'object', properties: { clientId: id('Only sites of this client.') } },
    run: async (a, call) => {
      const sites = (await call('GET', '/sites')) as Json[];
      return a.clientId ? sites.filter((s) => s.orgId === Number(a.clientId)) : sites;
    },
  },
  {
    name: 'get_site',
    title: 'Get a site',
    description: 'All settings of one site, plus the snippet to paste into its <head> and the hosted cookie policy URL.',
    inputSchema: { type: 'object', properties: siteArg, required: ['siteId'] },
    run: async (a, call) => {
      const sid = num(a.siteId, 'siteId');
      const [site, embed] = await Promise.all([call('GET', `/sites/${sid}`), call('GET', `/sites/${sid}/embed`)]);
      return { site, embed };
    },
  },
  {
    name: 'check_compliance',
    title: 'Check compliance',
    description: "Runs the compliance check of a site against its rule pack (e.g. Dutch AP, CNIL). Returns problems and warnings with what to do about them.",
    inputSchema: { type: 'object', properties: siteArg, required: ['siteId'] },
    run: (a, call) => call('GET', `/sites/${num(a.siteId, 'siteId')}/compliance`),
  },
  {
    name: 'list_cookies',
    title: 'List cookies',
    description: 'Cookies and storage items of a site, with category, provider, purpose and retention.',
    inputSchema: { type: 'object', properties: siteArg, required: ['siteId'] },
    run: (a, call) => call('GET', `/sites/${num(a.siteId, 'siteId')}/cookies`),
  },
  {
    name: 'list_scans',
    title: 'List scans',
    description: 'Recent cookie scans of a site with their status, pages scanned and errors.',
    inputSchema: { type: 'object', properties: siteArg, required: ['siteId'] },
    run: async (a, call) => ((await call('GET', `/sites/${num(a.siteId, 'siteId')}/scans`)) as unknown[]).slice(0, 10),
  },
  {
    name: 'consent_stats',
    title: 'Consent statistics',
    description: 'How visitors answered the banner: totals and per day, for all your clients, one client, over a number of days.',
    inputSchema: {
      type: 'object',
      properties: { clientId: id('Only this client.'), days: { type: 'integer', enum: [7, 30, 90, 365], description: 'Period, default 30.' } },
    },
    run: (a, call) => call('GET', `/stats?days=${[7, 30, 90, 365].includes(Number(a.days)) ? Number(a.days) : 30}${a.clientId ? `&orgId=${num(a.clientId, 'clientId')}` : ''}`),
  },
  {
    name: 'list_rule_packs',
    title: 'List rule packs',
    description: 'The country rule packs a site can follow, and the languages the banner supports.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_a, call) => {
      const m = (await call('GET', '/meta')) as Json;
      return { rulePacks: (m.rulePacks as Json[]).map((p) => ({ id: p.id, name: p.name, model: p.model })), languages: m.locales, categories: m.categories };
    },
  },
  {
    name: 'scan_site',
    title: 'Scan a site',
    description: 'Starts a new cookie scan. It visits pages of the site in a real browser and updates the cookie list; check list_scans after a minute or two.',
    inputSchema: { type: 'object', properties: siteArg, required: ['siteId'] },
    write: true,
    run: (a, call) => call('POST', `/sites/${num(a.siteId, 'siteId')}/scans`, {}),
  },
  {
    name: 'add_site',
    title: 'Add a site',
    description: 'Adds a site to a client (you must be an owner of that client). A first cookie scan starts automatically (scanId in the result; see list_scans). Returns the new site; use get_site for its snippet.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: id('Client to add the site to.'),
        domain: { type: 'string', description: 'Domain without https://, e.g. example.nl' },
        name: { type: 'string', description: 'Name shown in the dashboard. Defaults to the domain.' },
        rulePack: { type: 'string', description: 'Rule pack id from list_rule_packs. Default nl-ap.' },
        languages: { type: 'array', items: { type: 'string' }, description: 'Banner languages, first is the default. Default ["nl","en"].' },
      },
      required: ['clientId', 'domain'],
    },
    write: true,
    run: (a, call) => {
      const domain = String(a.domain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const langs = Array.isArray(a.languages) && a.languages.length ? a.languages.map(String) : ['nl', 'en'];
      return call('POST', '/sites', {
        orgId: num(a.clientId, 'clientId'), domain, name: String(a.name ?? '').trim() || domain,
        rulePack: typeof a.rulePack === 'string' ? a.rulePack : 'nl-ap', defaultLocale: langs[0], locales: langs,
      });
    },
  },
  {
    name: 'update_site',
    title: 'Change site settings',
    description: 'Changes settings of a site. Only the fields you pass change. Changing the rule pack, texts or categories asks visitors for consent again.',
    inputSchema: {
      type: 'object',
      properties: {
        ...siteArg,
        name: { type: 'string' },
        rulePack: { type: 'string', description: 'Rule pack id from list_rule_packs.' },
        languages: { type: 'array', items: { type: 'string' }, description: 'Banner languages.' },
        defaultLanguage: { type: 'string' },
        privacyPolicyUrl: { type: 'string', description: 'URL of the cookie or privacy policy linked from the banner.' },
        contact: { type: 'string', description: 'Privacy contact shown in the cookie policy.' },
        autoBlock: { type: 'boolean', description: 'Block known trackers until consent.' },
        consentMode: { type: 'boolean', description: 'Google Consent Mode v2 instead of blocking Google tags.' },
        layout: { type: 'string', enum: ['bottom', 'bottom-left', 'center'], description: 'Bar at the bottom, box bottom left, or popup in the centre.' },
        buttonColour: { type: 'string', description: 'Hex colour such as #1a1a1a. Accept and Reject always share it.' },
        backgroundColour: { type: 'string' },
        textColour: { type: 'string' },
      },
      required: ['siteId'],
    },
    write: true,
    run: async (a, call) => {
      const sid = num(a.siteId, 'siteId');
      const cur = (await call('GET', `/sites/${sid}`)) as { theme: Json };
      const patch: Json = {};
      for (const k of ['name', 'rulePack', 'privacyPolicyUrl', 'contact', 'autoBlock', 'consentMode'] as const) if (a[k] !== undefined) patch[k] = a[k];
      if (a.languages !== undefined) patch.locales = a.languages;
      if (a.defaultLanguage !== undefined) patch.defaultLocale = a.defaultLanguage;
      if (a.layout !== undefined || a.buttonColour !== undefined || a.backgroundColour !== undefined || a.textColour !== undefined) {
        patch.theme = {
          ...cur.theme,
          ...(a.layout !== undefined && { position: a.layout }),
          ...(a.buttonColour !== undefined && { primary: a.buttonColour }),
          ...(a.backgroundColour !== undefined && { background: a.backgroundColour }),
          ...(a.textColour !== undefined && { text: a.textColour }),
        };
      }
      if (!Object.keys(patch).length) throw new ToolError('Pass at least one setting to change.');
      return call('PUT', `/sites/${sid}`, patch);
    },
  },
  {
    name: 'add_cookie',
    title: 'Add a cookie',
    description: 'Declares a cookie or storage item the scanner cannot see (e.g. set only after login or consent).',
    inputSchema: {
      type: 'object',
      properties: {
        ...siteArg,
        name: { type: 'string' },
        category: { type: 'string', enum: ['necessary', 'preferences', 'statistics', 'marketing'] },
        provider: { type: 'string' },
        purpose: { type: 'string', description: 'What it does, in plain words.' },
        retention: { type: 'string', description: 'How long it is kept, e.g. "1 year".' },
        domain: { type: 'string' },
        kind: { type: 'string', enum: ['cookie', 'localStorage', 'sessionStorage'] },
      },
      required: ['siteId', 'name', 'category'],
    },
    write: true,
    run: (a, call) =>
      call('POST', `/sites/${num(a.siteId, 'siteId')}/cookies`, {
        name: a.name, category: a.category, provider: a.provider ?? '', description: a.purpose ?? '', retention: a.retention ?? '', domain: a.domain ?? '', kind: a.kind ?? 'cookie',
      }),
  },
  {
    name: 'update_cookie',
    title: 'Change a cookie',
    description: 'Changes the category, provider, purpose or retention of a cookie. A new category asks visitors for consent again.',
    inputSchema: {
      type: 'object',
      properties: {
        ...siteArg,
        cookieId: id('Cookie id, from list_cookies.'),
        category: { type: 'string', enum: ['necessary', 'preferences', 'statistics', 'marketing'] },
        provider: { type: 'string' },
        purpose: { type: 'string' },
        retention: { type: 'string' },
      },
      required: ['siteId', 'cookieId'],
    },
    write: true,
    run: (a, call) =>
      call('PUT', `/sites/${num(a.siteId, 'siteId')}/cookies/${num(a.cookieId, 'cookieId')}`, {
        category: a.category, provider: a.provider, description: a.purpose, retention: a.retention,
      }),
  },
];

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export function registerMcp(app: FastifyInstance) {
  const handle = async (req: FastifyRequest, msg: Json): Promise<Json | null> => {
    const { id, method } = msg;
    const params = (msg.params ?? {}) as Json;
    if (msg.jsonrpc !== '2.0' || typeof method !== 'string') return rpcError(id, -32600, 'Invalid request');
    if (id === undefined) return null; // notification (e.g. notifications/initialized): nothing to answer

    // Ask the admin API for who this is; this also checks the token.
    const call: Call = async (m, path, body) => {
      const r = await app.inject({
        method: m as 'GET',
        url: `/admin/api${path}`,
        headers: { authorization: String(req.headers.authorization ?? ''), 'content-type': 'application/json', 'user-agent': `mcp: ${req.headers['user-agent'] ?? ''}` },
        remoteAddress: req.ip,
        ...(body !== undefined && { payload: JSON.stringify(body) }),
      });
      const data = r.body ? JSON.parse(r.body) : null;
      if (r.statusCode >= 400) throw new ToolError(data?.error ?? `Request failed (${r.statusCode})`);
      return data;
    };

    switch (method) {
      case 'initialize': {
        const asked = String(params.protocolVersion ?? '');
        return {
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'opencookie', title: config.appName, version: SERVER_VERSION },
            instructions:
              `${config.appName} manages cookie banners, cookie scans and consent logs for websites. ` +
              'Start with list_clients or list_sites. Use check_compliance to find what a site still needs. ' +
              'You only see the clients your account belongs to; write tools need a read-and-write token and the editor or owner role.',
          },
        };
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list': {
        const me = (await call('GET', '/me').catch(() => null)) as Json | null;
        const canWrite = !!me?.tokenCanWrite;
        return {
          jsonrpc: '2.0', id,
          result: {
            tools: TOOLS.filter((t) => canWrite || !t.write).map((t) => ({
              name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
              annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: t.name === 'scan_site' },
            })),
          },
        };
      }
      case 'tools/call': {
        const tool = TOOLS.find((t) => t.name === params.name);
        if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(params.name)}`);
        try {
          const out = await tool.run((params.arguments ?? {}) as Json, call);
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: Array.isArray(out) ? { items: out } : (out as Json) } };
        } catch (e) {
          if (!(e instanceof ToolError)) app.log.error(e);
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e instanceof ToolError ? e.message : 'Server error' }], isError: true } };
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  };

  app.post('/mcp', async (req, reply) => {
    // Check the token up front so clients get a proper 401 instead of a tool error.
    const probe = await app.inject({ method: 'GET', url: '/admin/api/me', headers: { authorization: String(req.headers.authorization ?? '') }, remoteAddress: req.ip });
    if (!/^Bearer\s+oc_pat_/i.test(String(req.headers.authorization ?? '')) || probe.statusCode === 401) {
      return reply.code(401).header('WWW-Authenticate', 'Bearer realm="OpenCookie"').send({ error: 'Send a personal access token: Authorization: Bearer oc_pat_… (create one under Your account → Access tokens).' });
    }
    if (probe.statusCode === 429) return reply.code(429).send(JSON.parse(probe.body));
    const body = req.body as Json | Json[] | undefined;
    if (!body || typeof body !== 'object') return reply.code(400).send(rpcError(null, -32700, 'Parse error'));
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handle(req, m)))).filter(Boolean);
      return out.length ? reply.send(out) : reply.code(202).send();
    }
    const out = await handle(req, body);
    return out ? reply.header('content-type', 'application/json').send(out) : reply.code(202).send();
  });
  // Stateless server: no server-to-client stream and no sessions to end.
  app.get('/mcp', async (_req, reply) => reply.code(405).header('Allow', 'POST').send({ error: 'Use POST' }));
  app.delete('/mcp', async (_req, reply) => reply.code(405).header('Allow', 'POST').send({ error: 'Use POST' }));
}
