<template>
  <div class="smodels">
    <SettingsPaneHeader
      :title="t('settingsModels.heading')"
      :subtitle="t('settingsModels.intro')"
    />

    <SettingsSeg v-model="activeTab" :options="tabOptions" class="smtabs" />

    <!-- ── Accounts tab: credentials per provider + custom endpoints ───────── -->
    <div v-show="activeTab === 'accounts'" class="smgroup">
      <!-- ── Anthropic card (OAuth + advanced API key) ─────────────────────── -->
      <div class="pcard">
        <div class="pcardtop">
          <span class="rx">
            <Icon
              name="agents"
              style="width: var(--icon-md); height: var(--icon-md); color: var(--blue)"
            />
          </span>
          <div class="pcardinfo">
            <div class="rt">{{ t('settingsModels.anthropic.name') }}</div>
            <div class="rd">{{ t('settingsModels.anthropic.models') }}</div>
          </div>
          <span class="chip pcardstatus">
            <span
              class="pcarddot"
              :style="{ background: anthropicConnected ? 'var(--green)' : 'var(--textFaint)' }"
            />
            {{ anthropicHeaderStatus }}
          </span>
        </div>

        <!-- Empty state: prominent CTA -->
        <template v-if="anthropicAccounts.length === 0">
          <button class="btn pri pcardcta" type="button" @click="oauthOpen = true">
            <Icon name="agents" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('settingsModels.anthropic.signIn') }}
          </button>
          <div class="fd pcardhint">{{ t('settingsModels.anthropic.signInHint') }}</div>
        </template>

        <!-- Account list -->
        <template v-else>
          <div class="pcardlist">
            <SettingsAccountRow
              v-for="acc in anthropicAccounts"
              :key="acc.id"
              :account="acc"
              :active="anthropicActiveId === acc.id"
              :testing="testingIds.has(acc.id)"
              :test-result="testResults[acc.id] ?? null"
              reauthable
              @set-active="onSetActive(acc.id)"
              @edit="editAccount = acc"
              @test="onTest(acc.id)"
              @disconnect="onDisconnect(acc.id)"
              @reauth="onReauth(acc.id)"
            />
          </div>
          <button class="btn sm pcardadd" type="button" @click="oauthOpen = true">
            <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('settingsModels.account.addAnother') }}
          </button>
        </template>

        <!-- Advanced — API key -->
        <div class="smadvanced">
          <button class="smadvtoggle" type="button" @click="advancedOpen = !advancedOpen">
            <Icon
              name="chev"
              class="smchev"
              :class="{ open: advancedOpen }"
              style="width: var(--icon-xs); height: var(--icon-xs)"
            />
            {{ t('settingsModels.anthropic.advancedToggle') }}
          </button>
          <div v-if="advancedOpen" class="smadvbody">
            <div class="fd">{{ t('settingsModels.anthropic.advancedHint') }}</div>
            <input
              v-model="apiKeyLabel"
              class="keyinp"
              :placeholder="t('settingsModels.form.labelOptional')"
            />
            <div class="keyrow">
              <input
                v-model="apiKeyValue"
                class="keyinp mono"
                :type="apiKeyReveal ? 'text' : 'password'"
                placeholder="sk-ant-…"
                @keydown.enter="onAddApiKey"
              />
              <span
                class="keyeye"
                :title="
                  apiKeyReveal ? t('settingsModels.form.hide') : t('settingsModels.form.show')
                "
                @click="apiKeyReveal = !apiKeyReveal"
              >
                👁
              </span>
              <button
                class="btn sm pri"
                type="button"
                :disabled="!apiKeyValue.trim() || apiKeyBusy"
                @click="onAddApiKey"
              >
                {{ t('settingsModels.form.addKey') }}
              </button>
            </div>
            <div v-if="apiKeyError" class="pcarderror">{{ apiKeyError }}</div>
          </div>
        </div>
      </div>

      <!-- ── OpenAI + Google ───────────────────────────────────────────────── -->
      <SettingsProviderCard
        provider="openai"
        :name="t('settingsModels.openai.name')"
        :models="t('settingsModels.openai.models')"
        key-placeholder="sk-…"
        codex
      />
      <SettingsProviderCard
        provider="google"
        :name="t('settingsModels.google.name')"
        :models="t('settingsModels.google.models')"
        key-placeholder="AIza…"
      />

      <!-- ── Custom endpoints ──────────────────────────────────────────────── -->
      <div class="pcard">
        <div class="pcardtop">
          <span class="rx">
            <Icon name="conn" style="width: var(--icon-md); height: var(--icon-md)" />
          </span>
          <div class="pcardinfo">
            <div class="rt">{{ t('settingsModels.custom.name') }}</div>
            <div class="rd">{{ t('settingsModels.custom.models') }}</div>
          </div>
        </div>

        <div v-if="customAccounts.length" class="pcardlist">
          <SettingsAccountRow
            v-for="acc in customAccounts"
            :key="acc.id"
            :account="acc"
            :active="anthropicActiveId === acc.id"
            :testing="testingIds.has(acc.id)"
            :test-result="testResults[acc.id] ?? null"
            :subtitle="customSubtitle(acc)"
            @set-active="onSetActive(acc.id)"
            @edit="editAccount = acc"
            @test="onTest(acc.id)"
            @disconnect="onDisconnect(acc.id)"
          />
        </div>

        <div v-if="customFormOpen" class="smcustomform">
          <CustomProviderForm
            v-model="customDraft"
            :submit-label="t('settingsModels.custom.addEndpoint')"
            @submit="onAddCustom"
            @cancel="customFormOpen = false"
          />
          <div v-if="customError" class="pcarderror">{{ customError }}</div>
        </div>
        <button v-else class="btn sm pcardadd" type="button" @click="customFormOpen = true">
          <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('settingsModels.custom.add') }}
        </button>
      </div>
    </div>

    <!-- ── Models tab: per-provider catalog + fetch + toggle ────────────────── -->
    <SettingsProviderModels v-show="activeTab === 'models'" />

    <SettingsOAuthDialog
      :open="oauthOpen"
      :reauth-account-id="reauthAccountId"
      @close="onOauthClose"
      @connected="onOauthConnected"
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
// Models & Keys — the LLM-account surface (OAuth + API keys + custom endpoints).
// Anthropic gets a bespoke card (subscription OAuth + advanced API key + custom
// endpoints in the anthropic bucket, identified by baseURL); OpenAI/Google reuse
// SettingsProviderCard. Wired to the settings store / sidecar. Ported from legacy
// SettingsModelsSection.vue into ui-next prototype style.
import CustomProviderForm, {
  type CustomProviderInput,
} from '~/components/settings/CustomProviderForm.vue'
import SettingsAccountRow, {
  type AccountTestResult,
} from '~/components/settings/SettingsAccountRow.vue'
import SettingsAccountEditDialog from '~/components/settings/SettingsAccountEditDialog.vue'
import SettingsOAuthDialog from '~/components/settings/SettingsOAuthDialog.vue'
import SettingsProviderCard from '~/components/settings/SettingsProviderCard.vue'
import SettingsProviderModels from '~/components/settings/SettingsProviderModels.vue'
import SettingsSeg from '~/components/settings/SettingsSeg.vue'
import { useSettingsStore, type ProviderAccount } from '~/stores/settings'

const EMPTY_CUSTOM: CustomProviderInput = {
  label: '',
  baseUrl: '',
  apiKey: '',
  api: 'anthropic-messages',
  models: [],
}

const { t } = useI18n()
const settings = useSettingsStore()

// Two tabs so the pane doesn't grow into one long scroll: credentials vs the
// per-provider model catalog. v-show (not v-if) keeps each tab's local state
// (SettingsProviderModels' provider selection) across switches.
const activeTab = ref<'accounts' | 'models'>('accounts')
const tabOptions = computed(() => [
  { label: t('settingsModels.tabs.accounts'), value: 'accounts' },
  { label: t('settingsModels.tabs.models'), value: 'models' },
])

const oauthOpen = ref(false)
// When set, the OAuth dialog re-authenticates this existing account in place
// rather than adding a new one. Cleared whenever the dialog closes.
const reauthAccountId = ref<string | null>(null)
const advancedOpen = ref(false)
const editAccount = ref<ProviderAccount | null>(null)
const testingIds = reactive(new Set<string>())
const testResults = reactive<Record<string, AccountTestResult>>({})

// Anthropic API-key (advanced) form.
const apiKeyLabel = ref('')
const apiKeyValue = ref('')
const apiKeyReveal = ref(false)
const apiKeyBusy = ref(false)
const apiKeyError = ref('')

// Custom endpoint form.
const customFormOpen = ref(false)
const customDraft = ref<CustomProviderInput>({ ...EMPTY_CUSTOM })
const customBusy = ref(false)
const customError = ref('')

// Anthropic card shows OAuth + plain API-key accounts; custom endpoints (apikey +
// baseURL) get their own section. Both live in the anthropic credential bucket.
const anthropicAccounts = computed(() =>
  settings.providers.anthropic.accounts.filter((a) => !a.baseURL),
)
const customAccounts = computed(() =>
  settings.providers.anthropic.accounts.filter((a) => !!a.baseURL),
)
const anthropicActiveId = computed(() => settings.providers.anthropic.activeAccountId)
const anthropicConnected = computed(() => settings.isProviderConnected('anthropic'))

const accountWord = (n: number) =>
  n === 1 ? t('settingsModels.status.account') : t('settingsModels.status.accounts')

const anthropicHeaderStatus = computed(() => {
  const count = anthropicAccounts.value.length
  if (count === 0) return t('settingsModels.status.notConnected')
  if (anthropicConnected.value) {
    return t('settingsModels.status.connectedCount', { n: count, accounts: accountWord(count) })
  }
  return t('settingsModels.status.count', { n: count, accounts: accountWord(count) })
})

const customSubtitle = (acc: ProviderAccount): string => {
  const parts: string[] = []
  if (acc.baseURL) {
    try {
      parts.push(`${t('settingsModels.custom.subtitle')} · ${new URL(acc.baseURL).host}`)
    } catch {
      parts.push(`${t('settingsModels.custom.subtitle')} · ${acc.baseURL}`)
    }
  }
  if (acc.models?.length) parts.push(acc.models.join(' · '))
  return parts.join('  ·  ')
}

const onAddApiKey = async () => {
  if (!apiKeyValue.value.trim() || apiKeyBusy.value) return
  apiKeyBusy.value = true
  apiKeyError.value = ''
  try {
    await settings.addApiKeyAccount({
      provider: 'anthropic',
      apiKey: apiKeyValue.value.trim(),
      label: apiKeyLabel.value.trim() || undefined,
    })
    apiKeyValue.value = ''
    apiKeyLabel.value = ''
    advancedOpen.value = false
  } catch (err) {
    apiKeyError.value = err instanceof Error ? err.message : t('settingsModels.form.addKeyError')
  } finally {
    apiKeyBusy.value = false
  }
}

const onAddCustom = async () => {
  if (customBusy.value) return
  if (!customDraft.value.apiKey.trim()) {
    customError.value = t('settingsModels.custom.keyRequired')
    return
  }
  customBusy.value = true
  customError.value = ''
  try {
    await settings.addApiKeyAccount({
      // Custom endpoints stay in the anthropic bucket regardless of wire protocol
      // (the bucket is a credential namespace, not the API shape; the runtime
      // routes via account.api).
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
    customError.value = err instanceof Error ? err.message : t('settingsModels.custom.addError')
  } finally {
    customBusy.value = false
  }
}

const onSetActive = async (accountId: string) => {
  try {
    await settings.setActiveAccount('anthropic', accountId)
  } catch (err) {
    console.warn('[settings] setActiveAccount failed', err)
  }
}

const onDisconnect = async (accountId: string) => {
  try {
    await settings.disconnectAccount('anthropic', accountId)
    delete testResults[accountId]
  } catch (err) {
    console.warn('[settings] disconnectAccount failed', err)
  }
}

const onTest = async (accountId: string) => {
  if (testingIds.has(accountId)) return
  testingIds.add(accountId)
  try {
    testResults[accountId] = await settings.testAccount('anthropic', accountId)
  } catch (err) {
    testResults[accountId] = {
      ok: false,
      error: {
        code: 'REQUEST_FAILED',
        message: err instanceof Error ? err.message : t('settingsModels.test.requestFailed'),
      },
    }
  } finally {
    testingIds.delete(accountId)
  }
}

const onEditSaved = (account: ProviderAccount) => {
  // A rotated key / changed endpoint makes a prior Test result stale.
  delete testResults[account.id]
}

const onReauth = (accountId: string) => {
  reauthAccountId.value = accountId
  oauthOpen.value = true
}

const onOauthClose = () => {
  oauthOpen.value = false
  reauthAccountId.value = null
}

const onOauthConnected = (account: ProviderAccount) => {
  // Re-auth refreshed the credentials in place — drop the stale AUTH_EXPIRED line.
  delete testResults[account.id]
  oauthOpen.value = false
  reauthAccountId.value = null
}
</script>

<style scoped>
.smodels {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* Tab strip sits left-aligned under the header, not stretched full width. */
.smtabs {
  align-self: flex-start;
}
/* Keep the card spacing the parent flex gave the cards before they were grouped. */
.smgroup {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Card surface (shared visual with SettingsProviderCard) */
.pcard {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgEl);
}
.pcardtop {
  display: flex;
  align-items: center;
  gap: 12px;
}
.pcardtop .rx {
  width: 34px;
  height: 34px;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  background: var(--bgActive);
  color: var(--textMuted);
  flex: 0 0 auto;
}
.pcardinfo {
  flex: 1;
  min-width: 0;
}
.pcardinfo .rt {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
}
.pcardinfo .rd {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
  margin-top: 2px;
}
.pcardstatus {
  flex: 0 0 auto;
}
.pcarddot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}
.pcardlist {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pcardcta {
  justify-content: center;
  width: 100%;
}
.pcardhint {
  text-align: center;
}
.pcardadd {
  align-self: flex-start;
  border-style: dashed;
}
.pcarderror {
  border-radius: var(--r-sm);
  padding: 6px 10px;
  font-size: 1em;
  background: var(--dangerDim);
  border: 1px solid var(--danger);
  color: var(--danger);
}

/* Advanced — API key (collapsible) */
.smadvanced {
  border-top: 1px solid var(--border);
  padding-top: 10px;
}
.smadvtoggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  color: var(--textDim);
  font-size: 1em;
  cursor: pointer;
  padding: 0;
}
.smadvtoggle:hover {
  color: var(--text);
}
.smchev {
  transition: transform 0.15s;
}
.smchev.open {
  transform: rotate(90deg);
}
.smadvbody {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.smcustomform {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
