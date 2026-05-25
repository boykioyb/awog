<template>
  <div
    class="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 p-3"
    style="background: rgba(0, 0, 0, 0.5)"
    @click="emit('cancel')"
  >
    <div
      class="w-full max-w-[420px] rounded-lg overflow-hidden flex flex-col"
      :style="{
        background: t.bgPanel,
        border: `1px solid ${t.borderStrong}`,
        boxShadow: `0 20px 60px ${t.shadow}`,
      }"
      @click.stop
    >
      <div
        class="px-4 py-3 flex items-center gap-2"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <AlertCircle :size="14" :style="{ color: t.danger }" />
        <div class="text-sm font-medium" :style="{ color: t.text }">
          {{ title }}
        </div>
      </div>
      <div class="p-4">
        <div class="text-[12px] leading-relaxed" :style="{ color: t.textMuted }">
          {{ description }}
        </div>
      </div>
      <div class="px-4 py-3 flex justify-end gap-2" :style="{ borderTop: `1px solid ${t.border}` }">
        <button
          class="px-3 py-1.5 text-xs rounded transition"
          :style="{ color: t.textMuted }"
          @click="emit('cancel')"
        >
          Cancel
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded font-medium transition"
          :style="{ background: t.danger, color: '#ffffff' }"
          @click="emit('confirm')"
        >
          Delete
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { AlertCircle } from 'lucide-vue-next'

defineProps<{
  title: string
  description: string
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const { t } = useTheme()
</script>
