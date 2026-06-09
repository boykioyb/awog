<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Appearance</h2>
      <div class="text-[1em]" :style="{ color: t.textDim }">
        Customize fonts and theme used across the app
      </div>
    </div>

    <div :style="{ borderTop: `1px solid ${t.border}` }">
      <SettingsField label="Theme" hint="Toggle via moon/sun icon in the sidebar">
        <div class="text-[1em]" :style="{ color: t.textMuted }">
          {{ themeName === 'dark' ? 'Dark' : 'Light' }}
        </div>
      </SettingsField>

      <SettingsField label="Sans font" hint="Body and UI typography">
        <AppSelect
          :model-value="appearance.sansFamily"
          @update:model-value="(v) => onUpdate({ sansFamily: v })"
        >
          <option v-for="o in SANS_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </AppSelect>
      </SettingsField>

      <SettingsField label="Mono font" hint="Code blocks, terminals, debug output">
        <AppSelect
          :model-value="appearance.monoFamily"
          @update:model-value="(v) => onUpdate({ monoFamily: v })"
        >
          <option v-for="o in MONO_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </AppSelect>
      </SettingsField>

      <SettingsField :label="tr('settings.language')" :hint="tr('settings.language.hint')">
        <AppSelect
          :model-value="appearance.locale"
          @update:model-value="(v) => onUpdate({ locale: v })"
        >
          <option value="en">English</option>
          <option value="vi">Tiếng Việt</option>
        </AppSelect>
      </SettingsField>

      <SettingsField label="Font size" :hint="`${appearance.fontSize}px`">
        <input
          v-model.number="appearance.fontSize"
          type="range"
          :min="FONT_SIZE_MIN"
          :max="FONT_SIZE_MAX"
          step="1"
          class="w-full"
          @input="onUpdate({ fontSize: appearance.fontSize })"
        />
      </SettingsField>

      <SettingsField label="Font weight" hint="Applies to body text">
        <AppSelect :model-value="appearance.fontWeight" @update:model-value="onFontWeight">
          <option v-for="o in WEIGHT_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </AppSelect>
      </SettingsField>

      <SettingsField
        label="Theme color"
        hint="Hue tint or full background base across surfaces"
        block
      >
        <ColorSwatchPicker
          :presets="themeColorPresets"
          :selected="appearance.themeColor"
          :custom-hex="appearance.themeColorCustom"
          @pick="onThemeColorPick"
          @pick-custom="onThemeColorCustom"
        />
        <div
          class="mt-3 space-y-1 transition-opacity"
          :style="{ opacity: themeColorTints ? 1 : 0.4 }"
          :title="themeColorTints ? undefined : 'Not applicable for this color'"
        >
          <div class="flex items-center justify-between" :style="{ color: t.textDim }">
            <span class="text-[1em]">Tint strength</span>
            <span class="text-[12px] font-mono leading-none" :style="{ color: t.textMuted }">
              {{ appearance.themeColorStrength }}%
            </span>
          </div>
          <input
            v-model.number="appearance.themeColorStrength"
            type="range"
            :min="THEME_STRENGTH_MIN"
            :max="THEME_STRENGTH_MAX"
            step="1"
            :disabled="!themeColorTints"
            class="w-full disabled:cursor-not-allowed"
            @input="onUpdate({ themeColorStrength: appearance.themeColorStrength })"
          />
        </div>
      </SettingsField>

      <SettingsField label="Accent color" hint="Buttons, links, focus rings, active items" block>
        <ColorSwatchPicker
          :presets="ACCENT_PRESETS"
          :selected="appearance.accent"
          :custom-hex="appearance.accentCustom"
          @pick="onAccentPick"
          @pick-custom="onAccentCustom"
        />
      </SettingsField>

      <SettingsField label="Surface depth" hint="Layer contrast between panels">
        <div class="flex rounded overflow-hidden" :style="{ border: `1px solid ${t.border}` }">
          <button
            v-for="o in SURFACE_DEPTH_OPTIONS"
            :key="o.value"
            class="flex-1 px-3 py-1.5 text-[1em] transition-colors"
            :style="depthStyle(o.value)"
            :title="o.hint"
            @click="onUpdate({ surfaceDepth: o.value })"
          >
            {{ o.label }}
          </button>
        </div>
      </SettingsField>

      <SettingsField label="Liquid Glass" hint="Translucent frosted surfaces + ambient backdrop">
        <AppToggle
          :model-value="appearance.liquidGlass"
          @update:model-value="(v) => onUpdate({ liquidGlass: v })"
        />
      </SettingsField>
    </div>

    <div>
      <div class="text-[1em] mb-2 uppercase tracking-wider" :style="{ color: t.textDim }">
        Preview
      </div>
      <div
        class="rounded overflow-hidden"
        :style="{ background: t.bg, border: `1px solid ${t.border}` }"
      >
        <div class="p-4 space-y-3" :style="{ background: t.bgPanel }">
          <div
            :style="{ color: t.text, fontSize: `${appearance.fontSize + 2}px`, fontWeight: 600 }"
          >
            The quick brown fox jumps
          </div>
          <div :style="{ color: t.text }">
            Body text — 0123456789. Layer panel uses
            <code class="font-mono text-[1em]" :style="{ color: t.accent }">bgPanel</code>
            .
          </div>
          <div
            class="p-3 rounded"
            :style="{ background: t.bgCanvas, border: `1px solid ${t.border}`, color: t.text }"
          >
            Nested canvas surface ·
            <span :style="{ color: t.textMuted }">muted text</span>
          </div>
          <div class="flex gap-2 items-center">
            <button
              class="px-3 py-1.5 rounded text-[1em] font-medium"
              :style="{ background: t.accent, color: t.accentText }"
            >
              Primary action
            </button>
            <button
              class="px-3 py-1.5 rounded text-[1em]"
              :style="{ background: t.bgHover, color: t.text, border: `1px solid ${t.border}` }"
            >
              Secondary
            </button>
            <a class="text-[1em]" :style="{ color: t.accent }">Link</a>
          </div>
          <pre
            class="font-mono text-[1em] p-2 rounded"
            :style="{ background: t.bgElevated, border: `1px solid ${t.border}`, color: t.textDim }"
          >
const sum = (a: number, b: number) =&gt; a + b</pre
          >
        </div>
      </div>
    </div>

    <div class="flex justify-end">
      <button
        class="px-3 py-1.5 rounded text-[1em]"
        :style="{ border: `1px solid ${t.border}`, color: t.textDim }"
        @click="reset"
      >
        Reset to defaults
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type {
  AccentPreset,
  AppearanceSettings,
  BackgroundPreset,
  SurfaceDepth,
  ThemeColor,
} from '~/types'
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  MONO_OPTIONS,
  SANS_OPTIONS,
  THEME_STRENGTH_MAX,
  THEME_STRENGTH_MIN,
  WEIGHT_OPTIONS,
  useAppearance,
} from '~/composables/useAppearance'
import {
  ACCENT_PRESETS,
  BACKGROUND_PRESETS,
  SURFACE_DEPTH_OPTIONS,
  THEME_COLOR_PRESETS,
} from '~/utils/theme-presets'

const { t, themeName } = useTheme()
const { t: tr } = useI18n()
const { appearance, update, reset } = useAppearance()

const onUpdate = (patch: Partial<AppearanceSettings>) => {
  update(patch)
}

// The native <select> always yields a string; coerce back to the numeric
// FontWeight union the appearance store expects.
const onFontWeight = (v: AppearanceSettings['fontWeight']) =>
  onUpdate({ fontWeight: Number(v) as AppearanceSettings['fontWeight'] })

// Background-base presets (GitHub Dark, Subtle Purple) are dark surfaces, so they
// only make sense in dark theme — hide them in light mode where they no-op.
const BACKGROUND_VALUES = new Set<BackgroundPreset>(BACKGROUND_PRESETS.map((p) => p.value))
const themeColorPresets = computed(() =>
  themeName.value === 'dark'
    ? THEME_COLOR_PRESETS
    : THEME_COLOR_PRESETS.filter((p) => !BACKGROUND_VALUES.has(p.value as BackgroundPreset)),
)

// Tint strength only matters for hue-tint colors — `mono` and the full background
// bases don't blend, so the slider is hidden for them.
const themeColorTints = computed(() => {
  const c = appearance.value.themeColor
  return c !== 'mono' && !BACKGROUND_VALUES.has(c as BackgroundPreset)
})

// Preset/custom values originate from the picker's own preset lists, so the cast
// back to the precise union is safe.
const onThemeColorPick = (value: string) => onUpdate({ themeColor: value as ThemeColor })
const onThemeColorCustom = (hex: string) =>
  onUpdate({ themeColor: 'custom', themeColorCustom: hex })
const onAccentPick = (value: string) => onUpdate({ accent: value as AccentPreset })
const onAccentCustom = (hex: string) => onUpdate({ accent: 'custom', accentCustom: hex })

const depthStyle = (value: SurfaceDepth) => {
  const active = appearance.value.surfaceDepth === value
  return {
    background: active ? t.value.accent : 'transparent',
    color: active ? t.value.accentText : t.value.textMuted,
    cursor: 'pointer',
  }
}
</script>
