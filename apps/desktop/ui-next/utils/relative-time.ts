// Coarse relative-time label ("vừa xong" / "3m" / "2h" / "5d") for an ISO timestamp,
// measured against `nowMs` (defaults to the wall clock). Kept deliberately crude — the
// session list only needs an at-a-glance freshness cue, not exact durations.
//
// Pass a shared, ticking `nowMs` (see useNow) so the label stays LIVE: a session shown
// "vừa xong" rolls over to "1m", "2m"… on its own. Storing a pre-rendered string on the
// session instead (the old `when` field) froze the label at hydrate time, so an untouched
// session kept reading "vừa xong" for hours — the bug this replaces.
export function relativeTime(iso: string | undefined, nowMs: number = Date.now()): string {
  if (!iso) return 'vừa xong'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'vừa xong'
  const sec = Math.max(0, Math.floor((nowMs - then) / 1000))
  if (sec < 60) return 'vừa xong'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}

// Locale-aware "X ago" label — same coarse buckets as relativeTime, but each
// bucket resolves through i18n (common.time.*) so the phrasing is fully
// translated instead of leaking the VN "vừa xong" into an English UI. Pass a
// ticking `nowMs` (useNow) to keep the label live.
//
// NB: useSshDetail + useConnectionDetail still carry near-identical private
// copies keyed on their own namespaces — a follow-up dedup can migrate them here.
export function formatRelativeAgo(
  iso: string | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
  nowMs: number = Date.now(),
): string {
  if (!iso) return t('common.time.justNow')
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return t('common.time.justNow')
  const sec = Math.max(0, Math.floor((nowMs - then) / 1000))
  if (sec < 60) return t('common.time.justNow')
  const min = Math.floor(sec / 60)
  if (min < 60) return t('common.time.minutesAgo', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('common.time.hoursAgo', { n: hr })
  return t('common.time.daysAgo', { n: Math.floor(hr / 24) })
}
