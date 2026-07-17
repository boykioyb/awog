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
