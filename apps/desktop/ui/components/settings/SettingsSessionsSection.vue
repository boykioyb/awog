<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Sessions</h2>
      <div class="text-[1em]" :style="{ color: t.textDim }">
        How sessions and tasks behave while they run — approvals, notifications, usage limits, and
        the composer.
      </div>
    </div>
    <div class="space-y-4">
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

      <SettingsField :label="tr('settings.autoCompact')" :hint="tr('settings.autoCompact.hint')">
        <AppToggle v-model="settings.autoCompact" />
      </SettingsField>

      <SettingsField :label="tr('settings.quotaWarning')" :hint="tr('settings.quotaWarning.hint')">
        <AppToggle
          :model-value="quotaWarning.enabled"
          @update:model-value="updateQuota({ enabled: $event })"
        />
      </SettingsField>

      <SettingsField
        v-if="quotaWarning.enabled"
        :label="tr('settings.quotaThreshold')"
        :hint="tr('settings.quotaThreshold.hint')"
      >
        <input
          type="number"
          :min="thresholdMin"
          :max="thresholdMax"
          step="5"
          :value="quotaWarning.threshold"
          class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
          :style="inputStyle"
          @input="onQuotaThresholdInput($event)"
        />
      </SettingsField>

      <SettingsField
        v-if="quotaWarning.enabled"
        :label="tr('settings.quotaAbort')"
        :hint="tr('settings.quotaAbort.hint')"
      >
        <AppToggle
          :model-value="quotaWarning.abortSessionsOnThreshold"
          @update:model-value="updateQuota({ abortSessionsOnThreshold: $event })"
        />
      </SettingsField>

      <SettingsField
        v-if="quotaWarning.enabled"
        :label="tr('settings.quotaBlockNew')"
        :hint="tr('settings.quotaBlockNew.hint')"
      >
        <AppToggle
          :model-value="quotaWarning.blockNewSessionsOnThreshold"
          @update:model-value="updateQuota({ blockNewSessionsOnThreshold: $event })"
        />
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
    </div>
  </div>
</template>

<script setup lang="ts">
const { t } = useTheme()
const { t: tr } = useI18n()
const settings = useSettingsStore()
const { composer, update: updateComposer } = useComposerSettings()
const { quotaWarning, update: updateQuota, thresholdMin, thresholdMax } = useQuotaWarningSettings()

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const onQuotaThresholdInput = (e: Event) => {
  const parsed = Number.parseInt((e.target as HTMLInputElement).value, 10)
  if (!Number.isFinite(parsed)) return
  const clamped = Math.min(thresholdMax, Math.max(thresholdMin, parsed))
  updateQuota({ threshold: clamped })
}

const onPasteThresholdInput = (e: Event) => {
  const parsed = Number.parseInt((e.target as HTMLInputElement).value, 10)
  if (Number.isFinite(parsed) && parsed >= 200) updateComposer({ pasteThreshold: parsed })
}
</script>
