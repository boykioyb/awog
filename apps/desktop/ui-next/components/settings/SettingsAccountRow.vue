<template>
  <div class="acr" :class="{ active }">
    <div class="acrmain">
      <!-- Active-account radio -->
      <button
        class="acrradio"
        :class="{ on: active }"
        type="button"
        :title="active ? t('settingsModels.account.active') : t('settingsModels.account.setActive')"
        @click="emit('set-active')"
      >
        <Icon v-if="active" name="check" style="width: 10px; height: 10px" />
      </button>

      <div class="acrinfo">
        <div class="acrtop">
          <span class="acrlabel">{{ account.label }}</span>
          <span class="acrdot" :title="statusTitle" :style="{ background: statusColor }" />
        </div>
        <div class="acrsub mono">{{ detail }}</div>
      </div>

      <button
        class="acract"
        type="button"
        :title="t('settingsModels.account.edit')"
        @click="emit('edit')"
      >
        <Icon name="edit" style="width: 13px; height: 13px" />
      </button>
      <button
        class="acract"
        type="button"
        :disabled="testing"
        :title="t('settingsModels.account.test')"
        @click="emit('test')"
      >
        <span v-if="testing" class="acrspin" />
        <Icon v-else name="act" style="width: 13px; height: 13px" />
      </button>
      <button
        class="acract acrdanger"
        type="button"
        :title="t('settingsModels.account.disconnect')"
        @click="emit('disconnect')"
      >
        <Icon name="x" style="width: 13px; height: 13px" />
      </button>
    </div>

    <!-- Curated models (only present when the user overrode the catalog). -->
    <div v-if="account.models?.length" class="acrmodels">
      <span v-for="m in account.models" :key="m" class="chip acrmodel">{{ m }}</span>
    </div>

    <!-- Test result line -->
    <div v-if="testResult" class="acrtest" :class="{ err: !testResult.ok }">
      {{ formatTestResult(testResult) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ProviderAccount } from '~/stores/settings'

// One account row: active radio + label + mono detail line + status dot + Edit /
// Test / Disconnect. Shared by the Anthropic, custom-endpoint and OpenAI/Google
// lists. The parent owns the store actions; this row only emits intent.
export type AccountTestResult = {
  ok: boolean
  expiresAt?: number
  error?: { code: string; message: string }
}

const props = defineProps<{
  account: ProviderAccount
  active: boolean
  testing: boolean
  testResult: AccountTestResult | null
  // Optional override for the mono detail line (e.g. custom endpoint host). When
  // omitted, derive from the account (email/org · fingerprint · subscription).
  subtitle?: string
}>()

const emit = defineEmits<{
  'set-active': []
  edit: []
  test: []
  disconnect: []
}>()

const { t } = useI18n()

const statusColor = computed(() => {
  if (props.account.status === 'connected') return 'var(--green)'
  if (props.account.status === 'expired') return 'var(--amber)'
  return 'var(--textFaint)'
})
const statusTitle = computed(() => {
  if (props.account.status === 'connected') return t('settingsModels.statusDot.connected')
  if (props.account.status === 'expired') return t('settingsModels.statusDot.expired')
  return t('settingsModels.statusDot.disconnected')
})

// Default detail line: email/org for OAuth, or "API key · <fingerprint prefix>"
// for a stored key (the key itself never leaves the sidecar — only a fingerprint).
const detail = computed(() => {
  if (props.subtitle) return props.subtitle
  const a = props.account
  const parts: string[] = []
  if (a.account?.email) parts.push(a.account.email)
  if (a.organization?.name) parts.push(a.organization.name)
  if (parts.length) return parts.join(' · ')
  if (a.authMode === 'oauth') return t('settingsModels.account.subscription')
  if (a.fingerprint) {
    return t('settingsModels.account.apiKeyFingerprint', {
      fingerprint: a.fingerprint.slice(0, 12),
    })
  }
  return t('settingsModels.account.apiKey')
})

const formatExpiry = (expiresAt: number): string => {
  const deltaMs = expiresAt - Date.now()
  if (deltaMs <= 0) return t('settingsModels.test.expired')
  const minutes = Math.round(deltaMs / 60_000)
  if (minutes < 60) return t('settingsModels.test.inMinutes', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 48) return t('settingsModels.test.inHours', { n: hours })
  const days = Math.round(hours / 24)
  return t('settingsModels.test.inDays', { n: days })
}

const formatTestResult = (result: AccountTestResult): string => {
  if (result.ok) {
    return result.expiresAt
      ? t('settingsModels.test.okExpires', { when: formatExpiry(result.expiresAt) })
      : t('settingsModels.test.ok')
  }
  const err = result.error
  if (!err) return t('settingsModels.test.errorGeneric')
  return t('settingsModels.test.error', { code: err.code, message: err.message }).trim()
}
</script>

<style scoped>
.acr {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 9px;
  background: var(--bgInput);
  border: 1px solid var(--border);
}
.acr.active {
  border-color: var(--borderStrong);
}
.acrmain {
  display: flex;
  align-items: center;
  gap: 9px;
}
.acrradio {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--borderStrong);
  background: transparent;
  color: var(--accentText);
  cursor: pointer;
}
.acrradio.on {
  background: var(--accent);
  border-color: transparent;
}
.acrinfo {
  flex: 1;
  min-width: 0;
}
.acrtop {
  display: flex;
  align-items: center;
  gap: 7px;
}
.acrlabel {
  font-size: 1em;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.acrdot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.acrsub {
  font-size: 0.9231rem;
  color: var(--textDim);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.acract {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.acract:hover {
  border-color: var(--borderStrong);
  color: var(--text);
}
.acract:disabled {
  cursor: default;
  opacity: 0.6;
}
.acrdanger:hover {
  border-color: var(--danger);
  color: var(--danger);
}
.acrspin {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  animation: acrspin 0.7s linear infinite;
}
@keyframes acrspin {
  to {
    transform: rotate(360deg);
  }
}
.acrmodels {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding-left: 27px;
}
.acrmodel {
  font-size: 0.8462rem;
}
.acrtest {
  margin-left: 27px;
  padding: 5px 9px;
  border-radius: 7px;
  font-size: 1em;
  background: var(--bgEl);
  border: 1px solid var(--border);
  color: var(--text);
}
.acrtest.err {
  background: var(--dangerDim);
  border-color: var(--danger);
  color: var(--danger);
}
</style>
