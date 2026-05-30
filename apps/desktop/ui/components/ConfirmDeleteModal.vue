<template>
  <BaseModal :open="true" size="sm" @close="emit('cancel')">
    <template #header>
      <div class="flex items-center gap-2">
        <AlertCircle :size="14" :style="{ color: t.danger }" />
        <div class="text-sm font-medium" :style="{ color: t.text }">{{ title }}</div>
      </div>
    </template>

    <div class="p-4 space-y-3">
      <div class="text-[0.86em] leading-relaxed" :style="{ color: t.textMuted }">
        {{ description }}
      </div>
      <slot name="extra" />
    </div>

    <template #footer>
      <button
        class="px-3 py-1.5 text-xs rounded transition"
        :style="{ color: t.textMuted }"
        @click="emit('cancel')"
      >
        Cancel
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded font-medium transition"
        :style="{ background: t.danger, color: t.onAccent }"
        @click="emit('confirm')"
      >
        Delete
      </button>
    </template>
  </BaseModal>
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
