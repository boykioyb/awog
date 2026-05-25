<template>
  <div class="flex items-start gap-4 py-3" :style="{ borderBottom: `1px solid ${t.border}` }">
    <div class="flex-1 min-w-0">
      <div class="text-[13px] font-medium" :style="{ color: t.text }">
        {{ label }}
      </div>
      <div v-if="hint" class="text-[11px] mt-0.5" :style="{ color: t.textDim }">
        {{ hint }}
      </div>
    </div>
    <div class="flex-shrink-0 min-w-[200px]">
      <div
        v-if="status === 'enabled'"
        class="text-[11px] inline-flex items-center gap-1.5"
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
}>()

const { t } = useTheme()
</script>
