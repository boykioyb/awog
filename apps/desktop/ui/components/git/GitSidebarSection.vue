<template>
  <div class="flex flex-col">
    <div
      class="group flex cursor-pointer select-none items-center gap-1 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      @click="emit('toggle')"
    >
      <ChevronRight v-if="!open" :size="11" />
      <ChevronDown v-else :size="11" />
      <component :is="icon" v-if="icon" :size="12" class="ml-0.5" />
      <span class="ml-1 flex-1 truncate text-[1em] font-medium uppercase tracking-wider">
        {{ label }}
      </span>
      <span
        v-if="count !== undefined && count > 0"
        class="font-mono text-[12px] leading-none text-muted-foreground"
      >
        {{ count }}
      </span>
      <AppButton
        v-if="actionIcon"
        variant="ghost"
        size="icon"
        class="opacity-0 transition group-hover:opacity-100"
        :title="actionTitle ?? ''"
        @click.stop="emit('action')"
      >
        <component :is="actionIcon" :size="11" />
      </AppButton>
    </div>
    <div v-if="open" class="flex flex-col">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import type { Component } from 'vue'

type Props = {
  label: string
  icon?: Component
  open: boolean
  count?: number
  actionIcon?: Component
  actionTitle?: string
}

withDefaults(defineProps<Props>(), {
  icon: undefined,
  count: undefined,
  actionIcon: undefined,
  actionTitle: undefined,
})

const emit = defineEmits<{
  toggle: []
  action: []
}>()
</script>
