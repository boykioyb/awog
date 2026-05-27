// Format an ISO timestamp (or legacy "Just now" string) into "HH:MM DD/MM/YYYY"
// in the user-configured timezone. Returns the original string if input is
// already a sentinel like "Just now" or fails to parse — keeps mock data readable.

const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh'

export function formatTime(input: string | number | undefined, tz?: string): string {
  if (input === undefined || input === null) return ''
  if (typeof input === 'string' && !/\d/.test(input)) return input

  const d = typeof input === 'number' ? new Date(input) : new Date(input)
  if (Number.isNaN(d.getTime())) {
    return typeof input === 'string' ? input : ''
  }

  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || DEFAULT_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour12: false,
    }).formatToParts(d)
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
    return `${get('hour')}:${get('minute')} ${get('day')}/${get('month')}/${get('year')}`
  } catch {
    return d.toISOString()
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}
