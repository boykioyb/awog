<template>
  <div v-if="block" class="py-3 space-y-2" :style="{ borderBottom: `1px solid ${t.border}` }">
    <div>
      <div class="text-[0.93em] font-medium" :style="{ color: t.text }">{{ label }}</div>
      <div v-if="hint" class="text-[0.79em] mt-0.5" :style="{ color: t.textDim }">{{ hint }}</div>
    </div>
    <div class="w-full">
      <slot />
    </div>
  </div>
  <div
    v-else
    class="flex items-start gap-4 py-3"
    :style="{ borderBottom: `1px solid ${t.border}` }"
  >
    <div class="flex-1 min-w-0">
      <div class="text-[0.93em] font-medium" :style="{ color: t.text }">{{ label }}</div>
      <div v-if="hint" class="text-[0.79em] mt-0.5" :style="{ color: t.textDim }">{{ hint }}</div>
    </div>
    <div class="flex-shrink-0 min-w-[200px]">
      <div
        v-if="status === 'enabled'"
        class="text-[0.79em] inline-flex items-center gap-1.5"
        :style="{ color: t.text }"
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
