<template>
  <div
    class="px-3 py-1.5 flex items-center gap-2 text-[0.79em]"
    :style="{
      background: t.warningBg,
      color: t.warning,
      borderBottom: `1px solid ${t.warningBorder}`,
    }"
  >
    <AlertTriangle :size="12" />
    <span class="font-medium">DETACHED HEAD</span>
    <span v-if="detachedAt" class="font-mono" :style="{ color: t.textDim }">
      at {{ detachedAt }}
    </span>
    <span :style="{ color: t.textDim }">— commit ở đây sẽ mất nếu không tạo branch trước.</span>
  </div>
</template>

<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'

type Props = {
  detachedAt: string | null
}

defineProps<Props>()

const { t } = useTheme()
</script>
