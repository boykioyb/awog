<template>
  <svg
    v-if="icon"
    class="brandicon"
    :style="{ width: `${size}px`, height: `${size}px` }"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path v-if="icon.kind === 'path'" :d="icon.d" :fill="icon.fill" />
    <rect
      v-for="(r, i) in icon.kind === 'rects' ? icon.rects : []"
      :key="i"
      :x="r.x"
      :y="r.y"
      :width="r.w"
      :height="r.h"
      :fill="r.fill"
    />
  </svg>
</template>

<script setup lang="ts">
// Renders a bundled brand mark (utils/brand-icons.ts) for a provider. Renders
// nothing for an unknown provider — callers keep their own fallback (emoji or
// lucide glyph) behind a `v-if="brandIcon(...)"` check.
import { computed } from 'vue'
import { brandIcon } from '~/utils/brand-icons'

const props = defineProps<{
  provider: string | undefined | null
  size: number
}>()

const icon = computed(() => brandIcon(props.provider))
</script>
