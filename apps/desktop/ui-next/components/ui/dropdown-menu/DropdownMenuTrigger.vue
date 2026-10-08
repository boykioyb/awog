<template>
  <DropdownMenuTrigger v-bind="$attrs" class="outline-none">
    <slot />
  </DropdownMenuTrigger>
</template>

<script setup lang="ts">
import { DropdownMenuTrigger } from 'reka-ui'

defineOptions({ inheritAttrs: false })
</script>
