<template>
  <div :class="cn('flex h-full w-full min-h-0', props.class)">
    <slot />
  </div>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed, provide, ref } from 'vue'
import { cn } from '~/lib/utils'
import { sidebarKey } from './utils'

const props = withDefaults(
  defineProps<{
    defaultOpen?: boolean
    open?: boolean
    collapsible?: 'icon' | 'offcanvas' | 'none'
    class?: HTMLAttributes['class']
  }>(),
  // `open: undefined` defeats Vue's Boolean-cast (an absent boolean prop is
  // `false`, not `undefined`), so the prop stays a real tri-state: controlled
  // when passed, uncontrolled (defaultOpen) when omitted.
  { defaultOpen: true, open: undefined, collapsible: 'icon' },
)

const emits = defineEmits<(e: 'update:open', open: boolean) => void>()

const innerOpen = ref(props.defaultOpen)
const open = computed({
  get: () => props.open ?? innerOpen.value,
  set: (v) => {
    innerOpen.value = v
    emits('update:open', v)
  },
})

const collapsible = computed(() => props.collapsible)
const state = computed(() => (open.value ? 'expanded' : 'collapsed'))
const toggle = () => (open.value = !open.value)

provide(sidebarKey, { open, collapsible, state, toggle })
</script>
