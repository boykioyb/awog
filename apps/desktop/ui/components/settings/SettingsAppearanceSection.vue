<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Appearance</h2>
      <div class="text-xs" :style="{ color: t.textDim }">
        Customize fonts and theme used across the app
      </div>
    </div>

    <div :style="{ borderTop: `1px solid ${t.border}` }">
      <SettingsField label="Theme" hint="Toggle via moon/sun icon in the sidebar">
        <div class="text-[0.86em]" :style="{ color: t.textMuted }">
          {{ themeName === 'dark' ? 'Dark' : 'Light' }}
        </div>
      </SettingsField>

      <SettingsField label="Sans font" hint="Body and UI typography">
        <select
          v-model="appearance.sansFamily"
          class="w-full px-2 py-1.5 rounded text-[0.86em] outline-none"
          :style="selectStyle"
          @change="onUpdate({ sansFamily: appearance.sansFamily })"
        >
          <option v-for="o in SANS_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
      </SettingsField>

      <SettingsField label="Mono font" hint="Code blocks, terminals, debug output">
        <select
          v-model="appearance.monoFamily"
          class="w-full px-2 py-1.5 rounded text-[0.86em] outline-none"
          :style="selectStyle"
          @change="onUpdate({ monoFamily: appearance.monoFamily })"
        >
          <option v-for="o in MONO_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
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
        <select
          v-model.number="appearance.fontWeight"
          class="w-full px-2 py-1.5 rounded text-[0.86em] outline-none"
          :style="selectStyle"
          @change="onUpdate({ fontWeight: appearance.fontWeight })"
        >
          <option v-for="o in WEIGHT_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
      </SettingsField>

      <SettingsField label="Theme color" hint="Subtle hue tint applied across all surfaces">
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            v-for="p in THEME_COLOR_PRESETS"
            :key="p.value"
            :title="p.label"
            class="w-6 h-6 rounded-full transition-transform hover:scale-110"
            :style="themeColorSwatchStyle(p.value, p.swatch)"
            @click="onUpdate({ themeColor: p.value })"
          />
          <label
            class="relative w-6 h-6 rounded-full transition-transform hover:scale-110 cursor-pointer overflow-hidden"
            :title="`Custom (${appearance.themeColorCustom})`"
            :style="customSwatchStyle"
          >
            <input
              type="color"
              class="absolute inset-0 opacity-0 cursor-pointer"
              :value="appearance.themeColorCustom"
              @input="onCustomColorInput"
            />
          </label>
        </div>
      </SettingsField>

      <SettingsField label="Accent color" hint="Buttons, links, focus rings, active items">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="p in ACCENT_PRESETS"
            :key="p.value"
            :title="p.label"
            class="w-6 h-6 rounded-full transition-transform hover:scale-110"
            :style="accentSwatchStyle(p.value, p.swatch)"
            @click="onUpdate({ accent: p.value })"
          />
        </div>
      </SettingsField>

      <SettingsField label="Surface depth" hint="Layer contrast between panels">
        <div class="flex rounded overflow-hidden" :style="{ border: `1px solid ${t.border}` }">
          <button
            v-for="o in SURFACE_DEPTH_OPTIONS"
            :key="o.value"
            class="flex-1 px-3 py-1.5 text-[0.86em] transition-colors"
            :style="depthStyle(o.value)"
            :title="o.hint"
            @click="onUpdate({ surfaceDepth: o.value })"
          >
            {{ o.label }}
          </button>
        </div>
      </SettingsField>
    </div>

    <div>
      <div class="text-[0.79em] mb-2 uppercase tracking-wider" :style="{ color: t.textDim }">
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
            <code class="font-mono text-[0.86em]" :style="{ color: t.accent }">bgPanel</code>
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
              class="px-3 py-1.5 rounded text-[0.86em] font-medium"
              :style="{ background: t.accent, color: t.accentText }"
            >
              Primary action
            </button>
            <button
              class="px-3 py-1.5 rounded text-[0.86em]"
              :style="{ background: t.bgHover, color: t.text, border: `1px solid ${t.border}` }"
            >
              Secondary
            </button>
            <a class="text-[0.86em]" :style="{ color: t.accent }">Link</a>
          </div>
          <pre
            class="font-mono text-[0.86em] p-2 rounded"
            :style="{ background: t.bgElevated, border: `1px solid ${t.border}`, color: t.textDim }"
          >
const sum = (a: number, b: number) =&gt; a + b</pre
          >
        </div>
      </div>
    </div>

    <div class="flex justify-end">
      <button
        class="px-3 py-1.5 rounded text-[0.86em]"
        :style="{ border: `1px solid ${t.border}`, color: t.textDim }"
        @click="reset"
      >
        Reset to defaults
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AccentPreset, AppearanceSettings, SurfaceDepth, ThemeColor } from '~/types'
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  MONO_OPTIONS,
  SANS_OPTIONS,
  WEIGHT_OPTIONS,
  useAppearance,
} from '~/composables/useAppearance'
import { ACCENT_PRESETS, SURFACE_DEPTH_OPTIONS, THEME_COLOR_PRESETS } from '~/utils/theme-presets'

const { t, themeName } = useTheme()
const { appearance, update, reset } = useAppearance()

const onUpdate = (patch: Partial<AppearanceSettings>) => {
  update(patch)
}

const selectStyle = computed(() => ({
  background: t.value.bg,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
}))

const buildSwatchStyle = (swatch: string, active: boolean) => ({
  background: swatch,
  border: `2px solid ${active ? t.value.text : 'transparent'}`,
  boxShadow: active ? `0 0 0 1px ${t.value.bgPanel} inset` : 'none',
  cursor: 'pointer',
})

const accentSwatchStyle = (value: AccentPreset, swatch: string) =>
  buildSwatchStyle(swatch, appearance.value.accent === value)

const themeColorSwatchStyle = (value: ThemeColor, swatch: string) =>
  buildSwatchStyle(swatch, appearance.value.themeColor === value)

const customSwatchStyle = computed(() =>
  buildSwatchStyle(appearance.value.themeColorCustom, appearance.value.themeColor === 'custom'),
)

const onCustomColorInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  const hex = target.value.toLowerCase()
  onUpdate({ themeColor: 'custom', themeColorCustom: hex })
}

const depthStyle = (value: SurfaceDepth) => {
  const active = appearance.value.surfaceDepth === value
  return {
    background: active ? t.value.accent : 'transparent',
    color: active ? t.value.accentText : t.value.textMuted,
    cursor: 'pointer',
  }
}
</script>
