<template>
  <div class="flex flex-col gap-4.5">
    <p class="text-muted-foreground">{{ t('onboarding.appearance.desc') }}</p>

    <div class="flex flex-col gap-2">
      <span class="text-sm text-faint">{{ t('onboarding.appearance.theme') }}</span>
      <SettingsSeg v-model="themeMode" :options="themeOptions" />
    </div>

    <div class="flex flex-col gap-2">
      <span class="text-sm text-faint">{{ t('onboarding.appearance.accent') }}</span>
      <SettingsAccentSwatches :label="t('onboarding.appearance.accent')" />
    </div>

    <div class="flex flex-col gap-2">
      <span class="text-sm text-faint">{{ t('onboarding.appearance.language') }}</span>
      <SettingsSeg v-model="language" :options="LANGUAGE_OPTIONS" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Appearance step — reuses the live theme/locale composables so choices apply
// instantly and persist exactly like the Settings → Appearance panel. Accent
// presets come from the same SettingsAccentSwatches.
import { computed } from 'vue'
import type { Locale } from '~/composables/useI18n'

const { t, locale, setLocale } = useI18n()
// theme-ok: chỉ đọc/ghi trạng thái theme, không tô màu
const { isDark, toggleTheme } = useTheme()

const ensureDark = (dark: boolean) => {
  if (dark !== isDark.value) toggleTheme()
}

const themeOptions = computed(() => [
  { label: t('onboarding.appearance.themeDark'), value: 'dark' },
  { label: t('onboarding.appearance.themeLight'), value: 'light' },
])
const themeMode = computed<string>({
  get: () => (isDark.value ? 'dark' : 'light'),
  set: (value) => ensureDark(value === 'dark'),
})

// Tên ngôn ngữ để nguyên chữ gốc (không dịch) — giá trị lưu là mã locale.
const LANGUAGE_OPTIONS = [
  { label: 'Tiếng Việt', value: 'vi' },
  { label: 'English', value: 'en' },
]
const language = computed<string>({
  get: () => locale.value,
  set: (value) => setLocale(value as Locale),
})
</script>
