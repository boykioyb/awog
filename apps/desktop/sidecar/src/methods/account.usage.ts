import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { resolveAccount } from '../credentials/credential-resolver.js'
import { ensureFreshAccessToken } from '../credentials/token-manager.js'
import { fetchClaudeProfile, fetchClaudeUsage, UsageFetchError } from '../providers/anthropic/usage.js'
import type { ClaudeProfile, UsageEntry } from '../providers/anthropic/usage.js'
import { getCodexUsage } from '../providers/openai/usage.js'
import { log } from '../util/logger.js'

const Params = z.object({
  provider: z.enum(['anthropic', 'openai']).default('anthropic'),
  accountId: z.string().optional(),
  force: z.boolean().optional(),
})

// claude.ai aggressively rate-limits /api/oauth/usage. Cache per accountId.
const CACHE_TTL_MS = 60_000
interface CachedEntry {
  fetchedAt: number
  profile: ClaudeProfile | null
  usage: UsageEntry[]
}
const cache = new Map<string, CachedEntry>()

register('account.usage', async (raw) => {
  const params = Params.parse(raw)

  // Usage is a best-effort panel — never hard-error. A caller may pass an
  // accountId from another provider: it won't resolve in the bucket, so report
  // "unavailable" instead of throwing "account not found".
  let account: Awaited<ReturnType<typeof resolveAccount>>
  try {
    account = await resolveAccount(params.provider, params.accountId)
  } catch {
    return { profile: null, usage: [], cachedAt: Date.now(), accountId: null }
  }

  // OpenAI Codex (ChatGPT subscription): usage isn't fetched — it's captured from
  // response headers during real turns (providers/openai/usage). Return the latest
  // snapshot; null (no turn yet) ⇒ empty. API-key openai accounts have none.
  if (params.provider === 'openai') {
    const snap = account.authMode === 'oauth' ? getCodexUsage(account.id) : null
    return {
      profile: null,
      usage: snap?.usage ?? [],
      cachedAt: snap?.cachedAt ?? Date.now(),
      accountId: account.id,
    }
  }

  // Profile + usage come from claude.ai OAuth endpoints — only meaningful for
  // OAuth (subscription) accounts. API-key accounts (incl. custom endpoints)
  // have no usage surface, so report it as unavailable rather than throwing.
  if (account.authMode !== 'oauth') {
    return { profile: null, usage: [], cachedAt: Date.now(), accountId: account.id }
  }

  const cached = cache.get(account.id)
  if (cached && !params.force && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      profile: cached.profile,
      usage: cached.usage,
      cachedAt: cached.fetchedAt,
      accountId: account.id,
    }
  }

  const tokens = await ensureFreshAccessToken('anthropic', account.id)
  try {
    const [profile, usage] = await Promise.all([
      fetchClaudeProfile(tokens.accessToken),
      fetchClaudeUsage(tokens.accessToken),
    ])
    const entry: CachedEntry = { fetchedAt: Date.now(), profile, usage }
    cache.set(account.id, entry)
    return { profile, usage, cachedAt: entry.fetchedAt, accountId: account.id }
  } catch (err) {
    log.warn('account.usage fetch failed', {
      account: account.id,
      err: err instanceof Error ? err.message : String(err),
    })
    // Stale-on-error: /api/oauth/usage is rate-limited hard, and a forced refresh
    // bypasses the 60s cache — so a 429 here is expected when the user mashes
    // reload. Fall back to the last good snapshot (stale bars beat an error banner
    // that blanks the card). Only surface an error when nothing is cached yet.
    if (cached) {
      return {
        profile: cached.profile,
        usage: cached.usage,
        cachedAt: cached.fetchedAt,
        accountId: account.id,
      }
    }
    if (err instanceof UsageFetchError && err.status === 429) {
      throw new RpcError(-32031, 'Anthropic usage rate-limited — try again shortly')
    }
    throw new RpcError(-32030, 'Failed to fetch Anthropic usage')
  }
})
