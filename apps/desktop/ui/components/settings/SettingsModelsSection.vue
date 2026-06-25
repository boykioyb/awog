<template>
  <div class="space-y-7">
    <div>
      <h2 class="text-lg font-semibold tracking-tight" :style="{ color: t.text }">
        Models & API Keys
      </h2>
      <div class="text-[1em] mt-1" :style="{ color: t.textDim }">
        Sign in to your model providers. Credentials stay on this device and never leave the
        sidecar.
      </div>
    </div>

    <div class="space-y-2.5">
      <!-- Anthropic card (OAuth) -->
      <div
        class="rounded-xl p-3.5"
        :style="{ background: cardBg, border: `1px solid ${t.border}` }"
      >
        <div class="flex items-center gap-3 mb-2">
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center"
            :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
          >
            <Sparkles :size="14" :style="{ color: t.textMuted }" />
          </div>
          <div class="flex-1">
            <div class="text-[1em] font-medium" :style="{ color: t.text }">Anthropic</div>
            <div class="text-[1em]" :style="{ color: t.textDim }">Claude Opus · Claude Sonnet</div>
          </div>
          <div
            class="flex items-center gap-1.5 text-[1em]"
            :style="{ color: settings.isProviderConnected('anthropic') ? t.text : t.textDim }"
          >
            <div
              class="w-1.5 h-1.5 rounded-full"
              :style="{
                background: settings.isProviderConnected('anthropic') ? t.statusOk : t.textFaint,
              }"
            />
            {{ anthropicHeaderStatus }}
          </div>
        </div>

        <!-- Empty state: prominent CTA -->
        <div v-if="anthropicAccounts.length === 0" class="space-y-2">
          <button
            type="button"
            class="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[1em] font-medium transition"
            :style="{ background: t.accent, color: t.accentText, border: 'none' }"
            @click="onOpenOAuthDialog"
          >
            <LogIn :size="14" />
            Sign in with Claude
          </button>
          <div class="text-[1em] text-center" :style="{ color: t.textDim }">
            Uses your Claude Pro or Max subscription. No API key required.
          </div>
        </div>

        <!-- Account list -->
        <div v-else class="space-y-1.5">
          <div
            v-for="acc in anthropicAccounts"
            :key="acc.id"
            class="rounded-lg p-2.5 space-y-1.5"
            :style="{
              background: t.bgInput,
              border: `1px solid ${anthropicActiveId === acc.id ? t.borderStrong : t.border}`,
            }"
          >
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="flex items-center justify-center w-4 h-4 rounded-full transition shrink-0"
                :style="{
                  border: `1px solid ${t.borderStrong}`,
                  background: anthropicActiveId === acc.id ? t.accent : 'transparent',
                }"
                :title="anthropicActiveId === acc.id ? 'Active' : 'Set active'"
                @click="onSetActive('anthropic', acc.id)"
              >
                <Check
                  v-if="anthropicActiveId === acc.id"
                  :size="10"
                  :style="{ color: t.accentText }"
                />
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
                <div class="text-[1em] truncate" :style="{ color: t.textDim }">
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
                @click="onTest('anthropic', acc.id)"
              >
                <Loader2 v-if="isTesting(acc.id)" :size="12" class="animate-spin" />
                <Activity v-else :size="12" />
              </button>
              <button
                type="button"
                class="px-2 py-1 text-[1em] rounded-md transition flex items-center"
                :style="iconBtnStyle"
                title="Disconnect"
                @click="onDisconnect('anthropic', acc.id)"
              >
                <LogOut :size="12" />
              </button>
            </div>
            <!-- Curated models (only present when the user overrode the catalog). -->
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

          <button
            type="button"
            class="w-full rounded-lg px-2 py-2 text-[1em] flex items-center justify-center gap-1.5 transition"
            :style="{
              color: t.textDim,
              border: `1px dashed ${t.border}`,
              background: 'transparent',
            }"
            @click="onOpenOAuthDialog"
          >
            <Plus :size="12" />
            Add another account
          </button>
        </div>

        <!-- Advanced — API key (ADR 0026 Phase A) -->
        <div class="mt-3 pt-3" :style="{ borderTop: `1px solid ${t.border}` }">
          <button
            type="button"
            class="w-full flex items-center justify-between text-[1em] transition"
            :style="{ color: t.textDim }"
            @click="advancedOpen = !advancedOpen"
          >
            <span class="inline-flex items-center gap-1.5">
              <component :is="advancedOpen ? ChevronDown : ChevronRight" :size="12" />
              Advanced — use API key
            </span>
          </button>
          <div v-if="advancedOpen" class="mt-2 space-y-2">
            <div class="text-[1em] leading-relaxed" :style="{ color: t.textDim }">
              Use a pay-as-you-go Anthropic API key (
              <span class="font-mono">sk-ant-…</span>
              ) instead of a subscription sign-in. The key stays on this device.
            </div>
            <input
              v-model="apiKeyLabel"
              class="w-full rounded-lg px-2.5 py-2 text-[1em]"
              :style="inputStyle"
              placeholder="Label (optional)"
            />
            <div class="flex items-center gap-2">
              <input
                v-model="apiKeyValue"
                :type="apiKeyReveal ? 'text' : 'password'"
                class="flex-1 rounded-lg px-2.5 py-2 text-[1em] font-mono"
                :style="inputStyle"
                placeholder="sk-ant-…"
                @keydown.enter="onAddApiKey"
              />
              <button
                type="button"
                class="px-2 py-2 rounded-lg text-[1em] flex items-center"
                :style="iconBtnStyle"
                :title="apiKeyReveal ? 'Hide' : 'Show'"
                @click="apiKeyReveal = !apiKeyReveal"
              >
                <component :is="apiKeyReveal ? EyeOff : Eye" :size="13" />
              </button>
              <button
                type="button"
                class="px-3 py-2 rounded-lg text-[1em] inline-flex items-center gap-1.5 transition"
                :style="{ background: t.accent, color: t.accentText, border: 'none' }"
                :disabled="!apiKeyValue.trim() || apiKeyBusy"
                @click="onAddApiKey"
              >
                <Loader2 v-if="apiKeyBusy" :size="12" class="animate-spin" />
                Add key
              </button>
            </div>
            <div
              v-if="apiKeyError"
              class="text-[1em] px-2 py-1 rounded-lg"
              :style="{
                background: t.dangerBg,
                color: t.danger,
                border: `1px solid ${t.dangerBorder}`,
              }"
            >
              {{ apiKeyError }}
            </div>
          </div>
        </div>
      </div>

      <!-- OpenAI + Google: API key connect (ADR 0029 Phase C3) + OpenAI Codex
           subscription OAuth (ADR 0029) -->
      <SettingsApiKeyProviderCard
        v-for="prov in apiKeyProviders"
        :key="prov.id"
        :provider="prov.id"
        :label="prov.label"
        :models-hint="prov.modelsHint"
        :key-placeholder="prov.keyPlaceholder"
        :codex="prov.id === 'openai'"
      />

      <!-- Custom endpoints — Anthropic- or OpenAI-compatible (ADR 0029 C3) -->
      <div
        class="rounded-xl p-3.5"
        :style="{ background: cardBg, border: `1px solid ${t.border}` }"
      >
        <div class="flex items-center gap-3 mb-2">
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center"
            :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
          >
            <Server :size="14" :style="{ color: t.textMuted }" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[1em] font-medium" :style="{ color: t.text }">Custom endpoints</div>
            <div class="text-[1em]" :style="{ color: t.textDim }">
              Anthropic- or OpenAI-compatible base URL + API key (Ollama, vLLM, LM Studio,
              OpenRouter, LiteLLM)
            </div>
          </div>
        </div>

        <div v-if="customAccounts.length" class="space-y-1.5 mb-2">
          <div
            v-for="acc in customAccounts"
            :key="acc.id"
            class="rounded-lg p-2.5 space-y-1.5"
            :style="{
              background: t.bgInput,
              border: `1px solid ${anthropicActiveId === acc.id ? t.borderStrong : t.border}`,
            }"
          >
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="flex items-center justify-center w-4 h-4 rounded-full transition shrink-0"
                :style="{
                  border: `1px solid ${t.borderStrong}`,
                  background: anthropicActiveId === acc.id ? t.accent : 'transparent',
                }"
                :title="anthropicActiveId === acc.id ? 'Active' : 'Set active'"
                @click="onSetActive('anthropic', acc.id)"
              >
                <Check
                  v-if="anthropicActiveId === acc.id"
                  :size="10"
                  :style="{ color: t.accentText }"
                />
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
                  {{ customSubtitle(acc) }}
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
                @click="onTest('anthropic', acc.id)"
              >
                <Loader2 v-if="isTesting(acc.id)" :size="12" class="animate-spin" />
                <Activity v-else :size="12" />
              </button>
              <button
                type="button"
                class="px-2 py-1 text-[1em] rounded-md transition flex items-center"
                :style="iconBtnStyle"
                title="Remove"
                @click="onDisconnect('anthropic', acc.id)"
              >
                <LogOut :size="12" />
              </button>
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

        <div v-if="customFormOpen" class="mt-1">
          <CustomProviderForm
            v-model="customDraft"
            submit-label="Add endpoint"
            @submit="onAddCustom"
            @cancel="customFormOpen = false"
          />
          <div
            v-if="customError"
            class="mt-2 text-[1em] px-2 py-1 rounded-lg"
            :style="{
              background: t.dangerBg,
              color: t.danger,
              border: `1px solid ${t.dangerBorder}`,
            }"
          >
            {{ customError }}
          </div>
        </div>
        <button
          v-else
          type="button"
          class="w-full rounded-lg px-2 py-2 text-[1em] flex items-center justify-center gap-1.5 transition"
          :style="{ color: t.textDim, border: `1px dashed ${t.border}`, background: 'transparent' }"
          @click="customFormOpen = true"
        >
          <Plus :size="12" />
          Add custom endpoint
        </button>
      </div>
    </div>

    <SettingsOAuthCodeDialog
      :open="dialogOpen"
      @close="dialogOpen = false"
      @connected="onConnected"
    />

    <SettingsAccountEditDialog
      :open="!!editAccount"
      provider="anthropic"
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
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Server,
  Sparkles,
} from 'lucide-vue-next'
import type { AccountStatus, ProviderAccount, ProviderName } from '~/types'
import type { CustomProviderInput } from '~/stores/settings'

const EMPTY_CUSTOM: CustomProviderInput = {
  label: '',
  baseUrl: '',
  apiKey: '',
  // Default to Anthropic-compatible (Phase B behavior); OpenAI-compatible is the
  // opt-in for Ollama/vLLM/LM Studio/OpenRouter.
  api: 'anthropic-messages',
  models: [],
}

type AccountTestResult = {
  ok: boolean
  expiresAt?: number
  error?: { code: string; message: string }
}

const { t } = useTheme()
const { cardBg } = useSettingsSurface()
const settings = useSettingsStore()

const dialogOpen = ref(false)
const advancedOpen = ref(false)
const testingIds = ref<Set<string>>(new Set())
const testResults = ref<Record<string, AccountTestResult>>({})

// Anthropic API-key form (ADR 0026 Phase A).
const apiKeyLabel = ref('')
const apiKeyValue = ref('')
const apiKeyReveal = ref(false)
const apiKeyBusy = ref(false)
const apiKeyError = ref('')

// Custom Anthropic-compatible endpoint form (ADR 0026 Phase B).
const customFormOpen = ref(false)
const customDraft = ref<CustomProviderInput>({ ...EMPTY_CUSTOM })
const customBusy = ref(false)
const customError = ref('')

const apiKeyProviders: {
  id: 'openai' | 'google'
  label: string
  modelsHint: string
  keyPlaceholder: string
}[] = [
  { id: 'openai', label: 'OpenAI', modelsHint: 'GPT-5.1 · o3 · GPT-4.1', keyPlaceholder: 'sk-…' },
  {
    id: 'google',
    label: 'Google',
    modelsHint: 'Gemini 3 Pro · Gemini 2.5 Flash',
    keyPlaceholder: 'AIza…',
  },
]

// The Anthropic card shows OAuth + plain API-key accounts. Custom endpoints
// (apikey + baseURL) get their own section below.
const anthropicAccounts = computed(() =>
  settings.providers.anthropic.accounts.filter((a) => !a.baseURL),
)
const customAccounts = computed(() =>
  settings.providers.anthropic.accounts.filter((a) => !!a.baseURL),
)
const anthropicActiveId = computed(() => settings.providers.anthropic.activeAccountId)

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none' as const,
}))

const anthropicHeaderStatus = computed(() => {
  const count = anthropicAccounts.value.length
  if (count === 0) return 'Not connected'
  if (settings.isProviderConnected('anthropic')) {
    return `Connected · ${count} account${count > 1 ? 's' : ''}`
  }
  return `${count} account${count > 1 ? 's' : ''}`
})

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

const accountSubtitle = (acc: ProviderAccount): string => {
  const parts: string[] = []
  if (acc.account?.email) parts.push(acc.account.email)
  if (acc.organization?.name) parts.push(acc.organization.name)
  // No email/org (typical for an API-key account) → a plain human label. The key
  // itself never leaves the sidecar; accounts are told apart by their label.
  if (!parts.length) parts.push(acc.authMode === 'oauth' ? 'Subscription' : 'API key')
  return parts.join(' · ')
}

const isTesting = (accountId: string) => testingIds.value.has(accountId)

// Edit dialog (shared for Anthropic OAuth/key + custom endpoints).
const editAccount = ref<ProviderAccount | null>(null)
const onEdit = (account: ProviderAccount) => {
  editAccount.value = account
}
const onEditSaved = (account: ProviderAccount) => {
  // A rotated key / changed endpoint makes a prior Test result stale.
  delete testResults.value[account.id]
}

const onOpenOAuthDialog = () => {
  dialogOpen.value = true
}

const onConnected = (_account: ProviderAccount) => {
  dialogOpen.value = false
}

const onAddApiKey = async () => {
  if (!apiKeyValue.value.trim() || apiKeyBusy.value) return
  apiKeyBusy.value = true
  apiKeyError.value = ''
  try {
    await settings.addApiKeyAccount({
      apiKey: apiKeyValue.value.trim(),
      label: apiKeyLabel.value.trim() || undefined,
    })
    apiKeyValue.value = ''
    apiKeyLabel.value = ''
    advancedOpen.value = false
  } catch (err) {
    apiKeyError.value = err instanceof Error ? err.message : 'Failed to add API key'
  } finally {
    apiKeyBusy.value = false
  }
}

const onAddCustom = async () => {
  if (customBusy.value) return
  if (!customDraft.value.apiKey.trim()) {
    customError.value = 'API key is required for custom endpoints'
    return
  }
  customBusy.value = true
  customError.value = ''
  try {
    await settings.addApiKeyAccount({
      // Custom endpoints stay under the anthropic bucket regardless of wire
      // protocol (the bucket is a credential namespace, not the API shape; the
      // runtime routes via account.api). Keeps the existing custom-account UI.
      provider: 'anthropic',
      apiKey: customDraft.value.apiKey.trim(),
      label: customDraft.value.label.trim() || undefined,
      baseURL: customDraft.value.baseUrl.trim(),
      api: customDraft.value.api,
      models: customDraft.value.models,
    })
    customDraft.value = { ...EMPTY_CUSTOM }
    customFormOpen.value = false
  } catch (err) {
    customError.value = err instanceof Error ? err.message : 'Failed to add endpoint'
  } finally {
    customBusy.value = false
  }
}

const customSubtitle = (acc: ProviderAccount): string => {
  const parts: string[] = []
  if (acc.baseURL) parts.push(acc.baseURL)
  if (acc.models?.length) parts.push(acc.models.join(' · '))
  return parts.join('  ·  ')
}

const onSetActive = async (provider: ProviderName, accountId: string) => {
  try {
    await settings.setActiveAccount(provider, accountId)
  } catch (err) {
    console.warn('[settings] setActiveAccount failed', err)
  }
}

const onDisconnect = async (provider: ProviderName, accountId: string) => {
  try {
    await settings.disconnectAccount(provider, accountId)
    delete testResults.value[accountId]
  } catch (err) {
    console.warn('[settings] disconnectAccount failed', err)
  }
}

const onTest = async (provider: ProviderName, accountId: string) => {
  if (testingIds.value.has(accountId)) return
  testingIds.value.add(accountId)
  try {
    const result = await settings.testAccount(provider, accountId)
    testResults.value[accountId] = result
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

const formatExpiry = (expiresAt: number): string => {
  const deltaMs = expiresAt - Date.now()
  if (deltaMs <= 0) return 'expired'
  const minutes = Math.round(deltaMs / 60_000)
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `in ${hours}h`
  const days = Math.round(hours / 24)
  return `in ${days}d`
}

const formatTestResult = (result: AccountTestResult): string => {
  if (result.ok) {
    const exp = result.expiresAt ? ` — expires ${formatExpiry(result.expiresAt)}` : ''
    return `OK${exp}`
  }
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
