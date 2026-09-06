<template>
  <div class="pcard">
    <div class="pcardtop">
      <span class="rx">
        <Icon name="agents" :style="iconStyle" />
      </span>
      <div class="pcardinfo">
        <div class="rt">{{ name }}</div>
        <div class="rd">{{ models }}</div>
      </div>
      <span class="chip pcardstatus">
        <span
          class="pcarddot"
          :style="{ background: connected ? 'var(--green)' : 'var(--textFaint)' }"
        />
        {{ headerStatus }}
      </span>
    </div>

    <!-- Account list -->
    <div v-if="accounts.length" class="pcardlist">
      <SettingsAccountRow
        v-for="acc in accounts"
        :key="acc.id"
        :account="acc"
        :active="activeId === acc.id"
        :testing="testingIds.has(acc.id)"
        :test-result="testResults[acc.id] ?? null"
        @set-active="onSetActive(acc.id)"
        @edit="editAccount = acc"
        @test="onTest(acc.id)"
        @disconnect="onDisconnect(acc.id)"
      />
    </div>

    <!-- ChatGPT subscription (OpenAI Codex OAuth) -->
    <button v-if="codex" class="btn pri pcardcta" type="button" @click="codexOpen = true">
      <Icon name="agents" style="width: var(--icon-sm); height: var(--icon-sm)" />
      {{ t('settingsModels.openai.signIn') }}
    </button>
    <div v-if="codex && !accounts.length" class="fd pcardhint">
      {{ t('settingsModels.openai.signInHint') }}
    </div>

    <!-- Add-key form -->
    <div v-if="formOpen" class="pcardform">
      <input
        v-model="keyLabel"
        class="keyinp"
        :placeholder="t('settingsModels.form.labelOptional')"
      />
      <div class="keyrow">
        <input
          v-model="keyValue"
          class="keyinp mono"
          :type="reveal ? 'text' : 'password'"
          :placeholder="keyPlaceholder"
          @keydown.enter="onAdd"
        />
        <span
          class="keyeye"
          :title="reveal ? t('settingsModels.form.hide') : t('settingsModels.form.show')"
          @click="reveal = !reveal"
        >
          👁
        </span>
        <button
          class="btn sm pri"
          type="button"
          :disabled="!keyValue.trim() || busy"
          @click="onAdd"
        >
          {{ t('settingsModels.form.addKey') }}
        </button>
      </div>
      <div v-if="error" class="pcarderror">{{ error }}</div>
    </div>
    <button v-else class="btn sm pcardadd" type="button" @click="formOpen = true">
      <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
      {{ addKeyLabel }}
    </button>

    <SettingsCodexDialog
      v-if="codex"
      :open="codexOpen"
      @close="codexOpen = false"
      @connected="codexOpen = false"
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
import SettingsAccountRow, {
  type AccountTestResult,
} from '~/components/settings/SettingsAccountRow.vue'
import SettingsAccountEditDialog from '~/components/settings/SettingsAccountEditDialog.vue'
import SettingsCodexDialog from '~/components/settings/SettingsCodexDialog.vue'
import { useSettingsStore, type ProviderAccount, type ProviderName } from '~/stores/settings'

// OpenAI / Google provider card: account list + add-API-key form, plus an
// optional ChatGPT (Codex OAuth) sign-in for OpenAI. Ported from the legacy
// SettingsApiKeyProviderCard.vue into ui-next prototype style.
const props = withDefaults(
  defineProps<{
    provider: Extract<ProviderName, 'openai' | 'google'>
    name: string
    models: string
    keyPlaceholder: string
    iconColor?: string
    // Show the ChatGPT subscription (OpenAI Codex OAuth) sign-in button. OpenAI only.
    codex?: boolean
  }>(),
  { iconColor: '', codex: false },
)

const { t } = useI18n()
const settings = useSettingsStore()

const formOpen = ref(false)
const codexOpen = ref(false)
const keyLabel = ref('')
const keyValue = ref('')
const reveal = ref(false)
const busy = ref(false)
const error = ref('')
const testingIds = reactive(new Set<string>())
const testResults = reactive<Record<string, AccountTestResult>>({})
const editAccount = ref<ProviderAccount | null>(null)

const accounts = computed<ProviderAccount[]>(() => settings.providers[props.provider].accounts)
const activeId = computed(() => settings.providers[props.provider].activeAccountId)
const connected = computed(() => settings.isProviderConnected(props.provider))

const iconStyle = computed(() =>
  props.iconColor
    ? { width: '16px', height: '16px', color: props.iconColor }
    : { width: '16px', height: '16px' },
)

const accountWord = (n: number) =>
  n === 1 ? t('settingsModels.status.account') : t('settingsModels.status.accounts')

const headerStatus = computed(() => {
  const count = accounts.value.length
  if (count === 0) return t('settingsModels.status.notConnected')
  if (connected.value) {
    return t('settingsModels.status.connectedCount', { n: count, accounts: accountWord(count) })
  }
  return t('settingsModels.status.count', { n: count, accounts: accountWord(count) })
})

// When the codex sign-in is present, the API-key form is the secondary option.
const addKeyLabel = computed(() => {
  if (accounts.value.length) return t('settingsModels.account.addAnother')
  return props.codex
    ? t('settingsModels.account.useKeyInstead')
    : t('settingsModels.account.addKey')
})

const onAdd = async () => {
  if (!keyValue.value.trim() || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await settings.addApiKeyAccount({
      provider: props.provider,
      apiKey: keyValue.value.trim(),
      label: keyLabel.value.trim() || undefined,
    })
    keyValue.value = ''
    keyLabel.value = ''
    formOpen.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('settingsModels.form.addKeyError')
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
    delete testResults[accountId]
  } catch (err) {
    console.warn('[settings] disconnectAccount failed', err)
  }
}

const onTest = async (accountId: string) => {
  if (testingIds.has(accountId)) return
  testingIds.add(accountId)
  try {
    testResults[accountId] = await settings.testAccount(props.provider, accountId)
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
  delete testResults[account.id]
}
</script>

<style scoped>
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
.pcardform {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
</style>
