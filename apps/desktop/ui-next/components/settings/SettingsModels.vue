<template>
  <div class="flex flex-col gap-3">
    <SettingsPaneHeader
      :title="t('settingsModels.heading')"
      :subtitle="t('settingsModels.intro')"
    />

    <SettingsSeg v-model="activeTab" :options="tabOptions" class="self-start" />

    <!-- ── Accounts tab: credentials per provider + custom endpoints ───────── -->
    <div v-show="activeTab === 'accounts'" class="flex flex-col gap-3">
      <!-- ── Anthropic card (OAuth + advanced API key) ─────────────────────── -->
      <Card class="gap-2.5 p-3.5 shadow-none">
        <SettingsProviderCardHeader
          :title="t('settingsModels.anthropic.name')"
          :desc="t('settingsModels.anthropic.models')"
          :status="anthropicHeaderStatus"
          :connected="anthropicConnected"
        >
          <template #icon>
            <Icon name="agents" class="size-4 text-info" />
          </template>
        </SettingsProviderCardHeader>

        <!-- Empty state: prominent CTA -->
        <template v-if="anthropicAccounts.length === 0">
          <Button type="button" class="w-full" variant="default" @click="oauthOpen = true">
            <Icon name="agents" class="size-3.5" />
            {{ t('settingsModels.anthropic.signIn') }}
          </Button>
          <div class="text-center text-sm text-dim">
            {{ t('settingsModels.anthropic.signInHint') }}
          </div>
        </template>

        <!-- Account list -->
        <template v-else>
          <div class="flex flex-col gap-2">
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
          <Button
            type="button"
            class="self-start border-dashed"
            variant="outline"
            size="sm"
            @click="oauthOpen = true"
          >
            <Icon name="plus" class="size-3.5" />
            {{ t('settingsModels.account.addAnother') }}
          </Button>
        </template>

        <!-- Advanced — API key -->
        <Separator />
        <Collapsible v-model:open="advancedOpen">
          <CollapsibleTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              class="-ml-2 gap-1.5 font-normal text-dim hover:bg-transparent hover:text-foreground"
            >
              <Icon
                name="chev"
                class="size-3 transition-transform"
                :class="{ 'rotate-90': advancedOpen }"
              />
              {{ t('settingsModels.anthropic.advancedToggle') }}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent class="mt-2.5 flex flex-col gap-2">
            <div class="text-sm text-dim">{{ t('settingsModels.anthropic.advancedHint') }}</div>
            <Input
              v-model="apiKeyLabel"
              :placeholder="t('settingsModels.form.labelOptional')"
              class="flex-1"
            />
            <div class="flex items-center gap-2">
              <!-- mono-ok: API key -->
              <Input
                v-model="apiKeyValue"
                :type="apiKeyReveal ? 'text' : 'password'"
                placeholder="sk-ant-…"
                class="flex-1 font-mono"
                @keydown.enter="onAddApiKey"
              />
              <Button
                type="button"
                variant="ghost"
                size="iconSm"
                :title="
                  apiKeyReveal ? t('settingsModels.form.hide') : t('settingsModels.form.show')
                "
                :aria-label="
                  apiKeyReveal ? t('settingsModels.form.hide') : t('settingsModels.form.show')
                "
                @click="apiKeyReveal = !apiKeyReveal"
              >
                <Icon :name="apiKeyReveal ? 'eye-off' : 'eye'" />
              </Button>
              <Button
                type="button"
                :disabled="!apiKeyValue.trim() || apiKeyBusy"
                variant="default"
                size="sm"
                @click="onAddApiKey"
              >
                {{ t('settingsModels.form.addKey') }}
              </Button>
            </div>
            <Alert
              v-if="apiKeyError"
              variant="destructive"
              class="border-destructive/50 bg-destructive/10 px-2.5 py-1.5"
            >
              <AlertDescription>{{ apiKeyError }}</AlertDescription>
            </Alert>
          </CollapsibleContent>
        </Collapsible>
      </Card>

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
      <Card class="gap-2.5 p-3.5 shadow-none">
        <SettingsProviderCardHeader
          :title="t('settingsModels.custom.name')"
          :desc="t('settingsModels.custom.models')"
        >
          <template #icon>
            <Icon name="conn" class="size-4" />
          </template>
        </SettingsProviderCardHeader>

        <div v-if="customAccounts.length" class="flex flex-col gap-2">
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

        <div v-if="customFormOpen" class="flex flex-col gap-2">
          <CustomProviderForm
            v-model="customDraft"
            :submit-label="t('settingsModels.custom.addEndpoint')"
            @submit="onAddCustom"
            @cancel="customFormOpen = false"
          />
          <Alert
            v-if="customError"
            variant="destructive"
            class="border-destructive/50 bg-destructive/10 px-2.5 py-1.5"
          >
            <AlertDescription>{{ customError }}</AlertDescription>
          </Alert>
        </div>
        <Button
          v-else
          type="button"
          class="self-start border-dashed"
          variant="outline"
          size="sm"
          @click="customFormOpen = true"
        >
          <Icon name="plus" class="size-3.5" />
          {{ t('settingsModels.custom.add') }}
        </Button>
      </Card>
    </div>

    <!-- ── Models tab: AI authoring default + per-provider catalog ─────────── -->
    <div v-show="activeTab === 'models'" class="flex flex-col gap-3">
      <Card class="flex-row items-center gap-3 px-3.5 py-2.5 shadow-none">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-foreground">
            {{ t('settings.aiAuthoring.title') }}
          </div>
          <div class="mt-0.5 text-xs text-dim">{{ t('settings.aiAuthoring.desc') }}</div>
        </div>
        <AiModelPicker />
      </Card>
      <SettingsProviderModels />
    </div>

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
import AiModelPicker from '~/components/common/AiModelPicker.vue'
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
