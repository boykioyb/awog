<template>
  <div v-if="block" class="py-3.5 space-y-2.5" :style="{ borderBottom: `1px solid ${t.border}` }">
    <div>
      <div class="text-[1em] font-medium" :style="{ color: t.text }">{{ label }}</div>
      <div v-if="hint" class="text-[1em] mt-1 leading-snug" :style="{ color: t.textDim }">
        {{ hint }}
      </div>
    </div>
    <div class="w-full">
      <slot />
    </div>
  </div>
  <div
    v-else
    class="flex items-start gap-4 py-3.5"
    :style="{ borderBottom: `1px solid ${t.border}` }"
  >
    <div class="flex-1 min-w-0">
      <div class="text-[1em] font-medium" :style="{ color: t.text }">{{ label }}</div>
      <div v-if="hint" class="text-[1em] mt-1 leading-snug" :style="{ color: t.textDim }">
        {{ hint }}
      </div>
    </div>
    <div class="flex-shrink-0 min-w-[200px] flex justify-end">
      <div
        v-if="status === 'enabled'"
        class="text-[1em] inline-flex items-center gap-1.5 px-2 py-1 rounded-full"
        :style="{ color: t.accent, background: t.bgSubtle, border: `1px solid ${t.border}` }"
      >
        <Check :size="12" />
        Enabled
      </div>
      <slot v-else />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Check } from 'lucide-vue-next'

defineProps<{
  label: string
  hint?: string
  status?: 'enabled'
  // When true, label/hint stack above the control and the control spans the
  // full row width. Use for textareas, long prompts, or any input that needs
  // breathing room.
  block?: boolean
}>()

const { t } = useTheme()
</script>
