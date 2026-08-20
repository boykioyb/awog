import { computed } from 'vue'
import { useSettingsStore, type ThemeFamily } from '~/stores/settings'

// Which theme family is active (Settings → Appearance → Theme). The look itself is
// pure CSS — assets/css/theme-cute.css scopes every rule under
// `body[data-theme-family='cute']`, and useAppearanceDom writes that attribute — so
// a component only needs this when the theme changes MARKUP, not styling:
// the mascot in the sidebar logo, the profile card in the sidebar footer, the cute
// empty states. Everything else must stay a CSS-only difference.
//
// Default family is 'awog' (the original look), so `isCute` is false unless the user
// opts in; no existing surface changes shape on its own.
export function useThemeFamily() {
  const store = useSettingsStore()
  const family = computed<ThemeFamily>(() => store.appearance.themeFamily)
  const isCute = computed(() => family.value === 'cute')
  return { family, isCute }
}
