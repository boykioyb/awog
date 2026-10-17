import { describe, expect, it, vi } from 'vitest'
import type { SourceConfig } from '../../types/shared.js'

vi.mock('../../util/logger.js', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock('../../sources/store.js', () => ({ listSources: async () => [] }))
vi.mock('../../sources/oauth-manager.js', () => ({ getFreshToken: async () => null }))

const { isSlackSource } = await import('../session.js')

const mcp = (block: Record<string, unknown>, provider = 'custom'): SourceConfig =>
  ({ id: 'x', provider, type: 'mcp', enabled: true, mcp: block }) as unknown as SourceConfig

describe('isSlackSource', () => {
  it('nhận preset Slack và host *.slack.com', () => {
    expect(isSlackSource(mcp({ url: 'https://example.com' }, 'slack'))).toBe(true)
    expect(isSlackSource(mcp({ transport: 'http', url: 'https://mcp.slack.com/mcp' }))).toBe(true)
    expect(isSlackSource(mcp({ transport: 'http', url: 'https://notslack.com/mcp' }))).toBe(false)
  })

  it('nhận server stdio có chữ slack trong command / args / tên biến env (không phân biệt hoa thường)', () => {
    expect(isSlackSource(mcp({ transport: 'stdio', command: '/opt/Slack-MCP/bin/server' }))).toBe(true)
    expect(
      isSlackSource(
        mcp({ transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-SLACK'] }),
      ),
    ).toBe(true)
    expect(
      isSlackSource(mcp({ transport: 'stdio', command: 'node', args: ['srv.js'], env: { Slack_Bot_Token: '' } })),
    ).toBe(true)
    expect(
      isSlackSource(
        mcp({ transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: { X: 'slack' } }),
      ),
    ).toBe(false)
  })
})
