// Từ "nguồn Slack trong Sources" ra một phiên gọi API đã xác thực.
//
// Token nằm trong closure của SlackSession, không phải một field: object này
// đi qua nhiều tầng (poll, directory, files…), và chỉ cần một lần ai đó
// `JSON.stringify(session)` vào log/RPC là lộ. Closure thì không serialize được.
//
// Danh tính (`auth.test`: team, user của chính mình, scope) được nhớ theo nguồn
// một lúc: mọi thao tác sửa/xoá tin cần `selfUserId`, và gọi `auth.test` trước
// mỗi thao tác chỉ tốn một round-trip vô ích. Gặp lỗi xác thực thì quên ngay
// để lần sau hỏi lại.
import { listSources } from '../sources/store.js'
import { getFreshToken } from '../sources/oauth-manager.js'
import { log } from '../util/logger.js'
import type { ApiSource, McpSource, SourceConfig } from '../types/shared.js'
import {
  SlackApiError,
  callSlackApi,
  downloadSlackFile,
  fetchSlackBytes,
  isAuthErrorCode,
  type ApiParamValue,
  type ApiResult,
  type FetchedBytes,
} from './client.js'

// Scope mà tính năng cần (docs/features/slack-threads.md, mục "Scope Slack cần").
export const REQUIRED_SCOPES = [
  'channels:history',
  'groups:history',
  'im:history',
  'mpim:history',
  'channels:read',
  'groups:read',
  'users:read',
  'chat:write',
  'reactions:write',
  'files:read',
  // KHÔNG có `emoji:read`: trang cấu hình Slack app không cho chọn scope này ở
  // User Token Scopes (đo 2026-10-16), nên banner "thiếu scope" sẽ nhắc mãi một
  // việc người dùng không làm được. Thiếu nó thì emoji tuỳ chỉnh hiện `:tên:`
  // và picker không có tab Tuỳ chỉnh (directory.ts tự kiểm hasScope).
] as const

const IDENTITY_TTL_MS = 10 * 60_000

export type SlackSourceConfig = McpSource | ApiSource

export type SlackIdentity = {
  teamId: string
  teamName: string
  teamUrl: string
  userId: string
  // null = Slack không gửi header scope ⇒ không biết, coi như đủ.
  scopes: string[] | null
}

export type SlackSession = {
  readonly sourceId: string
  readonly teamId: string
  readonly teamName: string
  readonly teamUrl: string
  readonly selfUserId: string
  readonly scopes: string[] | null
  hasScope(scope: string): boolean
  api(
    method: string,
    params: Record<string, ApiParamValue>,
    opts?: { write?: boolean },
  ): Promise<Record<string, unknown>>
  fetchBytes(url: string, maxBytes: number): Promise<FetchedBytes>
  download(url: string, dest: string, maxBytes: number): Promise<number>
}

const identities = new Map<string, { identity: SlackIdentity; at: number }>()

export function forgetIdentity(sourceId: string): void {
  identities.delete(sourceId)
}

export async function listSlackSources(): Promise<SlackSourceConfig[]> {
  const all = await listSources()
  return all.filter(
    (s): s is SlackSourceConfig =>
      s.enabled && s.provider === 'slack' && (s.type === 'mcp' || s.type === 'api'),
  )
}

// Nguồn nói chuyện với Slack: preset Slack (`provider === 'slack'`) hoặc nguồn tự
// khai trỏ tới host Slack (MCP chính thức `mcp.slack.com`, API `slack.com`). Dùng để
// LOẠI chúng khỏi phiên nhận nội dung thread Slack (session-link.ts,
// sessions.send-message.ts): nội dung đó do người ngoài viết, mà tool MCP Slack
// gửi/react được — prompt injection trong thread thành tin đăng lên kênh khách.
export function isSlackSource(s: SourceConfig): boolean {
  if (s.provider === 'slack') return true
  // Server MCP stdio tự khai (vd `npx @modelcontextprotocol/server-slack`, env
  // `SLACK_BOT_TOKEN`): không có URL để soi host, nên nhận theo chữ `slack` trong
  // command / args / tên biến env. Thà loại nhầm một nguồn có chữ "slack" còn hơn để
  // lọt một server gửi được tin lên kênh khách.
  if (s.type === 'mcp' && mentionsSlack(s.mcp)) return true
  let raw: string | undefined
  if (s.type === 'mcp') raw = s.mcp.url
  else if (s.type === 'api') raw = s.api.baseUrl
  if (!raw) return false
  try {
    const host = new URL(raw).hostname.toLowerCase()
    return host === 'slack.com' || host.endsWith('.slack.com')
  } catch {
    return false
  }
}

function mentionsSlack(m: McpSource['mcp']): boolean {
  const parts = [m.command ?? '', ...(m.args ?? []), ...Object.keys(m.env ?? {})]
  return parts.some((p) => p.toLowerCase().includes('slack'))
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

async function identify(
  sourceId: string,
  token: string,
  opts: { fresh?: boolean } = {},
): Promise<SlackIdentity> {
  const hit = identities.get(sourceId)
  if (!opts.fresh && hit && Date.now() - hit.at < IDENTITY_TTL_MS) return hit.identity
  const { data, scopes }: ApiResult = await callSlackApi(token, 'auth.test', {})
  const identity: SlackIdentity = {
    teamId: str(data.team_id),
    teamName: str(data.team),
    teamUrl: str(data.url),
    userId: str(data.user_id),
    scopes,
  }
  if (!identity.teamId || !identity.userId) {
    throw new SlackApiError('bad_response', 'auth.test returned no team/user')
  }
  identities.set(sourceId, { identity, at: Date.now() })
  return identity
}

function buildSession(sourceId: string, token: string, identity: SlackIdentity): SlackSession {
  const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof SlackApiError && isAuthErrorCode(err.code)) forgetIdentity(sourceId)
      throw err
    }
  }
  return {
    sourceId,
    teamId: identity.teamId,
    teamName: identity.teamName,
    teamUrl: identity.teamUrl,
    selfUserId: identity.userId,
    scopes: identity.scopes,
    hasScope: (scope) => identity.scopes === null || identity.scopes.includes(scope),
    api: (method, params, opts) => wrap(async () => (await callSlackApi(token, method, params, opts)).data),
    fetchBytes: (url, maxBytes) => wrap(() => fetchSlackBytes(url, token, maxBytes)),
    download: (url, dest, maxBytes) => wrap(() => downloadSlackFile(url, token, dest, maxBytes)),
  }
}

async function sessionFor(
  source: SlackSourceConfig,
  opts: { fresh?: boolean } = {},
): Promise<SlackSession> {
  const token = await getFreshToken(source)
  if (!token) {
    forgetIdentity(source.id)
    throw new SlackApiError('not_connected', 'Slack source is not connected — reconnect it')
  }
  try {
    return buildSession(source.id, token, await identify(source.id, token, opts))
  } catch (err) {
    if (err instanceof SlackApiError && isAuthErrorCode(err.code)) forgetIdentity(source.id)
    throw err
  }
}

export async function openSlackSession(
  sourceId: string,
  opts: { fresh?: boolean } = {},
): Promise<SlackSession> {
  const source = (await listSlackSources()).find((s) => s.id === sourceId)
  if (!source) throw new SlackApiError('source_not_found', 'Slack source not found or disabled')
  return sessionFor(source, opts)
}

// Tìm nguồn theo team. Nguồn đã từng `auth.test` thì khớp ngay từ cache; còn
// không thì hỏi lần lượt — số nguồn Slack thực tế là 1–2 nên không cần index.
export async function openSlackSessionForTeam(teamId: string): Promise<SlackSession> {
  const sources = await listSlackSources()
  for (const [id, hit] of identities) {
    if (hit.identity.teamId !== teamId) continue
    const source = sources.find((s) => s.id === id)
    if (source) return sessionFor(source)
  }
  for (const source of sources) {
    try {
      // eslint-disable-next-line no-await-in-loop -- 1–2 nguồn, tuần tự cho dễ đọc
      const session = await sessionFor(source)
      if (session.teamId === teamId) return session
    } catch (err) {
      log.warn('slack: source unusable while resolving team', {
        sourceId: source.id,
        code: err instanceof SlackApiError ? err.code : 'unknown',
      })
    }
  }
  throw new SlackApiError('not_connected', 'No connected Slack source for this workspace')
}

export type SourceProbe = {
  source: SlackSourceConfig
  identity: SlackIdentity | null
  connected: boolean
}

// Dùng cho `slack.status`: hỏi `auth.test` MỚI (không cache) để header scope
// phản ánh đúng lúc người dùng vừa kết nối lại nguồn.
export async function probeSources(): Promise<SourceProbe[]> {
  const sources = await listSlackSources()
  return Promise.all(
    sources.map(async (source): Promise<SourceProbe> => {
      try {
        const session = await sessionFor(source, { fresh: true })
        const identity = identities.get(source.id)?.identity ?? null
        return { source, identity, connected: Boolean(session) }
      } catch (err) {
        const code = err instanceof SlackApiError ? err.code : 'unknown'
        if (!isAuthErrorCode(code)) {
          log.warn('slack: status probe failed', { sourceId: source.id, code })
        }
        return { source, identity: null, connected: false }
      }
    }),
  )
}

export function missingScopes(scopes: string[] | null): string[] {
  if (scopes === null) return []
  return REQUIRED_SCOPES.filter((s) => !scopes.includes(s))
}
