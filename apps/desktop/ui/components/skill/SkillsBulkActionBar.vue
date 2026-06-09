<template>
  <div
    class="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-full shadow-lg flex items-center gap-3 px-4 py-2"
    :style="{
      background: overlay.background,
      border: `1px solid ${overlay.borderColor}`,
      backdropFilter: overlay.backdropFilter,
      boxShadow: overlay.boxShadow,
    }"
  >
    <span class="text-[1em]" :style="{ color: t.text }">
      {{ count }} skill{{ count === 1 ? '' : 's' }} selected
    </span>
    <button
      class="text-[1em] inline-flex items-center gap-1.5 px-2.5 py-1 rounded transition"
      :style="{ color: t.textMuted, border: `1px solid ${t.border}` }"
      :disabled="deleting"
      @click="$emit('cancel')"
    >
      Cancel
    </button>
    <button
      class="text-[1em] inline-flex items-center gap-1.5 px-3 py-1 rounded font-medium transition"
      :style="{
        background: t.dangerBg,
        color: t.danger,
        border: `1px solid ${t.dangerBorder}`,
      }"
      :disabled="deleting"
      @click="$emit('delete')"
    >
      <Loader2 v-if="deleting" :size="11" class="animate-spin" />
      <Trash2 v-else :size="11" />
      Delete {{ count }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { Loader2, Trash2 } from 'lucide-vue-next'

type Props = {
  count: number
  deleting: boolean
}

defineProps<Props>()

defineEmits<{
  cancel: []
  delete: []
}>()

const { t } = useTheme()
const { overlay } = useGlass()
</script>
