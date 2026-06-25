<template>
  <div class="field" :class="{ block }">
    <div class="fl">
      <div class="fn">
        <slot name="name">{{ name }}</slot>
      </div>
      <div v-if="desc || $slots.desc" class="fd">
        <slot name="desc">{{ desc }}</slot>
      </div>
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
// One settings row — ports the fld(name, desc, ctrl) helper (.field > .fl > .fn/.fd + control).
// The control goes in the default slot; name/desc accept slots for inline markup.
// `block` stacks the control full-width under the label (for textareas / pickers).
withDefaults(
  defineProps<{
    name?: string
    desc?: string
    block?: boolean
  }>(),
  { name: '', desc: '', block: false },
)
</script>

<style scoped>
.field.block {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.field.block > :deep(*:last-child) {
  width: 100%;
}
</style>
