<template>
  <svg
    class="mascot"
    :class="[`mascot--${state}`, { 'mascot--bob': bob }]"
    :width="size"
    :height="size"
    viewBox="0 0 32 32"
    fill="none"
    role="presentation"
    aria-hidden="true"
  >
    <!-- Antenna: the one "AI" cue. Its bulb pulses only while thinking. -->
    <line x1="16" y1="6.4" x2="16" y2="3.4" :stroke-width="sw" stroke-linecap="round" />
    <circle class="mascot-bulb" cx="16" cy="2.4" r="1.7" :fill="bulbFill" />

    <!-- Side ears/speakers — keep the silhouette readable at 16px. -->
    <rect x="2" y="12.5" width="2.8" height="5.5" rx="1.4" :stroke-width="sw" />
    <rect x="27.2" y="12.5" width="2.8" height="5.5" rx="1.4" :stroke-width="sw" />

    <!-- Head -->
    <rect
      class="mascot-head"
      x="5.4"
      y="6.4"
      width="21.2"
      height="17.2"
      rx="7"
      :stroke-width="sw"
    />

    <!-- Eyes: dots when awake, closed arcs when happy, dashes when asleep. -->
    <template v-if="state === 'happy'">
      <path d="M9.6 14.6q1.9-2 3.8 0" :stroke-width="sw" stroke-linecap="round" />
      <path d="M18.6 14.6q1.9-2 3.8 0" :stroke-width="sw" stroke-linecap="round" />
    </template>
    <template v-else-if="state === 'sleep'">
      <line x1="9.8" y1="14.6" x2="13.2" y2="14.6" :stroke-width="sw" stroke-linecap="round" />
      <line x1="18.8" y1="14.6" x2="22.2" y2="14.6" :stroke-width="sw" stroke-linecap="round" />
    </template>
    <template v-else>
      <circle cx="11.5" cy="14.3" r="1.75" fill="currentColor" stroke="none" />
      <circle cx="20.5" cy="14.3" r="1.75" fill="currentColor" stroke="none" />
    </template>

    <!-- Mouth -->
    <path :d="mouth" :stroke-width="sw" stroke-linecap="round" />

    <!-- Feet: two stubs so it reads as standing, not floating. -->
    <line x1="11" y1="23.6" x2="11" y2="26" :stroke-width="sw" stroke-linecap="round" />
    <line x1="21" y1="23.6" x2="21" y2="26" :stroke-width="sw" stroke-linecap="round" />

    <!-- Celebration sparkles (happy only) — the 10% of the 90/10 cute budget. -->
    <template v-if="state === 'happy'">
      <path d="M28.4 6.6v3M26.9 8.1h3" :stroke-width="sw" stroke-linecap="round" opacity=".75" />
      <path d="M4.2 4.4v2.2M3.1 5.5h2.2" :stroke-width="sw" stroke-linecap="round" opacity=".55" />
    </template>
    <!-- Sleep "z" -->
    <path
      v-else-if="state === 'sleep'"
      d="M25.6 6.6h2.6l-2.6 3h2.6"
      :stroke-width="sw"
      stroke-linecap="round"
      stroke-linejoin="round"
      opacity=".6"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

// AWOG's mascot — a small line-drawn assistant robot, drawn inline as SVG so it
// inherits `currentColor` and the theme tokens (no raster asset, no network fetch,
// crisp at every size, works in both themes).
//
// Deliberately NOT the desktop-pet sprite (components/pet): that one is a large
// per-user-configurable spritesheet driven by live agent status. This is a static
// brand/illustration mark for chrome + empty states, so it must be tiny and stable.
//
// Where it is allowed to appear (§13 — 90% professional, 10% cute): the sidebar
// logo, empty states, and a short success flash. Nowhere else — a mascot on every
// row would turn a developer tool into a children's app.
type MascotState = 'idle' | 'happy' | 'sleep'

const props = withDefaults(
  defineProps<{
    size?: number
    state?: MascotState
    // Slow idle bob. Off by default: motion belongs to the moment something
    // happened (an empty state that breathes forever is just noise).
    bob?: boolean
  }>(),
  { size: 20, state: 'idle', bob: false },
)

// Stroke weight is scaled so the line stays visually equal at 16px and at 72px
// (a fixed 1.7 goes hairline when the mark is blown up for an empty state).
const sw = computed(() => Math.max(1.1, Math.min(1.9, 30 / props.size + 1.05)))
const MOUTH: Record<MascotState, string> = {
  idle: 'M13.2 18.4q2.8 2 5.6 0',
  happy: 'M12.4 18q3.6 3.2 7.2 0',
  sleep: 'M14 19h4',
}
const mouth = computed(() => MOUTH[props.state])
// A lit bulb while happy; hollow otherwise.
const bulbFill = computed(() => (props.state === 'happy' ? 'currentColor' : 'none'))
</script>

<style scoped>
/* One color source: the mark inherits `currentColor` for strokes, so a caller sets
   the tone by setting `color` (accent in the logo, textDim in an empty state). */
.mascot {
  flex: 0 0 auto;
  stroke: currentColor;
  fill: none;
  stroke-linejoin: round;
  overflow: visible;
}
.mascot-head {
  fill: color-mix(in srgb, currentColor 10%, transparent);
}
.mascot--bob {
  animation: mascot-bob 3.2s var(--ease) infinite;
}
@keyframes mascot-bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-2px);
  }
}
/* Thinking/idle bulb breathes very slightly so the mark feels alive without
   pulling attention. */
.mascot--happy .mascot-bulb {
  animation: mascot-bulb 1.4s ease-in-out 2;
}
@keyframes mascot-bulb {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mascot--bob,
  .mascot--happy .mascot-bulb {
    animation: none;
  }
}
</style>
