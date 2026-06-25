<template>
  <div class="space-y-2">
    <!-- Preset swatches + native custom color-picker swatch -->
    <div class="flex flex-wrap items-center gap-1.5">
      <button
        v-for="p in presets"
        :key="p.value"
        type="button"
        :title="p.label"
        class="w-6 h-6 rounded-full transition-transform hover:scale-110"
        :style="swatchStyle(p.value, p.swatch)"
        @click="emit('pick', p.value)"
      />
      <label
        class="relative w-6 h-6 rounded-full transition-transform hover:scale-110 cursor-pointer overflow-hidden"
        :title="`Custom (#${normalizedCustom})`"
        :style="swatchStyle('custom', customHex)"
      >
        <input
          type="color"
          class="absolute inset-0 opacity-0 cursor-pointer"
          :value="customHex"
          @input="onPickerInput"
        />
      </label>
    </div>

    <!-- Hex code text input — typing a 6-digit value selects the custom color -->
    <div
      class="inline-flex items-center rounded-lg overflow-hidden w-fit"
      :style="{
        background: t.bgInput,
        border: `1px solid ${selected === 'custom' ? t.borderFocus : t.border}`,
      }"
    >
      <span class="pl-2 pr-0.5 text-[1em] font-mono select-none" :style="{ color: t.textDim }">
        #
      </span>
      <input
        v-model="draft"
        type="text"
        maxlength="6"
        spellcheck="false"
        autocapitalize="off"
        placeholder="rrggbb"
        class="w-[8ch] py-1 pr-2 bg-transparent outline-none text-[1em] font-mono lowercase"
        :style="{ color: t.text }"
        @input="onHexInput"
        @blur="syncDraft"
        @keydown.enter="syncDraft"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
type ColorPreset = { value: string; label: string; swatch: string }

const props = defineProps<{
  presets: ColorPreset[]
  // Currently selected value: a preset value or 'custom'.
  selected: string
  // Committed custom hex (`#rrggbb`).
  customHex: string
}>()

const emit = defineEmits<{
  (e: 'pick', value: string): void
  (e: 'pick-custom', hex: string): void
}>()

const { t } = useTheme()

const HEX6_RE = /^[0-9a-f]{6}$/

const normalizedCustom = computed(() => props.customHex.replace('#', '').toLowerCase())
const draft = ref(normalizedCustom.value)

// Keep the draft in sync when the custom color changes from outside (native picker).
watch(normalizedCustom, (next) => {
  draft.value = next
})

const swatchStyle = (value: string, swatch: string) => {
  const active = props.selected === value
  return {
    background: swatch,
    // Faint border when inactive so near-black swatches stay visible against the
    // panel; text-colored ring when active.
    border: `2px solid ${active ? t.value.text : t.value.border}`,
    boxShadow: active ? `0 0 0 1px ${t.value.bgPanel} inset` : 'none',
    cursor: 'pointer',
  }
}

const onPickerInput = (event: Event) => {
  emit('pick-custom', (event.target as HTMLInputElement).value.toLowerCase())
}

const onHexInput = () => {
  const cleaned = draft.value.replace(/[^0-9a-fA-F]/g, '').toLowerCase()
  if (cleaned !== draft.value) draft.value = cleaned
  if (HEX6_RE.test(cleaned)) emit('pick-custom', `#${cleaned}`)
}

// Snap the draft back to the committed value (drops an incomplete entry on blur).
const syncDraft = () => {
  draft.value = normalizedCustom.value
}
</script>
