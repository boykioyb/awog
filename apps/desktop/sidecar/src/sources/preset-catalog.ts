// Preset catalog of common providers for the "add a source" flow (UI-parity
// area 3). Mirrors Craft's "Common Providers" list (see craft-agents-oss
// apps/electron/resources/docs/sources.md): each entry is display metadata plus a
// builder that returns a ready-to-edit `SourceConfig` draft with the correct
// `mcp` / `api` / `local` block pre-filled (url / command / authType / baseUrl).
//
// SECURITY. A draft NEVER carries a real secret: stdio env vars that need a key
// are seeded EMPTY (the user sets them in the editor; the value lands in the OS
// keychain, invariant 1), and api credentials are entered write-only on Verify.
// The `id` on a draft is a placeholder the UI ignores — a new source's stable id
// is generated from the user-entered slug at save time.

import type { SourceConfig, SourceTrust, SourceType } from '../types/shared.js'

const DEFAULT_TIMEOUT_MS = 30000

// Display + routing metadata surfaced by `source.listPresets` and shown in the
// picker (SourceAvatar icon + name + tagline). `setupHint` is one line of
// provider-specific guidance shown in the editor once a preset seeds it.
export interface PresetMeta {
  id: string
  slug: string
  name: string
  provider: string
  type: SourceType
  tagline: string
  icon?: string
  setupHint?: string
}

// A ready-to-edit draft. Same shape as the on-disk config; the UI completes slug
// + secret before saving.
export type PresetDraft = SourceConfig

interface PresetEntry {
  meta: PresetMeta
  build: (m: PresetMeta) => PresetDraft
}

// Shared base fields for every kind's draft. `enabled` starts false for anything
// needing auth (the user connects/sets a key first) and true for auth-free kinds.
type PresetBase = {
  id: string
  slug: string
  name: string
  provider: string
  enabled: boolean
  tagline: string
  timeoutMs: number
  trust: SourceTrust
  icon?: string
}

function base(m: PresetMeta, enabled: boolean): PresetBase {
  const b: PresetBase = {
    id: m.id,
    slug: m.slug,
    name: m.name,
    provider: m.provider,
    enabled,
    tagline: m.tagline,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    trust: 'prompt',
  }
  if (m.icon) b.icon = m.icon
  return b
}

// Insertion order == picker order.
export const PRESET_CATALOG: Record<string, PresetEntry> = {
  linear: {
    meta: {
      id: 'linear',
      slug: 'linear',
      name: 'Linear',
      provider: 'linear',
      type: 'mcp',
      tagline: 'Issue tracking, sprint planning, and project management',
      icon: '📐',
      setupHint:
        'After saving, open the connection and click "Connect with OAuth" to sign in — no token to paste.',
    },
    build: (m) => ({
      ...base(m, false),
      type: 'mcp',
      mcp: { transport: 'http', url: 'https://mcp.linear.app', authType: 'oauth' },
    }),
  },

  github: {
    meta: {
      id: 'github',
      slug: 'github',
      name: 'GitHub',
      provider: 'github',
      type: 'mcp',
      tagline: 'Repositories, issues, pull requests, and code search',
      icon: '🐙',
      setupHint:
        'GitHub’s MCP needs a Personal Access Token (bearer) — OAuth will fail. Create one at github.com/settings/tokens, then add an "Authorization" header on Verify.',
    },
    build: (m) => ({
      ...base(m, false),
      type: 'mcp',
      mcp: { transport: 'http', url: 'https://api.githubcopilot.com/mcp/', authType: 'bearer' },
    }),
  },

  notion: {
    meta: {
      id: 'notion',
      slug: 'notion',
      name: 'Notion',
      provider: 'notion',
      type: 'mcp',
      tagline: 'Docs, wikis, and databases',
      icon: '📔',
      setupHint:
        'After saving, open the connection and click "Connect with OAuth" to authorize your Notion workspace.',
    },
    build: (m) => ({
      ...base(m, false),
      type: 'mcp',
      mcp: { transport: 'http', url: 'https://mcp.notion.com', authType: 'oauth' },
    }),
  },

  slack: {
    meta: {
      id: 'slack',
      slug: 'slack',
      name: 'Slack',
      provider: 'slack',
      type: 'mcp',
      tagline: 'Channels, messages, and files',
      icon: '💬',
      setupHint:
        'Connect via OAuth from the connection detail after saving. Verify the MCP URL against Slack’s current docs — provider-OAuth specifics vary.',
    },
    build: (m) => ({
      ...base(m, false),
      type: 'mcp',
      mcp: { transport: 'http', url: 'https://mcp.slack.com', authType: 'oauth' },
    }),
  },

  google: {
    meta: {
      id: 'google',
      slug: 'google',
      name: 'Google Workspace',
      provider: 'google',
      type: 'api',
      tagline: 'Gmail, Calendar, Drive, Docs, and Sheets',
      icon: '✉️',
      setupHint:
        'Google APIs need your own OAuth client credentials (Google Cloud Console). Pick the specific service + scopes after saving; OAuth specifics are configured separately.',
    },
    build: (m) => ({
      ...base(m, false),
      type: 'api',
      api: { baseUrl: 'https://www.googleapis.com/', authType: 'oauth' },
    }),
  },

  microsoft: {
    meta: {
      id: 'microsoft',
      slug: 'microsoft',
      name: 'Microsoft 365',
      provider: 'microsoft',
      type: 'api',
      tagline: 'Outlook, Calendar, OneDrive, Teams, and SharePoint',
      icon: '🪟',
      setupHint:
        'Microsoft Graph uses OAuth with your own app registration (Azure portal). Pick the specific service + scopes after saving.',
    },
    build: (m) => ({
      ...base(m, false),
      type: 'api',
      api: { baseUrl: 'https://graph.microsoft.com/v1.0/', authType: 'oauth' },
    }),
  },

  exa: {
    meta: {
      id: 'exa',
      slug: 'exa',
      name: 'Exa',
      provider: 'exa',
      type: 'api',
      tagline: 'Neural web search',
      icon: '🔍',
      setupHint: 'Paste your Exa API key on Verify. Get one at dashboard.exa.ai.',
    },
    build: (m) => ({
      ...base(m, false),
      type: 'api',
      api: {
        baseUrl: 'https://api.exa.ai/',
        authType: 'header',
        headerName: 'x-api-key',
        testEndpoint: { method: 'POST', path: 'search', body: { query: 'test', numResults: 1 } },
      },
    }),
  },

  brave: {
    meta: {
      id: 'brave',
      slug: 'brave-search',
      name: 'Brave Search',
      provider: 'brave',
      type: 'mcp',
      tagline: 'Web and local search via the Brave Search API',
      icon: '🦁',
      setupHint:
        'Set BRAVE_API_KEY in Env vars (stored in the OS keychain). Get a key at brave.com/search/api.',
    },
    build: (m) => ({
      ...base(m, false),
      type: 'mcp',
      mcp: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-brave-search'],
        env: { BRAVE_API_KEY: '' },
      },
    }),
  },

  memory: {
    meta: {
      id: 'memory',
      slug: 'memory',
      name: 'Memory',
      provider: 'memory',
      type: 'mcp',
      tagline: 'Persistent knowledge-graph memory (no auth required)',
      icon: '🧠',
    },
    build: (m) => ({
      ...base(m, true),
      type: 'mcp',
      mcp: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
      },
    }),
  },

  filesystem: {
    meta: {
      id: 'filesystem',
      slug: 'filesystem',
      name: 'Filesystem',
      provider: 'filesystem',
      type: 'local',
      tagline: 'Read/write files inside a local folder you choose',
      icon: '📁',
      setupHint: 'Set the folder path to expose. File access is scoped to this folder.',
    },
    build: (m) => ({ ...base(m, true), type: 'local', local: { path: '~' } }),
  },
}

export function listPresetMetas(): PresetMeta[] {
  return Object.values(PRESET_CATALOG).map((e) => e.meta)
}

export function isCatalogId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRESET_CATALOG, id)
}

export function buildPresetDraft(id: string): PresetDraft | null {
  const entry = PRESET_CATALOG[id]
  return entry ? entry.build(entry.meta) : null
}
