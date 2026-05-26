<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Workspace</h2>
      <div class="text-xs" :style="{ color: t.textDim }">
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
          class="w-full rounded px-2 py-1.5 text-[12px] font-mono"
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
    </div>
  </div>
</template>

<script setup lang="ts">
const { t } = useTheme()
const settings = useSettingsStore()

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))
</script>
