<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Models & API Keys</h2>
      <div class="text-xs" :style="{ color: t.textDim }">
        Configure model providers. Keys are stored locally and never sent to Anthropic.
      </div>
    </div>
    <div class="space-y-2">
      <div
        v-for="prov in providers"
        :key="prov.id"
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
            <div class="text-[13px] font-medium" :style="{ color: t.text }">
              {{ prov.label }}
            </div>
            <div class="text-[10px]" :style="{ color: t.textDim }">
              {{ prov.models.join(' · ') }}
            </div>
          </div>
          <div
            class="flex items-center gap-1.5 text-[11px]"
            :style="{ color: settings.isProviderConnected(prov.id) ? t.text : t.textDim }"
          >
            <div
              class="w-1.5 h-1.5 rounded-full"
              :style="{
                background: settings.isProviderConnected(prov.id) ? t.statusOk : t.textFaint,
              }"
            />
            {{
              settings.isProviderConnected(prov.id)
                ? `Connected · ${settings.providers[prov.id].accounts.length} account${settings.providers[prov.id].accounts.length > 1 ? 's' : ''}`
                : 'Not configured'
            }}
          </div>
        </div>

        <div class="space-y-1.5">
          <div
            v-for="acc in settings.providers[prov.id].accounts"
            :key="acc.id"
            class="rounded p-2"
            :style="{
              background: t.bgInput,
              border: `1px solid ${settings.providers[prov.id].activeAccountId === acc.id ? t.borderStrong : t.border}`,
            }"
          >
            <template v-if="!isEditingAccount(prov.id, acc.id)">
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="flex items-center justify-center w-4 h-4 rounded-full transition"
                  :style="{
                    border: `1px solid ${t.borderStrong}`,
                    background:
                      settings.providers[prov.id].activeAccountId === acc.id
                        ? t.accent
                        : 'transparent',
                  }"
                  :title="
                    settings.providers[prov.id].activeAccountId === acc.id ? 'Active' : 'Set active'
                  "
                  @click="settings.setActiveAccount(prov.id, acc.id)"
                >
                  <Check
                    v-if="settings.providers[prov.id].activeAccountId === acc.id"
                    :size="10"
                    :style="{ color: t.accentText }"
                  />
                </button>
                <div class="flex-1 min-w-0">
                  <div class="text-[12px] truncate" :style="{ color: t.text }">{{ acc.label }}</div>
                  <div class="text-[10px] font-mono truncate" :style="{ color: t.textDim }">
                    {{ maskKey(acc.apiKey) || 'No key' }}
                  </div>
                </div>
                <button
                  type="button"
                  class="px-1.5 py-1 text-[11px] rounded transition flex items-center"
                  :style="iconBtnStyle"
                  title="Edit"
                  @click="onStartEditAccount(prov.id, acc)"
                >
                  <Pencil :size="12" />
                </button>
                <button
                  type="button"
                  class="px-1.5 py-1 text-[11px] rounded transition flex items-center"
                  :style="iconBtnStyle"
                  title="Remove"
                  @click="settings.removeProviderAccount(prov.id, acc.id)"
                >
                  <Trash2 :size="12" />
                </button>
              </div>
            </template>
            <template v-else>
              <form class="space-y-1.5" @submit.prevent="onSaveEditAccount(prov.id, acc.id)">
                <input
                  v-model="accountDraft.label"
                  class="w-full rounded px-2 py-1 text-[11px]"
                  :style="inputStyle"
                  placeholder="Label (e.g. Work)"
                  required
                />
                <div class="flex items-center gap-1.5">
                  <input
                    v-model="accountDraft.apiKey"
                    :type="revealDraftKey ? 'text' : 'password'"
                    class="flex-1 min-w-0 rounded px-2 py-1 text-[11px] font-mono"
                    :style="inputStyle"
                    placeholder="API key"
                  />
                  <button
                    type="button"
                    class="px-1.5 py-1 rounded text-[11px] flex items-center"
                    :style="iconBtnStyle"
                    :title="revealDraftKey ? 'Hide' : 'Show'"
                    @click="revealDraftKey = !revealDraftKey"
                  >
                    <component :is="revealDraftKey ? EyeOff : Eye" :size="12" />
                  </button>
                </div>
                <div class="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    class="px-2 py-1 text-[11px] rounded transition"
                    :style="iconBtnStyle"
                    @click="cancelAccountForm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    class="px-2 py-1 text-[11px] rounded transition"
                    :style="{ background: t.accent, color: t.accentText, border: 'none' }"
                    :disabled="!accountDraft.label.trim()"
                  >
                    Save
                  </button>
                </div>
              </form>
            </template>
          </div>

          <form
            v-if="addingAccountFor === prov.id"
            class="rounded p-2 space-y-1.5"
            :style="{ background: t.bgInput, border: `1px dashed ${t.border}` }"
            @submit.prevent="onCreateAccount(prov.id)"
          >
            <input
              v-model="accountDraft.label"
              class="w-full rounded px-2 py-1 text-[11px]"
              :style="inputStyle"
              placeholder="Label (e.g. Work)"
              required
              autofocus
            />
            <div class="flex items-center gap-1.5">
              <input
                v-model="accountDraft.apiKey"
                :type="revealDraftKey ? 'text' : 'password'"
                class="flex-1 min-w-0 rounded px-2 py-1 text-[11px] font-mono"
                :style="inputStyle"
                placeholder="API key"
              />
              <button
                type="button"
                class="px-1.5 py-1 rounded text-[11px] flex items-center"
                :style="iconBtnStyle"
                :title="revealDraftKey ? 'Hide' : 'Show'"
                @click="revealDraftKey = !revealDraftKey"
              >
                <component :is="revealDraftKey ? EyeOff : Eye" :size="12" />
              </button>
            </div>
            <div class="flex items-center justify-end gap-1.5">
              <button
                type="button"
                class="px-2 py-1 text-[11px] rounded transition"
                :style="iconBtnStyle"
                @click="cancelAccountForm"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="px-2 py-1 text-[11px] rounded transition"
                :style="{ background: t.accent, color: t.accentText, border: 'none' }"
                :disabled="!accountDraft.label.trim()"
              >
                Add account
              </button>
            </div>
          </form>
          <button
            v-else
            type="button"
            class="w-full rounded px-2 py-1.5 text-[11px] flex items-center gap-1.5 transition"
            :style="{
              color: t.textDim,
              border: `1px dashed ${t.border}`,
              background: 'transparent',
            }"
            @click="onStartAddAccount(prov.id)"
          >
            <Plus :size="12" />
            Add account
          </button>
        </div>
      </div>

      <div
        v-for="cp in settings.customProviders"
        :key="cp.id"
        class="rounded p-3"
        :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
      >
        <template v-if="editingCustomId !== cp.id">
          <div class="flex items-center gap-3 mb-2">
            <div
              class="w-8 h-8 rounded flex items-center justify-center"
              :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
            >
              <Sparkles :size="14" :style="{ color: t.textMuted }" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-medium truncate" :style="{ color: t.text }">
                {{ cp.label || 'Untitled provider' }}
              </div>
              <div class="text-[10px] truncate" :style="{ color: t.textDim }">
                {{ cp.baseUrl || 'No base URL' }}
                {{ cp.models.length ? `· ${cp.models.join(' · ')}` : '' }}
              </div>
            </div>
            <div
              class="flex items-center gap-1.5 text-[11px]"
              :style="{ color: cp.apiKey ? t.text : t.textDim }"
            >
              <div
                class="w-1.5 h-1.5 rounded-full"
                :style="{ background: cp.apiKey ? t.statusOk : t.textFaint }"
              />
              {{ cp.apiKey ? 'Key set' : 'No key' }}
            </div>
            <button
              type="button"
              class="px-2 py-1 text-[11px] rounded transition flex items-center"
              :style="iconBtnStyle"
              title="Edit"
              @click="onEditCustom(cp)"
            >
              <Pencil :size="13" />
            </button>
            <button
              type="button"
              class="px-2 py-1 text-[11px] rounded transition flex items-center"
              :style="iconBtnStyle"
              title="Remove"
              @click="onRemoveCustom(cp.id)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
        </template>
        <template v-else>
          <CustomProviderForm
            v-model="customDraft"
            submit-label="Save"
            @submit="onSaveEditCustom(cp.id)"
            @cancel="cancelCustomForm"
          />
        </template>
      </div>

      <div
        v-if="adding"
        class="rounded p-3"
        :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
      >
        <CustomProviderForm
          v-model="customDraft"
          submit-label="Add provider"
          @submit="onCreateCustom"
          @cancel="cancelCustomForm"
        />
      </div>
      <button
        v-else
        type="button"
        class="w-full rounded p-3 flex items-center gap-3 text-left transition"
        :style="{ background: t.bgElevated, border: `1px dashed ${t.border}` }"
        @click="onStartAddCustom"
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
            OpenRouter, Ollama, LM Studio, or any OpenAI-compatible endpoint
          </div>
        </div>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Check, Eye, EyeOff, Pencil, Plus, Sparkles, Trash2 } from 'lucide-vue-next'
import type {
  CustomProvider,
  CustomProviderInput,
  ProviderAccount,
  ProviderAccountInput,
} from '~/stores/settings'

type ProviderId = 'anthropic' | 'openai' | 'google'

const { t } = useTheme()
const settings = useSettingsStore()

const providers: { id: ProviderId; label: string; models: string[] }[] = [
  { id: 'anthropic', label: 'Anthropic', models: ['Claude Opus', 'Claude Sonnet'] },
  { id: 'openai', label: 'OpenAI', models: ['GPT-5', 'Codex'] },
  { id: 'google', label: 'Google', models: ['Gemini 2.5 Pro'] },
]

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const iconBtnStyle = computed(() => ({
  color: t.value.text,
  border: `1px solid ${t.value.borderStrong}`,
  background: 'transparent',
}))

const maskKey = (key: string) => {
  if (!key) return ''
  if (key.length <= 12) return '•'.repeat(key.length)
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

const emptyAccountDraft = (): ProviderAccountInput => ({ label: '', apiKey: '' })

const accountDraft = ref<ProviderAccountInput>(emptyAccountDraft())
const editingAccount = ref<{ provider: ProviderId; accountId: string } | null>(null)
const addingAccountFor = ref<ProviderId | null>(null)
const revealDraftKey = ref(false)

const isEditingAccount = (provider: ProviderId, accountId: string) =>
  editingAccount.value?.provider === provider && editingAccount.value.accountId === accountId

const cancelAccountForm = () => {
  editingAccount.value = null
  addingAccountFor.value = null
  accountDraft.value = emptyAccountDraft()
  revealDraftKey.value = false
}

const onStartAddAccount = (provider: ProviderId) => {
  editingAccount.value = null
  accountDraft.value = emptyAccountDraft()
  revealDraftKey.value = false
  addingAccountFor.value = provider
}

const onCreateAccount = async (provider: ProviderId) => {
  await settings.addProviderAccount(provider, accountDraft.value)
  cancelAccountForm()
}

const onStartEditAccount = (provider: ProviderId, account: ProviderAccount) => {
  addingAccountFor.value = null
  editingAccount.value = { provider, accountId: account.id }
  accountDraft.value = { label: account.label, apiKey: account.apiKey }
  revealDraftKey.value = false
}

const onSaveEditAccount = async (provider: ProviderId, accountId: string) => {
  await settings.updateProviderAccount(provider, accountId, accountDraft.value)
  cancelAccountForm()
}

const emptyCustomDraft = (): CustomProviderInput => ({
  label: '',
  baseUrl: '',
  apiKey: '',
  models: [],
})

const adding = ref(false)
const editingCustomId = ref<string | null>(null)
const customDraft = ref<CustomProviderInput>(emptyCustomDraft())

const cancelCustomForm = () => {
  adding.value = false
  editingCustomId.value = null
  customDraft.value = emptyCustomDraft()
}

const onStartAddCustom = () => {
  editingCustomId.value = null
  customDraft.value = emptyCustomDraft()
  adding.value = true
}

const onCreateCustom = () => {
  settings.addCustomProvider(customDraft.value)
  cancelCustomForm()
}

const onEditCustom = (cp: CustomProvider) => {
  adding.value = false
  editingCustomId.value = cp.id
  customDraft.value = {
    label: cp.label,
    baseUrl: cp.baseUrl,
    apiKey: cp.apiKey,
    models: [...cp.models],
  }
}

const onSaveEditCustom = (id: string) => {
  settings.updateCustomProvider(id, customDraft.value)
  cancelCustomForm()
}

const onRemoveCustom = (id: string) => {
  settings.removeCustomProvider(id)
  if (editingCustomId.value === id) cancelCustomForm()
}
</script>
