import { computed, ref } from 'vue'

// Lightweight i18n — no external dep. Flat dotted keys + `{placeholder}` interp.
//
// Per-area locale files live in `i18n/locales/<locale>/<area>.json` and are
// merged at build time via Vite's import.meta.glob. Splitting by area (nav,
// home, git, sessions, …) lets parallel page work each own its own file with
// zero merge conflicts on a single big dictionary.
//
// Adding strings:
//   1. Add the key to i18n/locales/vi/<area>.json AND i18n/locales/en/<area>.json.
//   2. Reference via `t('home.running.title')`; interpolate `t('x', { n: 3 })`.
// Keep keys lowercase + dot-namespaced: `<area>.<section>.<slot>`.

export type Locale = 'en' | 'vi'

const enModules = import.meta.glob('../i18n/locales/en/*.json', {
  eager: true,
  import: 'default',
})
const viModules = import.meta.glob('../i18n/locales/vi/*.json', {
  eager: true,
  import: 'default',
})

function merge(modules: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const mod of Object.values(modules)) Object.assign(out, mod as Record<string, string>)
  return out
}

const DICTIONARIES: Record<Locale, Record<string, string>> = {
  en: merge(enModules),
  vi: merge(viModules),
}

const STORAGE_KEY = 'awog-locale'
// VN-first content; switchable to en. Module-level so all consumers share it.
const locale = ref<Locale>('vi')

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = params[key]
    return v === undefined ? `{${key}}` : String(v)
  })
}

export function useI18n() {
  // Call once on app mount (client-only SPA) to pick up the persisted choice.
  function initLocale() {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'vi') locale.value = saved
  }

  function setLocale(next: Locale) {
    locale.value = next
    localStorage.setItem(STORAGE_KEY, next)
  }

  // Returns the key itself on a miss so a forgotten translation is obvious;
  // falls back to en when the active locale lacks the key.
  const t = (key: string, params?: Record<string, string | number>): string => {
    const raw = DICTIONARIES[locale.value][key] ?? DICTIONARIES.en[key] ?? key
    return interpolate(raw, params)
  }

  return { t, locale: computed(() => locale.value), setLocale, initLocale }
}
