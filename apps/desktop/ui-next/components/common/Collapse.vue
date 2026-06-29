<template>
  <!-- Height-animated reveal for collapsible regions (step/cluster bodies, panels).
       Uses the grid-template-rows 0fr↔1fr technique: animatable, CSS-only, and
       collapses to exactly the content height with no magic max-height. The inner
       wrapper clips overflow during the transition. Disabled under reduced-motion. -->
  <div class="collapsible" :class="{ open }">
    <div class="collapsible-in">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ open: boolean }>()
</script>

<style scoped>
/* Class name is `collapsible`, NOT `collapse`: Tailwind ships a `.collapse`
   utility (`visibility: collapse`) which, applied to this wrapper, renders the
   revealed content as invisible-but-space-occupying in Chromium (an empty box
   under the header). Scoped styles don't set `visibility`, so the utility wins.
   See reference: Tailwind utility class-name collisions in ui-next. */
.collapsible {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.18s ease;
}
.collapsible.open {
  grid-template-rows: 1fr;
}
.collapsible-in {
  overflow: hidden;
  min-height: 0;
}
@media (prefers-reduced-motion: reduce) {
  .collapsible {
    transition: none;
  }
}
</style>
