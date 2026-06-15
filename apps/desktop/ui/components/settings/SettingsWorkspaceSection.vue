<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Workspace</h2>
      <div class="text-[1em]" :style="{ color: t.textDim }">
        Local storage and Git settings for this workspace
      </div>
    </div>
    <div class="space-y-4">
      <SettingsField
        label="Workspace path"
        hint="Filesystem location for agents, workflows, artifacts, and sessions"
      >
        <input
          v-model="settings.workspacePath"
          class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
          :style="inputStyle"
        />
      </SettingsField>
      <SettingsField
        label="Git versioning"
        hint="All artifacts are committed to Git automatically"
        status="enabled"
      />
      <SettingsField
        label="Auto-approve trivial steps"
        hint="Skip approval gates for low-risk phases"
      >
        <AppToggle v-model="settings.autoApprove" />
      </SettingsField>
      <SettingsField
        label="Notifications"
        hint="Show system notifications when a task needs approval"
      >
        <AppToggle v-model="settings.notificationsEnabled" />
      </SettingsField>
      <SettingsField :label="tr('settings.pasteAsFile')" :hint="tr('settings.pasteAsFile.hint')">
        <AppToggle
          :model-value="composer.pasteAsFile"
          @update:model-value="updateComposer({ pasteAsFile: $event })"
        />
      </SettingsField>
      <SettingsField
        v-if="composer.pasteAsFile"
        :label="tr('settings.pasteThreshold')"
        :hint="tr('settings.pasteThreshold.hint')"
      >
        <input
          type="number"
          min="200"
          step="100"
          :value="composer.pasteThreshold"
          class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
          :style="inputStyle"
          @input="onPasteThresholdInput($event)"
        />
      </SettingsField>
      <SettingsField
        label="Import config from .claude / .agents"
        hint="Scan ~/.claude and ~/.agents for agents, skills, hooks, rules, and commands to copy into .awog"
      >
        <button
          type="button"
          class="px-3 py-1.5 text-[1em] rounded inline-flex items-center gap-1.5 transition"
          :style="{ color: t.text, border: `1px solid ${t.borderStrong}` }"
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
          class="px-2.5 py-1 rounded text-[1em] transition flex items-center gap-1.5"
          :style="{ border: `1px solid ${t.border}`, color: t.text }"
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
        class="px-3 py-2 rounded text-[1em] shadow-lg"
        :style="toastStyle(toast.kind)"
      >
        {{ toast.text }}
      </div>
    </div>

    <!-- Git / Auto-commit (M6) -->
    <div class="pt-2">
      <h3 class="text-[1em] font-semibold mb-1" :style="{ color: t.text }">Git / Auto-commit</h3>
      <div class="text-[1em] mb-3" :style="{ color: t.textDim }">
        How AWOG commits when the engine finishes a phase, and how dirty trees are handled before a
        new task.
      </div>
      <div class="space-y-4">
        <SettingsField
          label="Auto-commit per phase"
          hint="Engine commits artifacts automatically each time a phase completes"
        >
          <AppToggle
            :model-value="git.autoCommitPerPhase"
            @update:model-value="update({ autoCommitPerPhase: $event })"
          />
        </SettingsField>

        <SettingsField
          label="Commit message template"
          hint="Supported tokens: {phaseId} {agentName} {agentRole} {skillName} {taskId} {taskTitle} {summary} {timestamp}"
          block
        >
          <textarea
            :value="git.autoCommitMessageTemplate"
            rows="1"
            placeholder="[{phaseId}] {agentName}: {summary}"
            class="w-full rounded px-2 py-1.5 text-[1em] font-mono resize-y min-h-[2.25rem]"
            :style="inputStyle"
            @input="onTemplateInput($event)"
          />
        </SettingsField>

        <SettingsField
          label="Commit scope"
          hint="Which files auto-commit picks up. 'Artifacts only' is coming in v2."
        >
          <div class="flex flex-col gap-1.5">
            <label
              v-for="opt in scopeOptions"
              :key="opt.value"
              class="flex items-center gap-2 text-[1em]"
              :class="opt.disabled ? 'cursor-not-allowed' : 'cursor-pointer'"
              :style="{ color: opt.disabled ? t.textFaint : t.text }"
              :title="opt.disabled ? 'Available in v2' : ''"
            >
              <input
                type="radio"
                name="git-scope"
                :value="opt.value"
                :checked="git.autoCommitScope === opt.value"
                :disabled="opt.disabled"
                @change="update({ autoCommitScope: opt.value })"
              />
              <span>{{ opt.label }}</span>
            </label>
          </div>
        </SettingsField>

        <SettingsField
          label="Auto-stash dirty tree before task"
          hint="Stash the user's uncommitted changes before the engine starts a task"
        >
          <AppToggle
            :model-value="git.autoStashDirtyBeforeTask"
            @update:model-value="update({ autoStashDirtyBeforeTask: $event })"
          />
        </SettingsField>

        <SettingsField
          label="Dirty task policy"
          hint="When a task starts with a dirty workspace: prompt a warning, or auto-stash silently"
        >
          <div class="flex flex-col gap-1.5">
            <label
              v-for="opt in policyOptions"
              :key="opt.value"
              class="flex items-center gap-2 text-[1em] cursor-pointer"
              :style="{ color: t.text }"
            >
              <input
                type="radio"
                name="git-dirty-policy"
                :value="opt.value"
                :checked="git.dirtyTaskPolicy === opt.value"
                @change="update({ dirtyTaskPolicy: opt.value })"
              />
              <span>{{ opt.label }}</span>
            </label>
          </div>
        </SettingsField>

        <SettingsField
          label="Auto-fetch interval (seconds)"
          hint="Set to 0 to disable. 60 or 300 are reasonable when enabled."
        >
          <input
            type="number"
            min="0"
            :value="autoFetchSeconds"
            class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
            :style="inputStyle"
            @input="onFetchIntervalInput($event)"
          />
        </SettingsField>

        <SettingsField
          label="Commit message rule (AI prompt)"
          hint="System prompt sent to Claude when you click 'Generate AI' in the commit panel. Edit to lock in your team's convention."
          block
        >
          <textarea
            :value="git.commitMessageRule"
            rows="30"
            class="w-full rounded px-2 py-1.5 text-[1em] font-mono resize-y min-h-[70vh]"
            :style="inputStyle"
            @input="onRuleInput($event)"
          />
          <div class="mt-1 flex justify-end">
            <button
              type="button"
              class="text-[1em] underline"
              :style="{ color: t.textDim }"
              @click="resetRule"
            >
              Reset to default
            </button>
          </div>
        </SettingsField>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Download, ScrollText } from 'lucide-vue-next'
import {
  DEFAULT_COMMIT_MESSAGE_RULE,
  type AutoCommitScope,
  type DirtyTaskPolicy,
} from '~/stores/settings'
import { useConfigImport, type ImportSelection } from '~/composables/useConfigImport'

const { t } = useTheme()
const { t: tr } = useI18n()
const settings = useSettingsStore()
const sidecar = useSidecar()
const { git, update } = useGitSettings()
const { composer, update: updateComposer } = useComposerSettings()
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

const scopeOptions: { value: AutoCommitScope; label: string; disabled: boolean }[] = [
  { value: 'workspace', label: 'Workspace (git add -A)', disabled: false },
  { value: 'artifacts-only', label: 'Artifacts only (available in v2)', disabled: true },
]

const policyOptions: { value: DirtyTaskPolicy; label: string }[] = [
  { value: 'warn', label: 'Warn (modal asks before running)' },
  { value: 'auto-stash', label: 'Auto-stash (stash silently, no prompt)' },
]

const autoFetchSeconds = computed(() => Math.round(git.value.autoFetchIntervalMs / 1000))

const onTemplateInput = (e: Event) => {
  const { value } = e.target as HTMLTextAreaElement
  update({ autoCommitMessageTemplate: value })
}

const onOpenLogs = async () => {
  try {
    await sidecar.openLogs()
  } catch {
    pushToast('Logs are only available in the installed app', 'info')
  }
}

const onFetchIntervalInput = (e: Event) => {
  const raw = (e.target as HTMLInputElement).value
  const parsed = Number.parseInt(raw, 10)
  const seconds = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  update({ autoFetchIntervalMs: seconds * 1000 })
}

const onPasteThresholdInput = (e: Event) => {
  const parsed = Number.parseInt((e.target as HTMLInputElement).value, 10)
  if (Number.isFinite(parsed) && parsed >= 200) updateComposer({ pasteThreshold: parsed })
}

const onRuleInput = (e: Event) => {
  update({ commitMessageRule: (e.target as HTMLTextAreaElement).value })
}

const resetRule = () => {
  update({ commitMessageRule: DEFAULT_COMMIT_MESSAGE_RULE })
}
</script>
