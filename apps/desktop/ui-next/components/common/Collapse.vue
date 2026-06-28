<template>
  <!-- Height-animated reveal for collapsible regions (step/cluster bodies, panels).
       Uses the grid-template-rows 0fr↔1fr technique: animatable, CSS-only, and
       collapses to exactly the content height with no magic max-height. The inner
       wrapper clips overflow during the transition. Disabled under reduced-motion. -->
  <div class="collapse" :class="{ open }">
    <div class="collapse-in">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ open: boolean }>()
</script>

<style scoped>
.collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.18s ease;
}
.collapse.open {
  grid-template-rows: 1fr;
}
.collapse-in {
  overflow: hidden;
  min-height: 0;
}
@media (prefers-reduced-motion: reduce) {
  .collapse {
    transition: none;
  }
}
</style>
