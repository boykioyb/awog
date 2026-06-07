import type { MCPServer, MCPTransport, MCPTrust } from '~/types'

export type McpDraft = Omit<MCPServer, 'id'> & { id: string }

const slugify = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 3)
    .join('-')
    .slice(0, 32) || 'new-mcp'

const inferTransport = (prompt: string): MCPTransport => {
  const lower = prompt.toLowerCase()
  if (/(https?:\/\/|api\.|cloud|remote|gateway)/.test(lower)) return 'http'
  if (/(stream|sse|server-sent)/.test(lower)) return 'sse'
  return 'stdio'
}

const inferTrust = (prompt: string): MCPTrust => {
  const lower = prompt.toLowerCase()
  if (/(read[- ]only|safe|search|query|list)/.test(lower)) return 'allow'
  if (/(deploy|delete|write|exec|push|drop)/.test(lower)) return 'prompt'
  return 'prompt'
}

const inferRegistryEntry = (
  prompt: string,
): { command: string; args: string[]; description: string } | null => {
  const lower = prompt.toLowerCase()
  if (/filesystem|local file/.test(lower)) {
    return {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '${workspace}'],
      description: 'Đọc/ghi file trong workspace.',
    }
  }
  if (/git\s*nexus|knowledge graph|cypher/.test(lower)) {
    return {
      command: 'uvx',
      args: ['gitnexus-mcp@latest'],
      description: 'Knowledge graph codebase — query, impact, callers.',
    }
  }
  if (/playwright|browser|e2e|screenshot/.test(lower)) {
    return {
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      description: 'Điều khiển browser headless.',
    }
  }
  if (/sqlite|database|sql/.test(lower)) {
    return {
      command: 'uvx',
      args: ['mcp-server-sqlite', '--db-path', '${workspace}/.data/main.sqlite'],
      description: 'Query SQLite local.',
    }
  }
  if (/github|gh\b|issue|pull request/.test(lower)) {
    return {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      description: 'GitHub issues, PR, repository content.',
    }
  }
  return null
}

const firstSentence = (prompt: string): string => {
  const m = prompt.match(/^[^.!?\n]+[.!?]?/)
  return m ? m[0].trim() : prompt.slice(0, 140)
}

const mockGenerate = (prompt: string): McpDraft => {
  const transport = inferTransport(prompt)
  const registry = inferRegistryEntry(prompt)
  const id = slugify(prompt)
  const name = id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  if (transport === 'stdio') {
    return {
      id,
      name,
      description: registry?.description ?? firstSentence(prompt),
      transport: 'stdio',
      command: registry?.command ?? 'npx',
      args: registry?.args ?? ['-y', `@modelcontextprotocol/server-${id}`],
      env: {},
      cwd: '',
      enabled: true,
      autoStart: true,
      timeoutMs: 30000,
      trust: inferTrust(prompt),
      status: 'idle',
      tools: [],
      resources: [],
    }
  }

  return {
    id,
    name,
    description: firstSentence(prompt),
    transport,
    url: 'https://example.com/mcp',
    headers: { Authorization: `Bearer \${secret:${id}_token}` },
    enabled: false,
    autoStart: false,
    timeoutMs: 60000,
    trust: inferTrust(prompt),
    status: 'idle',
    tools: [],
    resources: [],
  }
}

export const useMcpGenerator = () => useMockGenerator<McpDraft>({ generate: mockGenerate })
