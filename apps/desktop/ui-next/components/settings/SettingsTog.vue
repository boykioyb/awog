<template>
  <Switch v-model:checked="model" />
</template>

<script setup lang="ts">
// Toggle switch — shadcn Switch (Reka SwitchRoot). Giữ API v-model như bản .tog cũ.
import Switch from '~/components/ui/switch/Switch.vue'

const model = defineModel<boolean>({ required: true })
</script>
