<template>
  <div
    class="px-3 py-1.5 flex items-center gap-2 text-[1em]"
    :style="{
      background: t.warningBg,
      color: t.warning,
      borderBottom: `1px solid ${t.warningBorder}`,
    }"
  >
    <AlertTriangle :size="12" />
    <span class="font-medium">{{ tr('git.detached.label') }}</span>
    <span v-if="detachedAt" class="font-mono" :style="{ color: t.textDim }">
      {{ tr('git.detached.at', { sha: detachedAt }) }}
    </span>
    <span :style="{ color: t.textDim }">{{ tr('git.detached.warn') }}</span>
  </div>
</template>

<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'

type Props = {
  detachedAt: string | null
}

defineProps<Props>()

const { t } = useTheme()
const { t: tr } = useI18n()
</script>
