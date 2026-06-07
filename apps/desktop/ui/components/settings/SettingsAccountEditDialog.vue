<template>
  <div
    v-if="open && account"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    :style="{ background: t.overlay }"
    @click.self="onCancel"
  >
    <div
      class="w-full max-w-md rounded-lg shadow-xl"
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
          class="p-1 rounded transition flex items-center"
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
          submit-label="Save changes"
          @submit="onSaveCustom"
          @cancel="onCancel"
        />
        <div
          v-if="error"
          class="mt-2 text-[1em] px-2 py-1 rounded"
          :style="{
            background: t.dangerBg,
            color: t.danger,
            border: `1px solid ${t.dangerBorder}`,
          }"
        >
          {{ error }}
        </div>
      </div>

      <!-- OAuth/subscription (Claude, ChatGPT): rename only -->
      <form v-else @submit.prevent="onSave">
        <div class="px-4 py-4 space-y-3">
          <label class="block">
            <span class="text-[1em]" :style="{ color: t.textDim }">Label</span>
            <input
              v-model="label"
              class="mt-1 w-full rounded px-2 py-1.5 text-[1em]"
              :style="inputStyle"
              placeholder="Label"
            />
          </label>

          <!-- Built-in API-key: rotate key + curate models -->
          <template v-if="kind === 'builtin-key'">
            <label class="block">
              <span class="text-[1em]" :style="{ color: t.textDim }">API key</span>
              <div class="mt-1 flex items-center gap-2">
                <input
                  v-model="apiKey"
                  :type="reveal ? 'text' : 'password'"
                  class="flex-1 rounded px-2 py-1.5 text-[1em] font-mono"
                  :style="inputStyle"
                  placeholder="Leave blank to keep current key"
                />
                <button
                  type="button"
                  class="px-2 py-1.5 rounded text-[1em] flex items-center"
                  :style="iconBtnStyle"
                  :title="reveal ? 'Hide' : 'Show'"
                  @click="reveal = !reveal"
                >
                  <component :is="reveal ? EyeOff : Eye" :size="13" />
                </button>
              </div>
            </label>

            <label class="block">
              <span class="text-[1em]" :style="{ color: t.textDim }">
                Models — one per line or comma-separated. Leave empty to use all available.
              </span>
              <textarea
                v-model="modelsText"
                rows="3"
                class="mt-1 w-full rounded px-2 py-1.5 text-[1em] font-mono resize-y min-h-[4.5rem]"
                :style="inputStyle"
                :placeholder="catalogIds.join('\n')"
              />
            </label>
            <div v-if="catalogIds.length" class="flex flex-wrap items-center gap-1">
              <span class="text-[1em]" :style="{ color: t.textDim }">Available:</span>
              <button
                v-for="id in catalogIds"
                :key="id"
                type="button"
                class="px-1.5 py-0.5 rounded font-mono text-[12px] leading-none transition"
                :style="{
                  background: t.bgInput,
                  color: t.textDim,
                  border: `1px solid ${t.border}`,
                }"
                title="Add this model"
                @click="addModelId(id)"
              >
                {{ id }}
              </button>
            </div>
          </template>

          <div
            v-if="error"
            class="text-[1em] px-2 py-1 rounded"
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
            class="px-3 py-1.5 text-[1em] rounded transition"
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
            class="px-3 py-1.5 text-[1em] rounded transition inline-flex items-center gap-1.5"
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
// allow-list: oauth → label only; apikey+baseURL → custom; apikey → built-in key.
const kind = computed<'oauth' | 'custom' | 'builtin-key' | null>(() => {
  const a = props.account
  if (!a) return null
  if (a.authMode === 'oauth') return 'oauth'
  return a.baseURL ? 'custom' : 'builtin-key'
})

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
const modelsText = ref('')
const customDraft = ref<CustomProviderInput>({ ...EMPTY_CUSTOM })
const busy = ref(false)
const error = ref('')

// Catalog ids for the built-in provider — shown as add-suggestions when curating.
const catalogIds = computed(() => modelsForProvider(props.provider).map((m) => m.id))

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

const parseModels = (raw: string): string[] =>
  raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)

const addModelId = (id: string) => {
  if (parseModels(modelsText.value).includes(id)) return
  modelsText.value = modelsText.value.trim() ? `${modelsText.value.trim()}\n${id}` : id
}

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
  } else if (kind.value === 'builtin-key') {
    modelsText.value = (a.models ?? []).join('\n')
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

// OAuth (label only) + built-in key (label + rotate key + curate models).
const onSave = () => {
  if (!canSave.value || busy.value) return
  if (kind.value === 'builtin-key') {
    commit({
      label: label.value.trim(),
      apiKey: apiKey.value.trim() || undefined,
      models: parseModels(modelsText.value),
    })
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
