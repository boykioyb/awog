<template>
  <div>
    <div class="sech">{{ t('settings.appearance.heading') }}</div>

    <SettingsField
      :name="t('settings.appearance.themeFamily.name')"
      :desc="t('settings.appearance.themeFamily.desc')"
    >
      <SettingsSeg v-model="themeFamily" :options="['AWOG', 'shadcn']" />
    </SettingsField>

    <SettingsField
      :name="t('settings.appearance.mode.name')"
      :desc="t('settings.appearance.mode.desc')"
    >
      <SettingsSeg v-model="mode" :options="modeOptions" />
    </SettingsField>

    <SettingsField
      :name="t('settings.appearance.language.name')"
      :desc="t('settings.appearance.language.desc')"
    >
      <div class="seg">
        <span :class="{ on: locale === 'vi' }" @click="setLocale('vi')">Tiếng Việt</span>
        <span :class="{ on: locale === 'en' }" @click="setLocale('en')">English</span>
      </div>
    </SettingsField>

    <SettingsField :desc="t('settings.appearance.accent.desc')">
      <template #name>
        {{ t('settings.appearance.accent.name') }}
        <span style="color: var(--accent)">{{ t('settings.appearance.accent.live') }}</span>
      </template>
      <div class="swatches">
        <span
          v-for="h in accents"
          :key="h"
          class="sw"
          :class="{ on: h === accent }"
          :style="{ background: h }"
          @click="setAccent(h)"
        />
      </div>
    </SettingsField>

    <SettingsField
      :name="t('settings.appearance.surfaceDepth.name')"
      :desc="t('settings.appearance.surfaceDepth.desc')"
    >
      <SettingsSeg v-model="surfaceDepth" :options="surfaceDepthOptions" />
    </SettingsField>

    <SettingsField
      :name="t('settings.appearance.glass.name')"
      :desc="t('settings.appearance.glass.desc')"
    >
      <SettingsTog v-model="liquidGlass" />
    </SettingsField>

    <SettingsField
      :name="t('settings.appearance.fontSize.name')"
      :desc="t('settings.appearance.fontSize.desc')"
    >
      <div class="seg">
        <span
          v-for="s in FONT_SIZES"
          :key="s"
          :class="{ on: s === fontSize }"
          @click="setFontSize(s)"
        >
          {{ s }}
        </span>
      </div>
    </SettingsField>

    <SettingsField
      :name="t('settings.appearance.font.name')"
      :desc="t('settings.appearance.font.desc')"
    >
      <SettingsSeg v-model="sansFamily" :options="sansOptions" />
    </SettingsField>

    <SettingsField
      :name="t('settings.appearance.fontWeight.name')"
      :desc="t('settings.appearance.fontWeight.desc')"
    >
      <SettingsSeg v-model="fontWeight" :options="['300', '400', '500']" />
    </SettingsField>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useSettingsStore } from '~/stores/settings'
import type { FontWeight, SansFamily, SurfaceDepth, ThemeFamily } from '~/stores/settings'

// Appearance panel — ports setSecHtml('appearance') and wires it to real state.
// Mode/accent/font-size + locale live in useTheme()/useI18n(); theme family, sans
// family, font weight, surface depth and glass live in the settings store's
// appearance slice. Proper-noun seg options (AWOG, shadcn, Geist, Inter, System,
// 300/400/500) stay literal; descriptive labels go through t() via { label, value }.
const { t, locale, setLocale } = useI18n()
const { accent, setAccent, fontSize, setFontSize, isDark, toggleTheme } = useTheme()
const store = useSettingsStore()

const accents = ['#10b981', '#60a5fa', '#a78bfa', '#f59e0b', '#f43f5e', '#22d3ee', '#fafafa']
const FONT_SIZES = [12, 13, 14, 15, 16, 18]

// --- font family stacks (drive --font-sans) ---
const SANS_STACKS: Record<SansFamily, string> = {
  geist: "'Geist', system-ui, sans-serif",
  inter: "'Inter', system-ui, sans-serif",
  system: 'system-ui, sans-serif',
}

function applySansFamily(value: SansFamily) {
  document.documentElement.style.setProperty('--font-sans', SANS_STACKS[value])
}
function applyFontWeight(value: FontWeight) {
  document.documentElement.style.setProperty('--font-weight-base', String(value))
}
function applyGlass(value: boolean) {
  document.body.classList.toggle('glass', value)
}
function applySurfaceDepth(value: SurfaceDepth) {
  document.body.dataset.surface = value
}
function applyThemeFamily(value: ThemeFamily) {
  document.body.dataset.themeFamily = value
}

// Mode seg: visible label === stored value (Dark/Light); flip the theme when the
// chosen label differs from the current one.
const modeOptions = computed(() => [
  t('settings.appearance.mode.dark'),
  t('settings.appearance.mode.light'),
])
const mode = computed<string>({
  get: () =>
    isDark.value ? t('settings.appearance.mode.dark') : t('settings.appearance.mode.light'),
  set: (label) => {
    const wantsDark = label === t('settings.appearance.mode.dark')
    if (wantsDark !== isDark.value) toggleTheme()
  },
})

// Theme family — label === value ('AWOG'/'shadcn' both render literally, but the
// stored value is lowercase). Map both directions.
const THEME_FAMILY_LABELS: Record<ThemeFamily, string> = { awog: 'AWOG', shadcn: 'shadcn' }
const themeFamily = computed<string>({
  get: () => THEME_FAMILY_LABELS[store.appearance.themeFamily],
  set: (label) => {
    const value: ThemeFamily = label === 'shadcn' ? 'shadcn' : 'awog'
    store.updateAppearance({ themeFamily: value })
    applyThemeFamily(value)
  },
})

const surfaceDepthOptions = computed(() => [
  { label: t('settings.appearance.surfaceDepth.flat'), value: 'flat' },
  { label: t('settings.appearance.surfaceDepth.standard'), value: 'standard' },
  { label: t('settings.appearance.surfaceDepth.deep'), value: 'deep' },
])
const surfaceDepth = computed<string>({
  get: () => store.appearance.surfaceDepth,
  set: (value) => {
    const v = value as SurfaceDepth
    store.updateAppearance({ surfaceDepth: v })
    applySurfaceDepth(v)
  },
})

const liquidGlass = computed<boolean>({
  get: () => store.appearance.liquidGlass,
  set: (value) => {
    store.updateAppearance({ liquidGlass: value })
    applyGlass(value)
  },
})

const sansOptions = [
  { label: 'Geist', value: 'geist' },
  { label: 'Inter', value: 'inter' },
  { label: 'System', value: 'system' },
] as const
const sansFamily = computed<string>({
  get: () => store.appearance.sansFamily,
  set: (value) => {
    const v = value as SansFamily
    store.updateAppearance({ sansFamily: v })
    applySansFamily(v)
  },
})

const fontWeight = computed<string>({
  get: () => String(store.appearance.fontWeight),
  set: (value) => {
    const v = Number(value) as FontWeight
    store.updateAppearance({ fontWeight: v })
    applyFontWeight(v)
  },
})

// Reflect persisted prefs to the DOM once so a reload paints the saved look.
onMounted(() => {
  applyThemeFamily(store.appearance.themeFamily)
  applySurfaceDepth(store.appearance.surfaceDepth)
  applyGlass(store.appearance.liquidGlass)
  applySansFamily(store.appearance.sansFamily)
  applyFontWeight(store.appearance.fontWeight)
})
</script>
