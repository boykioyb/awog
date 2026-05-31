// Lightweight i18n. No external dep — flat key dictionary + `{placeholder}`
// interpolation. Locale lives in settings.appearance.locale (persisted via
// `useAppearance`); changing it is reactive across the whole UI because the
// `t()` function reads the store getter inside a computed/effect chain.
//
// Adding a string:
//   1. Add the key to en.json (canonical) + vi.json (translated).
//   2. Reference via `t('git.delete_branch.title')`.
//   3. Interpolate with `t('git.foo', { name: 'main' })` → uses `{name}`.
//
// Keep keys lowercase + dot-namespaced (`<area>.<component>.<slot>`).

import en from '~/i18n/en.json'
import vi from '~/i18n/vi.json'

export type Locale = 'en' | 'vi'

const DICTIONARIES: Record<Locale, Record<string, string>> = {
  en: en as Record<string, string>,
  vi: vi as Record<string, string>,
}

const interpolate = (template: string, params?: Record<string, string | number>): string => {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = params[key]
    return v === undefined ? `{${key}}` : String(v)
  })
}

export const useI18n = () => {
  const settings = useSettingsStore()
  const locale = computed<Locale>(() => settings.appearance.locale ?? 'en')

  // `t` returns key on lookup miss so devs notice quickly. English falls back
  // first when the active locale is missing the key (catch the 80% common
  // path: vi.json forgot to add a freshly-added key).
  const t = (key: string, params?: Record<string, string | number>): string => {
    const dict = DICTIONARIES[locale.value]
    const raw = dict[key] ?? DICTIONARIES.en[key] ?? key
    return interpolate(raw, params)
  }

  const setLocale = (next: Locale) => {
    settings.updateAppearance({ locale: next })
  }

  return { t, locale, setLocale }
}
