<template>
  <DropdownMenuTrigger v-bind="forwarded" class="outline-none">
    <slot />
  </DropdownMenuTrigger>
</template>

<script setup lang="ts">
import { DropdownMenuTrigger, type DropdownMenuTriggerProps, useForwardProps } from 'reka-ui'

const props = defineProps<DropdownMenuTriggerProps>()

const forwarded = useForwardProps(props)
</script>
