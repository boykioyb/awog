<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Models & API Keys</h2>
      <div class="text-xs" :style="{ color: t.textDim }">
        Sign in to your model providers. Credentials stay on this device and never leave the
        sidecar.
      </div>
    </div>

    <div class="space-y-2">
      <!-- Anthropic card (OAuth) -->
      <div
        class="rounded p-3"
        :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
      >
        <div class="flex items-center gap-3 mb-2">
          <div
            class="w-8 h-8 rounded flex items-center justify-center"
            :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
          >
            <Sparkles :size="14" :style="{ color: t.textMuted }" />
          </div>
          <div class="flex-1">
            <div class="text-[13px] font-medium" :style="{ color: t.text }">Anthropic</div>
            <div class="text-[10px]" :style="{ color: t.textDim }">Claude Opus · Claude Sonnet</div>
          </div>
          <div
            class="flex items-center gap-1.5 text-[11px]"
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
            class="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded text-[12px] font-medium transition"
            :style="{ background: t.accent, color: t.accentText, border: 'none' }"
            @click="onOpenOAuthDialog"
          >
            <LogIn :size="14" />
            Sign in with Claude
          </button>
          <div class="text-[11px] text-center" :style="{ color: t.textDim }">
            Uses your Claude Pro or Max subscription. No API key required.
          </div>
        </div>

        <!-- Account list -->
        <div v-else class="space-y-1.5">
          <div
            v-for="acc in anthropicAccounts"
            :key="acc.id"
            class="rounded p-2 space-y-1.5"
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
                  <div class="text-[12px] truncate" :style="{ color: t.text }">{{ acc.label }}</div>
                  <span
                    class="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                    :style="{ background: statusColor(acc.status) }"
                    :title="acc.status"
                  />
                </div>
                <div class="text-[10px] truncate" :style="{ color: t.textDim }">
                  {{ accountSubtitle(acc) }}
                </div>
              </div>
              <button
                type="button"
                class="px-2 py-1 text-[11px] rounded transition inline-flex items-center gap-1"
                :style="iconBtnStyle"
                :disabled="isTesting(acc.id)"
                title="Test connection"
                @click="onTest('anthropic', acc.id)"
              >
                <Loader2 v-if="isTesting(acc.id)" :size="12" class="animate-spin" />
                <Activity v-else :size="12" />
                Test
              </button>
              <button
                type="button"
                class="px-2 py-1 text-[11px] rounded transition flex items-center"
                :style="iconBtnStyle"
                title="Disconnect"
                @click="onDisconnect('anthropic', acc.id)"
              >
                <LogOut :size="12" />
              </button>
            </div>
            <div
              v-if="testResults[acc.id]"
              class="text-[11px] px-2 py-1 rounded"
              :style="testResultStyle(testResults[acc.id]!)"
            >
              {{ formatTestResult(testResults[acc.id]!) }}
            </div>
          </div>

          <button
            type="button"
            class="w-full rounded px-2 py-1.5 text-[11px] flex items-center justify-center gap-1.5 transition"
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

        <!-- Advanced (collapsed) -->
        <div class="mt-3 pt-3" :style="{ borderTop: `1px solid ${t.border}` }">
          <button
            type="button"
            class="w-full flex items-center justify-between text-[11px] transition"
            :style="{ color: t.textDim }"
            @click="advancedOpen = !advancedOpen"
          >
            <span class="inline-flex items-center gap-1.5">
              <component :is="advancedOpen ? ChevronDown : ChevronRight" :size="12" />
              Advanced — use API key
            </span>
            <span
              class="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider"
              :style="{
                background: t.bgInput,
                border: `1px solid ${t.border}`,
                color: t.textFaint,
              }"
            >
              Coming soon
            </span>
          </button>
          <div
            v-if="advancedOpen"
            class="mt-2 text-[11px] leading-relaxed"
            :style="{ color: t.textDim }"
          >
            API key auth will be added in a later release. For now, use Sign in with Claude above.
          </div>
        </div>
      </div>

      <!-- OpenAI + Google: coming soon -->
      <div
        v-for="prov in placeholderProviders"
        :key="prov.id"
        class="rounded p-3 relative"
        :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
      >
        <span
          class="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider"
          :style="{
            background: t.bgInput,
            border: `1px solid ${t.border}`,
            color: t.textFaint,
          }"
        >
          Coming soon
        </span>
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded flex items-center justify-center"
            :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
          >
            <Sparkles :size="14" :style="{ color: t.textMuted }" />
          </div>
          <div class="flex-1 min-w-0 pr-20">
            <div class="text-[13px] font-medium" :style="{ color: t.text }">{{ prov.label }}</div>
            <div class="text-[10px]" :style="{ color: t.textDim }">
              {{ prov.models.join(' · ') }}
            </div>
          </div>
        </div>
        <button
          type="button"
          class="mt-2 w-full rounded px-2 py-1.5 text-[11px] flex items-center justify-center gap-1.5"
          :style="{
            color: t.textDim,
            border: `1px dashed ${t.border}`,
            background: 'transparent',
            opacity: 0.5,
            cursor: 'not-allowed',
          }"
          disabled
        >
          <Plus :size="12" />
          Add account
        </button>
      </div>

      <!-- Custom providers (preserved, but disabled with coming-soon badge) -->
      <div
        v-for="cp in settings.customProviders"
        :key="cp.id"
        class="rounded p-3 relative"
        :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
      >
        <span
          class="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider"
          :style="{
            background: t.bgInput,
            border: `1px solid ${t.border}`,
            color: t.textFaint,
          }"
        >
          Coming soon
        </span>
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded flex items-center justify-center"
            :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
          >
            <Sparkles :size="14" :style="{ color: t.textMuted }" />
          </div>
          <div class="flex-1 min-w-0 pr-20">
            <div class="text-[13px] font-medium truncate" :style="{ color: t.text }">
              {{ cp.label || 'Untitled provider' }}
            </div>
            <div class="text-[10px] truncate" :style="{ color: t.textDim }">
              {{ cp.baseUrl || 'No base URL' }}
              {{ cp.models.length ? `· ${cp.models.join(' · ')}` : '' }}
            </div>
          </div>
          <button
            type="button"
            class="px-2 py-1 text-[11px] rounded transition flex items-center"
            :style="iconBtnStyle"
            title="Remove"
            @click="settings.removeCustomProvider(cp.id)"
          >
            <Trash2 :size="13" />
          </button>
        </div>
      </div>

      <button
        type="button"
        class="w-full rounded p-3 flex items-center gap-3 text-left"
        :style="{
          background: t.bgElevated,
          border: `1px dashed ${t.border}`,
          opacity: 0.5,
          cursor: 'not-allowed',
        }"
        disabled
      >
        <div
          class="w-8 h-8 rounded flex items-center justify-center"
          :style="{ background: t.bgInput }"
        >
          <Plus :size="14" :style="{ color: t.textDim }" />
        </div>
        <div class="flex-1">
          <div class="text-[13px]" :style="{ color: t.text }">Add a custom provider</div>
          <div class="text-[10px]" :style="{ color: t.textDim }">
            OpenRouter, Ollama, LM Studio — coming soon
          </div>
        </div>
      </button>
    </div>

    <SettingsOAuthCodeDialog
      :open="dialogOpen"
      @close="dialogOpen = false"
      @connected="onConnected"
    />
  </div>
</template>

<script setup lang="ts">
import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-vue-next'
import type { AccountStatus, ProviderAccount, ProviderName } from '~/types'

type AccountTestResult = {
  ok: boolean
  expiresAt?: number
  error?: { code: string; message: string }
}

const { t } = useTheme()
const settings = useSettingsStore()

const dialogOpen = ref(false)
const advancedOpen = ref(false)
const testingIds = ref<Set<string>>(new Set())
const testResults = ref<Record<string, AccountTestResult>>({})

const placeholderProviders: { id: 'openai' | 'google'; label: string; models: string[] }[] = [
  { id: 'openai', label: 'OpenAI', models: ['GPT-5', 'Codex'] },
  { id: 'google', label: 'Google', models: ['Gemini 2.5 Pro'] },
]

const anthropicAccounts = computed(() => settings.providers.anthropic.accounts)
const anthropicActiveId = computed(() => settings.providers.anthropic.activeAccountId)

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
  parts.push(`fp ${acc.fingerprint}`)
  return parts.join(' · ')
}

const isTesting = (accountId: string) => testingIds.value.has(accountId)

const onOpenOAuthDialog = () => {
  dialogOpen.value = true
}

const onConnected = (_account: ProviderAccount) => {
  dialogOpen.value = false
}

const onSetActive = async (provider: ProviderName, accountId: string) => {
  try {
    await settings.setActiveAccount(provider, accountId)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[settings] setActiveAccount failed', err)
  }
}

const onDisconnect = async (provider: ProviderName, accountId: string) => {
  try {
    await settings.disconnectAccount(provider, accountId)
    delete testResults.value[accountId]
  } catch (err) {
    // eslint-disable-next-line no-console
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
