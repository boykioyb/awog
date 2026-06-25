<template>
  <div class="tog" :class="{ off: !model }" @click="model = !model" />
</template>

<script setup lang="ts">
// Toggle switch — ports tog(on). Controlled via v-model.
const model = defineModel<boolean>({ required: true })
</script>
