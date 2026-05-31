<template>
  <div class="flex flex-col">
    <div
      class="group flex items-center gap-1 px-2 py-1 cursor-pointer select-none"
      :style="{ color: t.textDim }"
      @click="emit('toggle')"
    >
      <ChevronRight v-if="!open" :size="11" />
      <ChevronDown v-else :size="11" />
      <component :is="icon" v-if="icon" :size="12" :style="{ marginLeft: '2px' }" />
      <span class="text-[1em] uppercase tracking-wider font-medium ml-1 flex-1 truncate">
        {{ label }}
      </span>
      <span v-if="count !== undefined && count > 0" class="text-[12px] font-mono leading-none">
        ({{ count }})
      </span>
      <button
        v-if="actionIcon"
        class="opacity-0 group-hover:opacity-100 p-0.5 rounded transition"
        :title="actionTitle ?? ''"
        :style="{ color: t.textDim }"
        @click.stop="emit('action')"
      >
        <component :is="actionIcon" :size="11" />
      </button>
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

const { t } = useTheme()
</script>
