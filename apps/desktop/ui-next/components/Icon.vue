<template>
  <svg class="icn"><use :href="`#i-${name}`" /></svg>
</template>

<script setup lang="ts">
// Renders one glyph from the global IconSprite via <use>. Extra class/style are
// merged onto the <svg> by Vue's single-root attr fallthrough (e.g. sizing).
defineProps<{ name: string }>()
</script>
