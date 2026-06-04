// Hard-coded MCP server presets. Pha 1 ships two: filesystem + github.
// Both are stdio servers from @modelcontextprotocol official packages,
// invoked via `npx -y`. Static config — no remote registry call (AC-9).

import type { McpServerConfig } from '../types/shared.js'

export type PresetId = 'filesystem' | 'github'

// Each preset returns a config draft with placeholders the user must fill:
//   - filesystem: args[2] is the path to expose (default: $HOME).
//   - github: env.GITHUB_PERSONAL_ACCESS_TOKEN must be set by the user
//             before the server can authenticate.

interface PresetMeta {
  description: string
  envHints: string[]
  argHints: string[]
}

export const PRESET_META: Record<PresetId, PresetMeta> = {
  filesystem: {
    description: 'Read/write files inside a local directory you choose.',
    envHints: [],
    argHints: ['Path to expose — defaults to your home directory.'],
  },
  github: {
    description: 'GitHub issues, PRs, repos, code search via official MCP server.',
    envHints: [
      'GITHUB_PERSONAL_ACCESS_TOKEN — required. Create at github.com/settings/tokens.',
    ],
    argHints: [],
  },
}

export function buildPreset(id: PresetId): Omit<McpServerConfig, 'id'> {
  if (id === 'filesystem') {
    return {
      name: 'Filesystem',
      description: PRESET_META.filesystem.description,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '~'],
      env: {},
      enabled: true,
      autoStart: true,
      timeoutMs: 30000,
      trust: 'prompt',
    }
  }
  // github
  return {
    name: 'GitHub',
    description: PRESET_META.github.description,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    enabled: false, // start disabled until user supplies the token
    autoStart: false,
    timeoutMs: 30000,
    trust: 'prompt',
  }
}

export function isPresetId(value: string): value is PresetId {
  return value === 'filesystem' || value === 'github'
}
