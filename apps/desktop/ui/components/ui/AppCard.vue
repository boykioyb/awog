<template>
  <div
    class="rounded-xl overflow-hidden flex flex-col"
    :style="{
      background: elevated.background,
      border: `1px solid ${elevated.borderColor}`,
      backdropFilter: elevated.backdropFilter,
      boxShadow: elevated.boxShadow,
    }"
  >
    <div v-if="$slots.header" class="px-4 py-3" :style="{ borderBottom: `1px solid ${t.border}` }">
      <slot name="header" />
    </div>

    <div :class="[padded ? 'px-4 py-3' : '', 'flex-1 min-h-0']">
      <slot />
    </div>

    <div
      v-if="$slots.footer"
      class="px-4 py-3 flex items-center justify-end gap-2"
      :style="{ borderTop: `1px solid ${t.border}` }"
    >
      <slot name="footer" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Card primitive (ADR 0041). Raised surface via useGlass().elevated so it honors
// the app-wide liquid-glass toggle; header/footer are optional slots (hairline
// divider). `padded` is turned off when the content handles its own padding
// (e.g. a full-bleed scrolling list).
withDefaults(defineProps<{ padded?: boolean }>(), { padded: true })

const { t } = useTheme()
const { elevated } = useGlass()
</script>
