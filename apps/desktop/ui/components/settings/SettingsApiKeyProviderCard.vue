<template>
  <div class="rounded-xl p-3.5" :style="{ background: cardBg, border: `1px solid ${t.border}` }">
    <div class="flex items-center gap-3 mb-2">
      <div
        class="w-8 h-8 rounded-lg flex items-center justify-center"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <Sparkles :size="14" :style="{ color: t.textMuted }" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[1em] font-medium" :style="{ color: t.text }">{{ label }}</div>
        <div class="text-[1em]" :style="{ color: t.textDim }">{{ modelsHint }}</div>
      </div>
      <div
        class="flex items-center gap-1.5 text-[1em]"
        :style="{ color: connected ? t.text : t.textDim }"
      >
        <div
          class="w-1.5 h-1.5 rounded-full"
          :style="{ background: connected ? t.statusOk : t.textFaint }"
        />
        {{ headerStatus }}
      </div>
    </div>

    <!-- Account list -->
    <div v-if="accounts.length" class="space-y-1.5 mb-2">
      <div
        v-for="acc in accounts"
        :key="acc.id"
        class="rounded-lg p-2.5 space-y-1.5"
        :style="{
          background: t.bgInput,
          border: `1px solid ${activeId === acc.id ? t.borderStrong : t.border}`,
        }"
      >
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="flex items-center justify-center w-4 h-4 rounded-full transition shrink-0"
            :style="{
              border: `1px solid ${t.borderStrong}`,
              background: activeId === acc.id ? t.accent : 'transparent',
            }"
            :title="activeId === acc.id ? 'Active' : 'Set active'"
            @click="onSetActive(acc.id)"
          >
            <Check v-if="activeId === acc.id" :size="10" :style="{ color: t.accentText }" />
          </button>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <div class="text-[1em] truncate" :style="{ color: t.text }">{{ acc.label }}</div>
              <span
                class="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                :style="{ background: statusColor(acc.status) }"
                :title="acc.status"
              />
            </div>
            <div class="text-[1em] truncate font-mono" :style="{ color: t.textDim }">
              {{ accountSubtitle(acc) }}
            </div>
          </div>
          <button
            type="button"
            class="px-2 py-1 text-[1em] rounded-md transition flex items-center"
            :style="iconBtnStyle"
            title="Edit"
            @click="onEdit(acc)"
          >
            <Pencil :size="12" />
          </button>
          <button
            type="button"
            class="px-2 py-1 text-[1em] rounded-md transition flex items-center"
            :style="iconBtnStyle"
            :disabled="isTesting(acc.id)"
            title="Test connection"
            @click="onTest(acc.id)"
          >
            <Loader2 v-if="isTesting(acc.id)" :size="12" class="animate-spin" />
            <Activity v-else :size="12" />
          </button>
          <button
            type="button"
            class="px-2 py-1 text-[1em] rounded-md transition flex items-center"
            :style="iconBtnStyle"
            title="Disconnect"
            @click="onDisconnect(acc.id)"
          >
            <LogOut :size="12" />
          </button>
        </div>
        <!-- Models available to this account (e.g. a ChatGPT subscription's
             Codex models). API-key accounts use the full catalog, so they carry
             no per-account list and this stays hidden. -->
        <div v-if="acc.models?.length" class="flex flex-wrap gap-1">
          <span
            v-for="m in acc.models"
            :key="m"
            class="px-1.5 py-0.5 rounded-md font-mono text-[12px] leading-none"
            :style="{ background: t.bg, color: t.textDim, border: `1px solid ${t.border}` }"
          >
            {{ m }}
          </span>
        </div>
        <div
          v-if="testResults[acc.id]"
          class="text-[1em] px-2 py-1 rounded-lg"
          :style="testResultStyle(testResults[acc.id]!)"
        >
          {{ formatTestResult(testResults[acc.id]!) }}
        </div>
      </div>
    </div>

    <!-- ChatGPT subscription (OpenAI Codex OAuth, ADR 0029) -->
    <button
      v-if="codex"
      type="button"
      class="w-full mb-2 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[1em] font-medium transition"
      :style="{ background: t.accent, color: t.accentText, border: 'none' }"
      @click="codexDialogOpen = true"
    >
      <LogIn :size="14" />
      Sign in with ChatGPT
    </button>
    <div v-if="codex && !accounts.length" class="text-[1em] mb-2" :style="{ color: t.textDim }">
      Uses your ChatGPT Plus or Pro subscription. No API key required.
    </div>

    <!-- Add-key form -->
    <div v-if="formOpen" class="space-y-2">
      <input
        v-model="keyLabel"
        class="w-full rounded-lg px-2.5 py-2 text-[1em]"
        :style="inputStyle"
        placeholder="Label (optional)"
      />
      <div class="flex items-center gap-2">
        <input
          v-model="keyValue"
          :type="reveal ? 'text' : 'password'"
          class="flex-1 rounded-lg px-2.5 py-2 text-[1em] font-mono"
          :style="inputStyle"
          :placeholder="keyPlaceholder"
          @keydown.enter="onAdd"
        />
        <button
          type="button"
          class="px-2 py-2 rounded-lg text-[1em] flex items-center"
          :style="iconBtnStyle"
          :title="reveal ? 'Hide' : 'Show'"
          @click="reveal = !reveal"
        >
          <component :is="reveal ? EyeOff : Eye" :size="13" />
        </button>
        <button
          type="button"
          class="px-3 py-2 rounded-lg text-[1em] inline-flex items-center gap-1.5 transition"
          :style="{ background: t.accent, color: t.accentText, border: 'none' }"
          :disabled="!keyValue.trim() || busy"
          @click="onAdd"
        >
          <Loader2 v-if="busy" :size="12" class="animate-spin" />
          Add key
        </button>
      </div>
      <div
        v-if="error"
        class="text-[1em] px-2 py-1 rounded-lg"
        :style="{ background: t.dangerBg, color: t.danger, border: `1px solid ${t.dangerBorder}` }"
      >
        {{ error }}
      </div>
    </div>
    <button
      v-else
      type="button"
      class="w-full rounded-lg px-2 py-2 text-[1em] flex items-center justify-center gap-1.5 transition"
      :style="{ color: t.textDim, border: `1px dashed ${t.border}`, background: 'transparent' }"
      @click="formOpen = true"
    >
      <Plus :size="12" />
      {{ addKeyLabel }}
    </button>

    <SettingsCodexSignInDialog
      v-if="codex"
      :open="codexDialogOpen"
      @close="codexDialogOpen = false"
      @connected="codexDialogOpen = false"
    />

    <SettingsAccountEditDialog
      :open="!!editAccount"
      :provider="provider"
      :account="editAccount"
      @close="editAccount = null"
      @saved="onEditSaved"
    />
  </div>
</template>

<script setup lang="ts">
import {
  Activity,
  Check,
  Eye,
  EyeOff,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Sparkles,
} from 'lucide-vue-next'
import type { AccountStatus, ProviderAccount, ProviderName } from '~/types'

type AccountTestResult = {
  ok: boolean
  expiresAt?: number
  error?: { code: string; message: string }
}

const props = defineProps<{
  provider: 'openai' | 'google'
  label: string
  modelsHint: string
  keyPlaceholder: string
  // Show the ChatGPT subscription (OpenAI Codex OAuth) sign-in button (ADR 0029).
  // Only OpenAI supports it today.
  codex?: boolean
}>()

const { t } = useTheme()
const { cardBg } = useSettingsSurface()
const settings = useSettingsStore()

const formOpen = ref(false)
const codexDialogOpen = ref(false)
const keyLabel = ref('')
const keyValue = ref('')
const reveal = ref(false)
const busy = ref(false)
const error = ref('')
const testingIds = ref<Set<string>>(new Set())
const testResults = ref<Record<string, AccountTestResult>>({})

const accounts = computed<ProviderAccount[]>(() => settings.providers[props.provider].accounts)
const activeId = computed(() => settings.providers[props.provider].activeAccountId)
const connected = computed(() => settings.isProviderConnected(props.provider))

const headerStatus = computed(() => {
  const count = accounts.value.length
  if (count === 0) return 'Not connected'
  const suffix = `${count} account${count > 1 ? 's' : ''}`
  return connected.value ? `Connected · ${suffix}` : suffix
})

// When the codex sign-in button is present, the API-key form is the secondary
// (pay-as-you-go) option, so phrase its CTA accordingly.
const addKeyLabel = computed(() => {
  if (accounts.value.length) return 'Add another account'
  return props.codex ? 'Use an API key instead' : 'Add API key'
})

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none' as const,
}))

const iconBtnStyle = computed(() => ({
  color: t.value.text,
  border: `1px solid ${t.value.borderStrong}`,
  background: 'transparent',
}))

const statusColor = (status: AccountStatus): string => {
  if (status === 'connected') return t.value.statusOk
  if (status === 'expired') return t.value.statusWarn
  return t.value.textFaint
}

// A short, human label under the account name: subscription vs API key. (The
// key itself never leaves the sidecar; accounts are told apart by their label.)
const accountSubtitle = (acc: ProviderAccount): string =>
  acc.authMode === 'oauth' ? 'Subscription' : 'API key'

const isTesting = (accountId: string) => testingIds.value.has(accountId)

// Edit dialog: built-in key accounts get label + rotate key + curate models;
// codex (oauth) subscriptions get label + curate models (the dialog decides by
// account kind).
const editAccount = ref<ProviderAccount | null>(null)
const onEdit = (account: ProviderAccount) => {
  editAccount.value = account
}
const onEditSaved = (account: ProviderAccount) => {
  delete testResults.value[account.id]
}

const onAdd = async () => {
  if (!keyValue.value.trim() || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await settings.addApiKeyAccount({
      provider: props.provider as ProviderName,
      apiKey: keyValue.value.trim(),
      label: keyLabel.value.trim() || undefined,
    })
    keyValue.value = ''
    keyLabel.value = ''
    formOpen.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to add API key'
  } finally {
    busy.value = false
  }
}

const onSetActive = async (accountId: string) => {
  try {
    await settings.setActiveAccount(props.provider, accountId)
  } catch (err) {
    console.warn('[settings] setActiveAccount failed', err)
  }
}

const onDisconnect = async (accountId: string) => {
  try {
    await settings.disconnectAccount(props.provider, accountId)
    delete testResults.value[accountId]
  } catch (err) {
    console.warn('[settings] disconnectAccount failed', err)
  }
}

const onTest = async (accountId: string) => {
  if (testingIds.value.has(accountId)) return
  testingIds.value.add(accountId)
  try {
    testResults.value[accountId] = await settings.testAccount(props.provider, accountId)
  } catch (err) {
    testResults.value[accountId] = {
      ok: false,
      error: {
        code: 'REQUEST_FAILED',
        message: err instanceof Error ? err.message : 'Request failed',
      },
    }
  } finally {
    testingIds.value.delete(accountId)
  }
}

const formatTestResult = (result: AccountTestResult): string => {
  if (result.ok) return 'OK'
  const err = result.error
  if (!err) return 'Error'
  return `Error: ${err.code} ${err.message}`.trim()
}

const testResultStyle = (result: AccountTestResult) =>
  result.ok
    ? { background: t.value.bgInput, color: t.value.text, border: `1px solid ${t.value.border}` }
    : {
        background: t.value.dangerBg,
        color: t.value.danger,
        border: `1px solid ${t.value.dangerBorder}`,
      }
</script>
