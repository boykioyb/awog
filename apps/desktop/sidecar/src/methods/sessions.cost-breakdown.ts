import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { loadSession } from '../sessions/store.js'
import type { SessionCostBreakdown, SessionCostDay } from '../types/shared.js'

const Params = z.object({
  sessionId: z.string().min(1),
})

// Day key = sidecar-local YYYY-MM-DD (new Date() runs in the machine timezone, same
// TZ the UI computes "now" in → range math stays consistent for this local app).
function localDayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// sessions.cost-breakdown — a single session's spend split by local day, so the
// Cost tab can roll it into 1d/7d/30d/custom ranges (a session may span many days).
//
// Sums each turn's PERSISTED `usage.costUsd` (the stable per-turn figure written at
// finalize, single source of truth = activity/pricing.ts) rather than re-pricing
// from the current catalog — this keeps the tab's total equal to the session's
// cumulative cost shown elsewhere (Info tab / status bar). A turn whose model had no
// known price has no persisted cost → counted as 0 tokens-only and flags hasUnpriced.
register('sessions.costBreakdown', async (raw): Promise<SessionCostBreakdown> => {
  const { sessionId } = Params.parse(raw)
  const session = await loadSession(sessionId)

  const empty: SessionCostBreakdown = {
    sessionId,
    byDay: [],
    total: { costUsd: 0, totalTokens: 0, turns: 0 },
    hasUnpriced: false,
  }
  if (!session) return empty

  // date key → mutable day accumulator.
  const byDayMap = new Map<string, SessionCostDay>()
  let totalCost = 0
  let totalTokens = 0
  let totalTurns = 0
  let firstAt: number | undefined
  let lastAt: number | undefined
  let hasUnpriced = false

  for (const msg of session.messages) {
    if (msg.role !== 'agent' || !msg.usage) continue
    const u = msg.usage
    const tokens =
      (u.inputTokens || 0) +
      (u.outputTokens || 0) +
      (u.cacheReadTokens || 0) +
      (u.cacheWriteTokens || 0)
    if (tokens <= 0) continue

    // Prefer the turn's own completedAt (ms); fall back to the message event `at`.
    const at =
      typeof msg.completedAt === 'number' && Number.isFinite(msg.completedAt)
        ? msg.completedAt
        : Date.parse(msg.at)
    if (!Number.isFinite(at)) continue

    const lineCost = typeof u.costUsd === 'number' ? u.costUsd : 0
    if (typeof u.costUsd !== 'number') hasUnpriced = true

    const key = localDayKey(at)
    let day = byDayMap.get(key)
    if (!day) {
      day = { date: key, costUsd: 0, totalTokens: 0, turns: 0 }
      byDayMap.set(key, day)
    }
    day.costUsd += lineCost
    day.totalTokens += tokens
    day.turns += 1

    totalCost += lineCost
    totalTokens += tokens
    totalTurns += 1
    if (firstAt === undefined || at < firstAt) firstAt = at
    if (lastAt === undefined || at > lastAt) lastAt = at
  }

  const byDay = [...byDayMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1))

  return {
    sessionId,
    byDay,
    total: { costUsd: totalCost, totalTokens, turns: totalTurns },
    ...(firstAt !== undefined ? { firstAt: new Date(firstAt).toISOString() } : {}),
    ...(lastAt !== undefined ? { lastAt: new Date(lastAt).toISOString() } : {}),
    hasUnpriced,
  }
})
