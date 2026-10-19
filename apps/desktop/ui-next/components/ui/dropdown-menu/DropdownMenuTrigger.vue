<template>
  <DropdownMenuTrigger v-bind="$attrs" class="outline-hidden">
    <slot />
  </DropdownMenuTrigger>
</template>

<script setup lang="ts">
import { DropdownMenuTrigger } from 'reka-ui'

defineOptions({ inheritAttrs: false })
</script>
