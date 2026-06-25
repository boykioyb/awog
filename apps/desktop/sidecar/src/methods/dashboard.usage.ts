import { register } from '../transport/rpc.js'
import { collectUsageSince } from '../sessions/store.js'
import type { DashboardUsage } from '../types/shared.js'

// Aggregate token usage for the Home "Activity" tile (Phase A). Token per turn =
// inputTokens + outputTokens + cacheRead + cacheWrite (cache buckets count toward
// context usage). Source = session JSONL logs only; task-run usage is NOT folded
// in here — task turns are recorded in their own JSONL trace under a different
// shape and merging them cheaply is not obvious, so they are intentionally
// out of scope for this method (documented to avoid silent under-counting).
//
// Perf: the heavy lifting (bounded tail-first JSONL reads, stopping at the window
// edge) lives in collectUsageSince — we never fold a whole transcript. We only
// look back ~48h (midnight yesterday → now), so cost scales with recent activity.

const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const BUCKET_HOURS = 2
const BUCKET_COUNT = 12 // 12 × 2h = last 24h
const BUCKET_MS = BUCKET_HOURS * MS_PER_HOUR

register('dashboard.usage', async (): Promise<DashboardUsage> => {
  const now = new Date()

  // Local-time day boundaries (Date getters/setters use the machine timezone).
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayStartMs = todayStart.getTime()

  const yesterdayStartMs = todayStartMs - 24 * MS_PER_HOUR
  const nowMs = now.getTime()

  // Read everything since midnight yesterday — the earliest edge we report
  // (the delta needs all of yesterday; the sparkline needs the last 24h).
  const entries = await collectUsageSince(yesterdayStartMs)

  let today = 0
  let yesterday = 0
  const buckets = new Array<number>(BUCKET_COUNT).fill(0)

  // Sparkline window: last 24h ending now, split into 12 fixed 2h buckets aligned
  // to `now` (bucket 0 = oldest = [now-24h, now-22h), bucket 11 = newest).
  const windowStartMs = nowMs - BUCKET_COUNT * BUCKET_MS

  for (const e of entries) {
    if (e.at >= todayStartMs) today += e.tokens
    else if (e.at >= yesterdayStartMs) yesterday += e.tokens

    if (e.at >= windowStartMs && e.at <= nowMs) {
      const idx = Math.min(BUCKET_COUNT - 1, Math.floor((e.at - windowStartMs) / BUCKET_MS))
      buckets[idx] += e.tokens
    }
  }

  // Rate = today's tokens spread over the minutes elapsed since midnight, clamped
  // to >= 1 minute so a burst in the first seconds of the day doesn't divide by ~0.
  const minutesToday = Math.max(1, (nowMs - todayStartMs) / MS_PER_MINUTE)
  const ratePerMin = Math.round(today / minutesToday)

  return { today, yesterday, buckets, ratePerMin }
})
