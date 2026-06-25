<template>
  <div class="space-y-7">
    <div>
      <h2 class="text-lg font-semibold tracking-tight" :style="{ color: t.text }">Workspace</h2>
      <div class="text-[1em] mt-1" :style="{ color: t.textDim }">
        Local storage location and workspace tools
      </div>
    </div>
    <div
      class="rounded-xl px-4 [&>*:last-child]:border-b-0"
      :style="{ background: cardBg, border: `1px solid ${t.border}` }"
    >
      <SettingsField
        label="Workspace path"
        hint="Filesystem location for agents, workflows, artifacts, and sessions"
        block
      >
        <input
          v-model="settings.workspacePath"
          class="w-full rounded-lg px-2.5 py-2 text-[1em] font-mono"
          :style="inputStyle"
        />
      </SettingsField>
      <SettingsField
        label="Git versioning"
        hint="All artifacts are committed to Git automatically"
        status="enabled"
      />
      <SettingsField
        label="Import config from .claude / .agents"
        hint="Scan ~/.claude and ~/.agents for agents, skills, hooks, rules, and commands to copy into .awog"
      >
        <button
          type="button"
          class="px-3 py-1.5 text-[1em] rounded-lg inline-flex items-center gap-1.5 transition"
          :style="{ color: t.text, border: `1px solid ${t.borderStrong}`, background: t.bgSubtle }"
          :disabled="scanning"
          @click="openGlobalImport"
        >
          <Download :size="13" :class="scanning ? 'animate-pulse' : ''" />
          {{ tr('import.banner.check') }}
        </button>
      </SettingsField>
      <SettingsField
        label="Diagnostics"
        hint="Open the app log file — updater activity, engine output, and errors"
      >
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-[1em] transition flex items-center gap-1.5"
          :style="{ border: `1px solid ${t.border}`, color: t.text, background: t.bgSubtle }"
          @click="onOpenLogs"
        >
          <ScrollText :size="13" />
          Open logs
        </button>
      </SettingsField>
    </div>

    <ConfigImportDialog
      :open="importDialogOpen"
      :candidates="candidates"
      :importing="importing"
      @close="importDialogOpen = false"
      @confirm="onImportConfirm"
    />

    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="px-3 py-2 rounded-lg text-[1em] shadow-lg"
        :style="toastStyle(toast.kind)"
      >
        {{ toast.text }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Download, ScrollText } from 'lucide-vue-next'
import { useConfigImport, type ImportSelection } from '~/composables/useConfigImport'

const { t } = useTheme()
const { cardBg } = useSettingsSurface()
const { t: tr } = useI18n()
const settings = useSettingsStore()
const sidecar = useSidecar()
const { toasts, pushToast, toastStyle } = useToasts()

// Global config import (ADR 0035) — scans ~/.claude / ~/.agents (no projectId).
const { candidates, scanning, importing, scan, importItems } = useConfigImport()
const importDialogOpen = ref(false)

const openGlobalImport = async () => {
  await scan()
  importDialogOpen.value = true
}

const onImportConfirm = async (items: ImportSelection[]) => {
  const result = await importItems(items)
  importDialogOpen.value = false
  pushToast(
    tr('import.toast.done', {
      imported: result.imported.length,
      skipped: result.skipped.length,
    }),
    'success',
  )
}

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const onOpenLogs = async () => {
  try {
    await sidecar.openLogs()
  } catch {
    pushToast('Logs are only available in the installed app', 'info')
  }
}
</script>
