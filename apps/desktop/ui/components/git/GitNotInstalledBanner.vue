<template>
  <div
    class="flex-1 flex flex-col items-center justify-center gap-4 px-6"
    :style="{ background: t.bg, color: t.text }"
  >
    <AlertTriangle :size="48" :stroke-width="1.5" :style="{ color: t.warning }" />
    <div class="text-center max-w-md">
      <div class="text-sm font-medium mb-2" :style="{ color: t.text }">
        {{ headline }}
      </div>
      <div class="text-xs leading-relaxed" :style="{ color: t.textDim }">
        {{ description }}
      </div>
    </div>
    <button
      class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition"
      :style="{
        background: t.bgInput,
        color: t.accent,
        border: `1px solid ${t.accent}`,
      }"
      @click="onDownload"
    >
      <Download :size="12" />
      Download Git
    </button>
  </div>
</template>

<script setup lang="ts">
import { AlertTriangle, Download } from 'lucide-vue-next'

const props = defineProps<{
  installed: boolean
  version: string
  required: string
}>()

const { t } = useTheme()
const sidecar = useSidecar()

const headline = computed(() =>
  props.installed ? 'Git version cũ — không hỗ trợ' : 'Git CLI không được tìm thấy',
)
const description = computed(() => {
  if (props.installed) {
    return `AWOG yêu cầu Git ≥ ${props.required}. Phiên bản hiện tại: ${props.version || 'unknown'}. Vui lòng nâng cấp Git rồi restart AWOG.`
  }
  return `AWOG cần Git CLI ≥ ${props.required} để versioning workspace. Cài Git rồi restart AWOG.`
})

const onDownload = async () => {
  try {
    await sidecar.openExternal('https://git-scm.com/downloads')
  } catch {
    // No-op in browser dev.
  }
}
</script>
