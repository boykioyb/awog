<template>
  <!-- Teleport ra body: ancestor Liquid Glass có backdrop-filter/transform tạo
       containing block mới cho position:fixed, khiến overlay không phủ toàn
       viewport nếu render inline. -->
  <Teleport to="body">
    <div
      v-if="open && account"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      :style="{ background: t.overlay }"
      @click.self="onCancel"
    >
      <div
        class="w-full max-w-md rounded-xl shadow-xl"
        :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
        role="dialog"
        aria-modal="true"
      >
        <div
          class="px-4 py-3 flex items-center justify-between"
          :style="{ borderBottom: `1px solid ${t.border}` }"
        >
          <div class="text-[1em] font-semibold" :style="{ color: t.text }">Edit connection</div>
          <button
            type="button"
            class="p-1.5 rounded-md transition flex items-center"
            :style="{ color: t.textDim }"
            aria-label="Close"
            @click="onCancel"
          >
            <X :size="14" />
          </button>
        </div>

        <!-- Custom endpoint: reuse the add form in edit mode (label/baseURL/api/key/models) -->
        <div v-if="kind === 'custom'" class="px-4 py-4">
          <CustomProviderForm
            v-model="customDraft"
            editing
            :has-key="!!account?.fingerprint"
            submit-label="Save changes"
            @submit="onSaveCustom"
            @cancel="onCancel"
          />
          <div
            v-if="error"
            class="mt-2 text-[1em] px-2 py-1 rounded-lg"
            :style="{
              background: t.dangerBg,
              color: t.danger,
              border: `1px solid ${t.dangerBorder}`,
            }"
          >
            {{ error }}
          </div>
        </div>

        <!-- Built-in key + OAuth/subscription: label, (key for built-in), curate models -->
        <form v-else @submit.prevent="onSave">
          <div class="px-4 py-4 space-y-3">
            <label class="block">
              <span class="text-[1em]" :style="{ color: t.textDim }">Label</span>
              <input
                v-model="label"
                class="mt-1 w-full rounded-lg px-2.5 py-2 text-[1em]"
                :style="inputStyle"
                placeholder="Label"
              />
            </label>

            <!-- Built-in API-key only: rotate the key (OAuth tokens are managed). -->
            <label v-if="kind === 'builtin-key'" class="block">
              <span class="text-[1em]" :style="{ color: t.textDim }">API key</span>
              <div class="mt-1 flex items-center gap-2">
                <input
                  v-model="apiKey"
                  :type="reveal ? 'text' : 'password'"
                  class="flex-1 rounded-lg px-2.5 py-2 text-[1em] font-mono"
                  :style="inputStyle"
                  placeholder="Enter a new key to replace"
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
              </div>
              <!-- The stored key never leaves the sidecar (security invariant #1) —
                 we can only say a key is saved, not show it. -->
              <p class="mt-1 text-[1em]" :style="{ color: t.textDim }">
                <template v-if="account?.fingerprint">
                  An API key is saved — leave blank to keep it, or enter a new key to replace it.
                </template>
                <template v-else>Leave blank to keep the current key.</template>
              </p>
            </label>

            <!-- Curate models — built-in key + subscription. Each model is a list
               row (remove to hide); add via the input/suggestions. Empty = all. -->
            <div v-if="showModels" class="block">
              <span class="text-[1em]" :style="{ color: t.textDim }">
                Models — remove to hide, add to include. Leave empty to use all available.
              </span>
              <div class="mt-1">
                <ModelListEditor v-model="modelsList" :suggestions="catalogIds" />
              </div>
            </div>

            <div
              v-if="error"
              class="text-[1em] px-2 py-1 rounded-lg"
              :style="{
                background: t.dangerBg,
                color: t.danger,
                border: `1px solid ${t.dangerBorder}`,
              }"
            >
              {{ error }}
            </div>
          </div>

          <div
            class="px-4 py-3 flex items-center justify-end gap-2"
            :style="{ borderTop: `1px solid ${t.border}` }"
          >
            <button
              type="button"
              class="px-3 py-1.5 text-[1em] rounded-lg transition"
              :style="{
                background: 'transparent',
                border: `1px solid ${t.borderStrong}`,
                color: t.text,
              }"
              @click="onCancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="px-3 py-1.5 text-[1em] rounded-lg transition inline-flex items-center gap-1.5"
              :style="{ background: t.accent, color: t.accentText, border: 'none' }"
              :disabled="!canSave || busy"
            >
              <Loader2 v-if="busy" :size="12" class="animate-spin" />
              Save changes
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Eye, EyeOff, Loader2, X } from 'lucide-vue-next'
import type { ProviderAccount, ProviderName } from '~/types'
import type { CustomProviderInput } from '~/stores/settings'
import { modelsForProvider } from '~/utils/models'

const props = defineProps<{
  open: boolean
  provider: ProviderName
  account: ProviderAccount | null
}>()

const emit = defineEmits<{
  close: []
  saved: [account: ProviderAccount]
}>()

const { t } = useTheme()
const settings = useSettingsStore()

// Kind drives which fields are editable. Mirrors the sidecar's accounts.update
// allow-list: oauth → label + curate models; apikey+baseURL → custom; apikey →
// built-in key (+ rotate key + curate models).
const kind = computed<'oauth' | 'custom' | 'builtin-key' | null>(() => {
  const a = props.account
  if (!a) return null
  if (a.authMode === 'oauth') return 'oauth'
  return a.baseURL ? 'custom' : 'builtin-key'
})

// A ChatGPT subscription (Codex): provider 'openai' + OAuth. Its catalog isn't
// the pay-as-you-go OpenAI list, so suggest the account's own seeded models.
const isCodex = computed(() => props.account?.authMode === 'oauth' && props.provider === 'openai')

// Models are curatable on built-in key + any subscription (custom uses its own
// form). Empty = all available.
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

// The provider's available models. Codex has no static catalog here, so use the
// account's own seeded set; other providers use the static catalog. Drives both
// the pre-filled list and the add-suggestions.
const catalogIds = computed(() =>
  isCodex.value
    ? (props.account?.models ?? [])
    : modelsForProvider(props.provider).map((m) => m.id),
)

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x))

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
    // builtin-key + oauth subscription: show the effective list so the user can
    // remove (hide) or add. Curated list if present, else the full catalog (so
    // there's something to hide from).
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
    error.value = err instanceof Error ? err.message : 'Failed to save changes'
  } finally {
    busy.value = false
  }
}

// builtin-key (label + rotate key + curate models) and oauth subscription
// (label + curate models). Custom endpoints go through onSaveCustom.
const onSave = () => {
  if (!canSave.value || busy.value) return
  if (kind.value === 'builtin-key' || kind.value === 'oauth') {
    const list = modelsList.value.map((s) => s.trim()).filter(Boolean)
    // Keeping the whole catalog == "all available" → store nothing so it tracks
    // the live catalog instead of pinning a snapshot. Codex has no static catalog
    // to compare against, so it always stores the list explicitly.
    const models = !isCodex.value && sameSet(list, catalogIds.value) ? [] : list
    commit(
      kind.value === 'builtin-key'
        ? { label: label.value.trim(), apiKey: apiKey.value.trim() || undefined, models }
        : { label: label.value.trim(), models },
    )
  } else {
    commit({ label: label.value.trim() })
  }
}

const onSaveCustom = () => {
  if (busy.value) return
  const d = customDraft.value
  if (!d.label.trim() || !d.baseUrl.trim()) {
    error.value = 'Label and base URL are required'
    return
  }
  if (!d.models.length) {
    error.value = 'A custom endpoint needs at least one model id'
    return
  }
  commit({
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
