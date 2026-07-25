<template>
  <SettingsModelDialog
    :open="open && !!account"
    :title="t('settingsModels.edit.title')"
    @close="onCancel"
  >
    <!-- Custom endpoint: reuse the add form in edit mode -->
    <template v-if="kind === 'custom'">
      <CustomProviderForm
        v-model="customDraft"
        editing
        :has-key="!!account?.fingerprint"
        :submit-label="t('settingsModels.form.save')"
        @submit="onSaveCustom"
        @cancel="onCancel"
      />
      <div v-if="error" class="aederror">{{ error }}</div>
    </template>

    <!-- Built-in key + OAuth/subscription: label, (key for built-in), curate models -->
    <form v-else class="aed" @submit.prevent="onSave">
      <label class="aedfield">
        <span class="fd">{{ t('settingsModels.form.label') }}</span>
        <input v-model="label" class="keyinp" :placeholder="t('settingsModels.form.label')" />
      </label>

      <!-- Built-in API-key only: rotate the key (OAuth tokens are managed). -->
      <label v-if="kind === 'builtin-key'" class="aedfield">
        <span class="fd">{{ t('settingsModels.edit.keyLabel') }}</span>
        <div class="keyrow">
          <input
            v-model="apiKey"
            class="keyinp mono"
            :type="reveal ? 'text' : 'password'"
            :placeholder="t('settingsModels.edit.keyReplacePlaceholder')"
          />
          <span
            class="keyeye"
            :title="reveal ? t('settingsModels.form.hide') : t('settingsModels.form.show')"
            @click="reveal = !reveal"
          >
            👁
          </span>
        </div>
        <!-- The stored key never leaves the sidecar (security invariant #1). -->
        <p class="fd aednote">
          {{
            account?.fingerprint
              ? t('settingsModels.edit.keySavedReplace')
              : t('settingsModels.edit.keyBlankKeep')
          }}
        </p>
      </label>

      <!-- Curate models — built-in key + subscription. Empty = all available. -->
      <div v-if="showModels" class="aedfield">
        <span class="fd">{{ t('settingsModels.edit.modelsLabel') }}</span>
        <ModelListEditor v-model="modelsList" :suggestions="catalogIds" />
      </div>

      <div v-if="error" class="aederror">{{ error }}</div>
    </form>

    <template v-if="kind !== 'custom'" #footer>
      <button class="btn sm" type="button" @click="onCancel">
        {{ t('settingsModels.form.cancel') }}
      </button>
      <button class="btn sm pri" type="button" :disabled="!canSave || busy" @click="onSave">
        {{ t('settingsModels.form.save') }}
      </button>
    </template>
  </SettingsModelDialog>
</template>

<script setup lang="ts">
import CustomProviderForm, {
  type CustomProviderInput,
} from '~/components/settings/CustomProviderForm.vue'
import ModelListEditor from '~/components/settings/ModelListEditor.vue'
import SettingsModelDialog from '~/components/settings/SettingsModelDialog.vue'
import { useSettingsStore, type ProviderAccount, type ProviderName } from '~/stores/settings'

// Edit dialog (kind = oauth | builtin-key | custom). oauth → label + curate
// models; builtin-key → label + rotate key + curate models; custom → reuse the
// CustomProviderForm. Ported from legacy SettingsAccountEditDialog.vue.

// Per-provider engine model-id catalog for the curation suggestions. Built-in API
// keys use the full catalog; a Codex subscription has no static catalog and uses
// the account's own seeded models instead.
const MODEL_CATALOG: Record<ProviderName, string[]> = {
  anthropic: ['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  openai: ['gpt-5.1', 'o3', 'gpt-4.1', 'gpt-5-mini'],
  google: ['gemini-3-pro', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
}

const props = defineProps<{
  open: boolean
  provider: ProviderName
  account: ProviderAccount | null
}>()

const emit = defineEmits<{
  close: []
  saved: [account: ProviderAccount]
}>()

const { t } = useI18n()
const settings = useSettingsStore()

// Kind drives which fields are editable. Mirrors the sidecar's accounts.update
// allow-list.
const kind = computed<'oauth' | 'custom' | 'builtin-key' | null>(() => {
  const a = props.account
  if (!a) return null
  if (a.authMode === 'oauth') return 'oauth'
  return a.baseURL ? 'custom' : 'builtin-key'
})

// A ChatGPT subscription (Codex): provider 'openai' + OAuth.
const isCodex = computed(() => props.account?.authMode === 'oauth' && props.provider === 'openai')

// Curatable on built-in key + any subscription (custom uses its own form).
const showModels = computed(() => kind.value === 'builtin-key' || kind.value === 'oauth')

const EMPTY_CUSTOM: CustomProviderInput = {
  label: '',
  baseUrl: '',
  apiKey: '',
  api: 'anthropic-messages',
  models: [],
}

const label = ref('')
const apiKey = ref('')
const reveal = ref(false)
const modelsList = ref<string[]>([])
const customDraft = ref<CustomProviderInput>({ ...EMPTY_CUSTOM })
const busy = ref(false)
const error = ref('')

// Codex has no static catalog here → use the account's own seeded set; other
// providers use the static catalog.
const catalogIds = computed(() =>
  isCodex.value ? (props.account?.models ?? []) : MODEL_CATALOG[props.provider],
)

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x))

const canSave = computed(() => label.value.trim().length > 0)

const seed = () => {
  const a = props.account
  if (!a) return
  error.value = ''
  busy.value = false
  reveal.value = false
  label.value = a.label
  apiKey.value = ''
  if (kind.value === 'custom') {
    customDraft.value = {
      label: a.label,
      baseUrl: a.baseURL ?? '',
      apiKey: '',
      api: a.api ?? 'anthropic-messages',
      models: a.models ? [...a.models] : [],
    }
  } else if (showModels.value) {
    // Show the effective list so the user can remove (hide) or add. Curated list
    // if present, else the full catalog (so there's something to hide from).
    modelsList.value = a.models?.length ? [...a.models] : [...catalogIds.value]
  }
}

const commit = async (patch: Parameters<typeof settings.updateAccount>[2]) => {
  if (!props.account) return
  busy.value = true
  error.value = ''
  try {
    const updated = await settings.updateAccount(props.provider, props.account.id, patch)
    emit('saved', updated)
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('settingsModels.edit.saveError')
  } finally {
    busy.value = false
  }
}

const onSave = () => {
  if (!canSave.value || busy.value) return
  if (kind.value === 'builtin-key' || kind.value === 'oauth') {
    const list = modelsList.value.map((s) => s.trim()).filter(Boolean)
    // Keeping the whole catalog == "all available" → store nothing so it tracks
    // the live catalog. Codex has no static catalog, so it always stores the list.
    const models = !isCodex.value && sameSet(list, catalogIds.value) ? [] : list
    void commit(
      kind.value === 'builtin-key'
        ? { label: label.value.trim(), apiKey: apiKey.value.trim() || undefined, models }
        : { label: label.value.trim(), models },
    )
  } else {
    void commit({ label: label.value.trim() })
  }
}

const onSaveCustom = () => {
  if (busy.value) return
  const d = customDraft.value
  if (!d.label.trim() || !d.baseUrl.trim()) {
    error.value = t('settingsModels.custom.labelUrlRequired')
    return
  }
  if (!d.models.length) {
    error.value = t('settingsModels.custom.modelRequired')
    return
  }
  void commit({
    label: d.label.trim(),
    baseURL: d.baseUrl.trim(),
    api: d.api,
    apiKey: d.apiKey.trim() || undefined,
    models: d.models,
  })
}

const onCancel = () => emit('close')

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) seed()
  },
)
</script>

<style scoped>
.aed {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.aedfield {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.aedfield > .keyinp {
  width: 100%;
}
.aednote {
  margin: 0;
}
.aederror {
  margin-top: 8px;
  border-radius: 8px;
  padding: 8px 11px;
  font-size: 1em;
  background: var(--dangerDim);
  border: 1px solid var(--danger);
  color: var(--danger);
}
</style>
