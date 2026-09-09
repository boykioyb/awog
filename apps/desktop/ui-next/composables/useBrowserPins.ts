import { ref } from 'vue'

// Pinned pages for the agent's browser (ADR 0086 phần D).
//
// Tabs in that browser belong to the AGENT: it opens them mid-turn, closes them,
// and `browser.close()` destroys the lot on quit. So "keep this page" cannot mean
// "keep this tab" — a pin has to outlive every tab, and the app restart too. It is
// therefore a small persisted list of {url, title}, and clicking a pin opens a
// FRESH tab on it.
//
// localStorage, not the sidecar: this is a per-machine convenience list about the
// UI's own browser surface, nothing the engine reads — same shape as the link-open
// mode and the keymap.

export type BrowserPin = { url: string; title: string }

const STORAGE_KEY = 'awog.browserPins'
// Enough to be useful, few enough that the strip stays readable.
const MAX_PINS = 12

// Compare without a trailing slash: `wc.getURL()` normalises `https://x.com` to
// `https://x.com/`, and a pin typed into the URL bar may not have it. Without this
// the same page pins twice and the toggle never finds the existing one.
const key = (url: string): string =>
  String(url ?? '')
    .trim()
    .replace(/\/+$/, '')

const read = (): BrowserPin[] => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Stored by an older/other version, or hand-edited — keep only what is usable.
    return parsed
      .filter(
        (p): p is BrowserPin =>
          !!p && typeof p === 'object' && typeof (p as BrowserPin).url === 'string',
      )
      .map((p) => ({ url: p.url, title: typeof p.title === 'string' ? p.title : '' }))
      .slice(0, MAX_PINS)
  } catch {
    return []
  }
}

const pins = ref<BrowserPin[]>(read())

const persist = (): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pins.value))
  } catch {
    // Private window / blocked storage — pins just won't survive the session.
  }
}

export function useBrowserPins() {
  const isPinned = (url: string): boolean => {
    const k = key(url)
    return !!k && pins.value.some((p) => key(p.url) === k)
  }

  const add = (pin: BrowserPin): void => {
    const k = key(pin.url)
    if (!k || isPinned(pin.url)) return
    // Newest first, and the oldest falls off the end rather than refusing the pin:
    // a button that silently does nothing at the cap is worse than a rolling list.
    pins.value = [{ url: pin.url, title: pin.title }, ...pins.value].slice(0, MAX_PINS)
    persist()
  }

  const remove = (url: string): void => {
    const k = key(url)
    pins.value = pins.value.filter((p) => key(p.url) !== k)
    persist()
  }

  const toggle = (pin: BrowserPin): void => {
    if (isPinned(pin.url)) remove(pin.url)
    else add(pin)
  }

  // What the chip shows: the page title, else the host, else the raw url.
  const labelOf = (pin: BrowserPin): string => {
    if (pin.title.trim()) return pin.title.trim()
    try {
      return new URL(pin.url).host || pin.url
    } catch {
      return pin.url
    }
  }

  return { pins, isPinned, add, remove, toggle, labelOf }
}
