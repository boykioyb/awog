<template>
  <div>
    <SettingsPaneHeader :title="t('settings.sessions.heading')" />

    <SettingsField
      :name="t('settingsSessions.autoApprove.name')"
      :desc="t('settingsSessions.autoApprove.desc')"
    >
      <SettingsTog v-model="autoApprove" />
    </SettingsField>

    <SettingsField
      :name="t('settingsSessions.autoContinueBg.name')"
      :desc="t('settingsSessions.autoContinueBg.desc')"
    >
      <SettingsTog v-model="autoContinueOnBackground" />
    </SettingsField>

    <SettingsField
      :name="t('settings.sessions.autoCompact.name')"
      :desc="t('settings.sessions.autoCompact.desc')"
    >
      <SettingsTog v-model="autoCompact" />
    </SettingsField>

    <SettingsField
      :name="t('settings.sessions.bubble.name')"
      :desc="t('settings.sessions.bubble.desc')"
    >
      <SettingsTog v-model="assistantBubble" />
    </SettingsField>

    <SettingsField
      :name="t('settings.sessions.typewriter.name')"
      :desc="t('settings.sessions.typewriter.desc')"
    >
      <SettingsTog v-model="typewriter" />
    </SettingsField>

    <SettingsField
      :name="t('settings.sessions.refeedImages.name')"
      :desc="t('settings.sessions.refeedImages.desc')"
    >
      <SettingsTog v-model="refeedImages" />
    </SettingsField>

    <SettingsField
      :name="t('settings.sessions.reducedMotion.name')"
      :desc="t('settings.sessions.reducedMotion.desc')"
    >
      <SettingsTog v-model="reducedMotion" />
    </SettingsField>

    <SettingsField
      :name="t('settingsSessions.pasteAsFile.name')"
      :desc="t('settingsSessions.pasteAsFile.desc')"
    >
      <SettingsTog v-model="pasteAsFile" />
    </SettingsField>

    <SettingsField
      v-if="pasteAsFile"
      :name="t('settingsSessions.pasteThreshold.name')"
      :desc="t('settingsSessions.pasteThreshold.desc')"
    >
      <SettingsNumber
        v-model="pasteThreshold"
        :min="PASTE_THRESHOLD_MIN"
        :max="PASTE_THRESHOLD_MAX"
        :step="100"
      />
    </SettingsField>

    <div class="sech">{{ t('settingsSessions.context.heading') }}</div>

    <SettingsField
      :name="t('settingsSessions.context.agentsCatalog.name')"
      :desc="t('settingsSessions.context.agentsCatalog.desc')"
    >
      <SettingsTog v-model="agentsCatalog" />
    </SettingsField>

    <SettingsField
      :name="t('settingsSessions.context.skillsCatalog.name')"
      :desc="t('settingsSessions.context.skillsCatalog.desc')"
    >
      <SettingsTog v-model="skillsCatalog" />
    </SettingsField>

    <div class="sech">{{ t('settingsSessions.quota.heading') }}</div>

    <SettingsField
      :name="t('settingsSessions.quota.warning.name')"
      :desc="t('settingsSessions.quota.warning.desc')"
    >
      <SettingsTog v-model="quotaEnabled" />
    </SettingsField>

    <SettingsField
      v-if="quotaEnabled"
      :name="t('settingsSessions.quota.threshold.name')"
      :desc="t('settingsSessions.quota.threshold.desc')"
    >
      <SettingsNumber
        v-model="quotaThreshold"
        :min="QUOTA_THRESHOLD_MIN"
        :max="QUOTA_THRESHOLD_MAX"
        :step="5"
      />
    </SettingsField>

    <SettingsField v-if="quotaEnabled" :name="t('settingsSessions.quota.abort.name')">
      <template #desc>
        <span :style="{ color: 'var(--danger)' }">
          {{ t('settingsSessions.quota.abort.desc') }}
        </span>
      </template>
      <SettingsTog v-model="abortSessionsOnThreshold" />
    </SettingsField>

    <SettingsField
      v-if="quotaEnabled"
      :name="t('settingsSessions.quota.blockNew.name')"
      :desc="t('settingsSessions.quota.blockNew.desc')"
    >
      <SettingsTog v-model="blockNewSessionsOnThreshold" />
    </SettingsField>
  </div>
</template>

<script setup lang="ts">
// Sessions panel — wires setSecHtml('sessions') to the settings store.
// v-model proxies write through store actions (never mutate store state directly):
// boolean toggles via updateSessions/updateQuota; numeric inputs go through
// SettingsNumber, which clamps to [min, max] on commit.
import { computed } from 'vue'
import {
  PASTE_THRESHOLD_MAX,
  PASTE_THRESHOLD_MIN,
  QUOTA_THRESHOLD_MAX,
  QUOTA_THRESHOLD_MIN,
  useSettingsStore,
} from '~/stores/settings'

const { t } = useI18n()
const settings = useSettingsStore()

// Small helper: a boolean proxy backed by a store action patch.
const sessionToggle = (
  key:
    | 'autoApprove'
    | 'autoCompact'
    | 'assistantBubble'
    | 'typewriter'
    | 'reducedMotion'
    | 'refeedImages'
    | 'pasteAsFile'
    | 'autoContinueOnBackground',
) =>
  computed<boolean>({
    get: () => settings.sessions[key],
    set: (v) => settings.updateSessions({ [key]: v }),
  })

const autoApprove = sessionToggle('autoApprove')
const autoCompact = sessionToggle('autoCompact')
const assistantBubble = sessionToggle('assistantBubble')
const typewriter = sessionToggle('typewriter')
const reducedMotion = sessionToggle('reducedMotion')
const refeedImages = sessionToggle('refeedImages')
const pasteAsFile = sessionToggle('pasteAsFile')
const autoContinueOnBackground = sessionToggle('autoContinueOnBackground')

// SettingsNumber clamps to [min, max] on commit; the setter just persists.
const pasteThreshold = computed<number>({
  get: () => settings.sessions.pasteThreshold,
  set: (v) => settings.updateSessions({ pasteThreshold: v }),
})

// Context-injection switches live in settings.context (they travel to the engine as
// contextConfig on every turn), not in settings.sessions — hence their own proxies.
const contextToggle = (key: 'agentsCatalogEnabled' | 'skillsCatalogEnabled') =>
  computed<boolean>({
    get: () => settings.context[key],
    set: (v) => settings.updateContext({ [key]: v }),
  })

const agentsCatalog = contextToggle('agentsCatalogEnabled')
const skillsCatalog = contextToggle('skillsCatalogEnabled')

const quotaEnabled = computed<boolean>({
  get: () => settings.quota.enabled,
  set: (v) => settings.updateQuota({ enabled: v }),
})

const quotaThreshold = computed<number>({
  get: () => settings.quota.threshold,
  set: (v) => settings.updateQuota({ threshold: v }),
})

const abortSessionsOnThreshold = computed<boolean>({
  get: () => settings.quota.abortSessionsOnThreshold,
  set: (v) => settings.updateQuota({ abortSessionsOnThreshold: v }),
})

const blockNewSessionsOnThreshold = computed<boolean>({
  get: () => settings.quota.blockNewSessionsOnThreshold,
  set: (v) => settings.updateQuota({ blockNewSessionsOnThreshold: v }),
})
</script>
