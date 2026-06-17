// Single leverage point for the Settings modal surface look. In light mode the
// whole settings UI is flat white — the default `surfaceDepth` tints `bgElevated`
// a light gray (#fafafa), which the user does not want here, so cards fall back to
// the pure-white base `bg`. Dark mode keeps the elevated tint untouched.
export const useSettingsSurface = () => {
  const { t, themeName } = useTheme()
  const isLight = computed(() => themeName.value === 'light')
  const cardBg = computed(() => (isLight.value ? t.value.bg : t.value.bgElevated))
  return { isLight, cardBg }
}
