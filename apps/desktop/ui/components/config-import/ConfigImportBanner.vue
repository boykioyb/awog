<template>
  <div>
    <div
      v-if="showBanner"
      class="rounded p-3 flex items-center gap-3"
      :style="{ background: t.infoBg, border: `1px solid ${t.infoBorder}` }"
    >
      <Download :size="15" :style="{ color: t.info, flexShrink: 0 }" />
      <div class="flex-1 min-w-0 text-[1em]" :style="{ color: t.text }">
        {{ tr('import.banner.message', { count: importableCount }) }}
      </div>
      <button
        class="px-2.5 py-1 text-[1em] rounded inline-flex items-center gap-1.5 transition flex-shrink-0"
        :style="{ background: t.accent, color: t.accentText }"
        @click="openDialog"
      >
        {{ tr('import.banner.import') }}
      </button>
      <button
        class="p-1 rounded transition flex-shrink-0"
        :style="{ color: t.textDim }"
        :title="tr('import.banner.dismiss')"
        @click="dismissed = true"
      >
        <X :size="13" />
      </button>
    </div>

    <div v-else class="flex justify-end">
      <button
        class="px-2.5 py-1 text-[1em] rounded inline-flex items-center gap-1.5 transition"
        :style="{ color: t.textMuted, border: `1px solid ${t.border}` }"
        :disabled="scanning"
        @click="onManualCheck"
      >
        <Download :size="12" :class="scanning ? 'animate-pulse' : ''" />
        {{ tr('import.banner.check') }}
      </button>
    </div>

    <ConfigImportDialog
      :open="dialogOpen"
      :candidates="candidates"
      :importing="importing"
      @close="dialogOpen = false"
      @confirm="onConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { Download, X } from 'lucide-vue-next'
import { useConfigImport, type ImportSelection } from '~/composables/useConfigImport'

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ imported: [{ imported: number; skipped: number }] }>()

const { t } = useTheme()
const { t: tr } = useI18n()

const { candidates, scanning, importing, importableCount, scan, importItems } = useConfigImport()

const dismissed = ref(false)
const dialogOpen = ref(false)

// Auto-banner: only when the project actually has importable (not-yet-imported)
// config and the user hasn't dismissed it.
const showBanner = computed(() => !dismissed.value && importableCount.value > 0)

// Re-scan whenever the selected project changes; reset the dismiss state so a
// fresh project shows its banner.
watch(
  () => props.projectId,
  (id) => {
    dismissed.value = false
    if (id) void scan(id)
  },
  { immediate: true },
)

const openDialog = () => {
  dialogOpen.value = true
}

// Manual re-check still works after dismiss (the button shows once the banner is
// gone). Re-opens the banner when fresh importable config is found.
const onManualCheck = async () => {
  await scan(props.projectId)
  dismissed.value = false
}

const onConfirm = async (items: ImportSelection[]) => {
  const result = await importItems(items, props.projectId)
  dialogOpen.value = false
  emit('imported', { imported: result.imported.length, skipped: result.skipped.length })
  // Re-scan so imported items drop out of the candidate list (idempotent).
  await scan(props.projectId)
}
</script>
