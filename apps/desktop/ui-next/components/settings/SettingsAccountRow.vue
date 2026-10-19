<template>
  <div
    class="flex flex-col gap-2 rounded-md border bg-background px-3 py-2.5"
    :class="{ 'border-input': active }"
  >
    <div class="flex items-center gap-2">
      <!-- Active-account radio -->
      <Button
        type="button"
        variant="outline"
        size="iconSm"
        class="size-4.5 rounded-full border-input [&_svg]:size-2.5"
        :class="{
          'border-transparent bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground':
            active,
        }"
        :title="active ? t('settingsModels.account.active') : t('settingsModels.account.setActive')"
        :aria-label="
          active ? t('settingsModels.account.active') : t('settingsModels.account.setActive')
        "
        @click="emit('set-active')"
      >
        <Icon v-if="active" name="check" />
      </Button>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="truncate font-medium text-foreground">{{ account.label }}</span>
          <span class="size-2 shrink-0 rounded-full" :class="statusDotClass" :title="statusTitle" />
        </div>
        <!-- mono-ok: email / fingerprint / host endpoint -->
        <div class="mt-0.5 truncate font-mono text-sm text-dim">{{ detail }}</div>
      </div>

      <Button
        v-if="needsReauth"
        type="button"
        variant="outline"
        size="iconSm"
        class="border-selected-border text-primary hover:border-primary hover:bg-selected hover:text-primary"
        :title="t('settingsModels.account.reauth')"
        :aria-label="t('settingsModels.account.reauth')"
        @click="emit('reauth')"
      >
        <Icon name="refresh" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="iconSm"
        class="text-dim"
        :title="t('settingsModels.account.edit')"
        :aria-label="t('settingsModels.account.edit')"
        @click="emit('edit')"
      >
        <Icon name="edit" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="iconSm"
        class="text-dim"
        :disabled="testing"
        :title="t('settingsModels.account.test')"
        :aria-label="t('settingsModels.account.test')"
        @click="emit('test')"
      >
        <span
          v-if="testing"
          class="size-3.5 animate-spin rounded-full border-2 border-border border-t-primary"
        />
        <Icon v-else name="act" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="iconSm"
        class="text-dim hover:border-destructive hover:bg-transparent hover:text-destructive"
        :title="t('settingsModels.account.disconnect')"
        :aria-label="t('settingsModels.account.disconnect')"
        @click="emit('disconnect')"
      >
        <Icon name="x" />
      </Button>
    </div>

    <!-- Curated models (only present when the user overrode the catalog). -->
    <div v-if="account.models?.length" class="flex flex-wrap gap-1.5 pl-7">
      <Badge v-for="m in account.models" :key="m" variant="outline" class="text-muted-foreground">
        {{ m }}
      </Badge>
    </div>

    <!-- Test result line -->
    <div
      v-if="testResult"
      class="ml-7 rounded-sm border px-2 py-1 text-base"
      :class="
        testResult.ok
          ? 'bg-card text-foreground'
          : 'border-destructive bg-destructive/10 text-destructive'
      "
    >
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

const props = withDefaults(
  defineProps<{
    account: ProviderAccount
    active: boolean
    testing: boolean
    testResult: AccountTestResult | null
    // Optional override for the mono detail line (e.g. custom endpoint host). When
    // omitted, derive from the account (email/org · fingerprint · subscription).
    subtitle?: string
    // Capability flag: the parent card can re-run the OAuth flow for this account.
    // The button only shows when this is true AND the account actually needs it.
    reauthable?: boolean
  }>(),
  { subtitle: '', reauthable: false },
)

const emit = defineEmits<{
  'set-active': []
  edit: []
  test: []
  disconnect: []
  reauth: []
}>()

const { t } = useI18n()

// Re-auth is only meaningful for OAuth accounts whose credentials have lapsed —
// either the persisted status is 'expired', or a Test just failed with an auth
// error (the sidecar returns AUTH_EXPIRED when the refresh token is revoked, which
// does not flip the persisted status). API-key accounts recover via Edit instead.
const needsReauth = computed(() => {
  if (!props.reauthable || props.account.authMode !== 'oauth') return false
  if (props.account.status === 'expired') return true
  const code = props.testResult && !props.testResult.ok ? props.testResult.error?.code : undefined
  return code === 'AUTH_EXPIRED' || code === 'TOKEN_EXPIRED'
})

const statusDotClass = computed(() => {
  if (props.account.status === 'connected') return 'bg-success'
  if (props.account.status === 'expired') return 'bg-warning'
  return 'bg-faint'
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
