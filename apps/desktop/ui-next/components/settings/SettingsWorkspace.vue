<template>
  <div>
    <SettingsPaneHeader :title="t('settings.workspace.heading')" />

    <SettingsField
      :name="t('settings.workspace.path.name')"
      :desc="t('settings.workspace.path.desc')"
    >
      <div class="keyrow">
        <input :value="workspaceRoot" class="keyinp mono" readonly />
        <button class="btn sm" :title="t('settings.workspace.path.copy')" @click="onCopy">
          <Icon :name="copied ? 'check' : 'copy'" />
        </button>
      </div>
    </SettingsField>

    <SettingsField
      :name="t('settings.workspace.git.name')"
      :desc="t('settings.workspace.git.desc')"
    >
      <span class="chip">
        <span
          style="
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--green);
            display: inline-block;
          "
        />
        {{ t('settings.workspace.git.enabled') }}
      </span>
    </SettingsField>

    <!-- TODO: config-import from .claude / .agents — needs an fs.scan flow (out of scope). -->

    <SettingsField
      v-if="sidecar.available"
      :name="t('settings.workspace.diagnostics.name')"
      :desc="t('settings.workspace.diagnostics.desc')"
    >
      <button class="btn sm" @click="showLogs = !showLogs">
        <Icon name="clip" />
        {{
          showLogs
            ? t('settings.workspace.diagnostics.hideLogs')
            : t('settings.workspace.diagnostics.viewLogs')
        }}
      </button>
    </SettingsField>

    <SettingsLogTail v-if="sidecar.available && showLogs" @close="showLogs = false" />
  </div>
</template>

<script setup lang="ts">
// Workspace panel — wires setSecHtml('workspace') to real state + IPC.
//   - Workspace path: READ-ONLY. The sidecar always uses os.homedir()/.awog as
//     its home root (see sidecar util/path.ts `awogHome()`); there is no safe
//     runtime remap, so an editable field would only mislead. We surface the
//     actual root the sidecar uses and offer copy instead. NOTE for follow-up:
//     to display this with zero hardcoded default, the sidecar would need to
//     expose awogHome over RPC (e.g. an `app.paths`/extended getAppInfo) — not
//     done here to keep this change inside the UI domain.
//   - Git versioning: informational read-only status (auto-commit is always on).
//   - Diagnostics: toggles an inline log tail (SettingsLogTail) that streams the
//     app log file into a terminal-style view (Electron only).
// Telemetry/templates rows from the prototype are omitted — no backing store field.
const { t } = useI18n()
const settings = useSettingsStore()
const sidecar = useSidecar()

// The workspace root the sidecar actually uses. Read-only display; the store
// value matches the sidecar's awogHome (~/.awog) and persists across reloads.
const workspaceRoot = computed(() => settings.workspacePath)

const copied = ref(false)
let copyResetTimer: ReturnType<typeof setTimeout> | null = null
const onCopy = () => {
  void navigator.clipboard?.writeText(workspaceRoot.value).catch(() => {})
  copied.value = true
  if (copyResetTimer) clearTimeout(copyResetTimer)
  copyResetTimer = setTimeout(() => {
    copied.value = false
  }, 1200)
}

const showLogs = ref(false)
</script>
