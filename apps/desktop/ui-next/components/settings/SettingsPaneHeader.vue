<template>
  <div class="setpaneh">
    <div class="setpanet">{{ title }}</div>
    <div v-if="subtitle || $slots.default" class="setpanesub">
      <slot>{{ subtitle }}</slot>
    </div>
  </div>
</template>

<script setup lang="ts">
// Settings pane title block — a clear, prominent heading (+ optional subtitle) for
// each Settings section. Replaces the faint uppercase `.sech` micro-label that
// read as a tag rather than a section title. `.sech` stays the right style for
// sub-section dividers inside a pane; this is the pane's primary title.
withDefaults(
  defineProps<{
    title: string
    subtitle?: string
  }>(),
  { subtitle: '' },
)
</script>

<style scoped>
.setpaneh {
  margin: 0 0 10px;
}
.setpanet {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--text);
  line-height: var(--lh-md);
}
.setpanesub {
  margin-top: 4px;
  font-size: var(--fs-sm);
  color: var(--textDim);
  line-height: var(--lh-md);
}
</style>
