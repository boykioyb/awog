<template>
  <!-- Height-animated reveal for collapsible regions (step/cluster bodies, panels).
       Uses the grid-template-rows 0fr↔1fr technique: animatable, CSS-only, and
       collapses to exactly the content height with no magic max-height. The inner
       wrapper clips overflow during the transition. Disabled under reduced-motion. -->
  <div
    class="grid transition-[grid-template-rows] duration-180 ease-out motion-reduce:transition-none"
    :class="open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
  >
    <!-- `collapsible-in` giữ làm hook: SessionQuestionDrawer ghi đè qua
         `:deep(.collapsible-in)`. Không mang style. -->
    <div class="collapsible-in min-h-0 overflow-hidden">
      <!-- Lazy-mount: a transcript carries ~hundreds of collapsed step bodies
           (code views, diffs). Mounting them all on open made session load feel
           heavy even though the wire got smaller — mount the content on FIRST
           open, keep it mounted after (the grid-row animation still needs a
           live element to collapse into, so unmounting on close is off the
           table). -->
      <slot v-if="rendered" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ open: boolean }>()
const rendered = ref(props.open)
watch(
  () => props.open,
  (open) => {
    if (open) rendered.value = true
  },
)
</script>
