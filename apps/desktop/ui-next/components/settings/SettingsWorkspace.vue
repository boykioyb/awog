<template>
  <div>
    <div class="sech">{{ t('settings.workspace.heading') }}</div>

    <SettingsField
      :name="t('settings.workspace.path.name')"
      :desc="t('settings.workspace.path.desc')"
    >
      <div class="keyrow">
        <input v-model="workspacePath" class="keyinp mono" />
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
      <button class="btn sm" :disabled="openingLogs" @click="onOpenLogs">
        <Icon name="clip" />
        {{ t('settings.workspace.diagnostics.openLogs') }}
      </button>
    </SettingsField>
  </div>
</template>

<script setup lang="ts">
// Workspace panel — wires setSecHtml('workspace') to real state + IPC.
//   - Workspace path: two-way bound to the settings store.
//   - Git versioning: informational read-only status (auto-commit is always on).
//   - Diagnostics: opens the app log file via the sidecar (Electron only).
// Telemetry/templates rows from the prototype are omitted — no backing store field.
const { t } = useI18n()
const settings = useSettingsStore()
const sidecar = useSidecar()

// Proxy so the input reads workspacePath and writes through the store action.
const workspacePath = computed({
  get: () => settings.workspacePath,
  set: (v: string) => settings.setWorkspacePath(v),
})

const openingLogs = ref(false)

const onOpenLogs = async () => {
  if (openingLogs.value) return
  openingLogs.value = true
  try {
    await sidecar.openLogs()
  } catch {
    // Sidecar unavailable / failed — nothing harmful; the button is hidden when
    // !available, so this only guards transient IPC failures.
  } finally {
    openingLogs.value = false
  }
}
</script>
