<template>
  <LibraryEntityModal
    :open="open"
    :title="t('projects.llm.title')"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="pll">
      <div class="pll-note">
        {{ t('projects.llm.note', { name: ctrl.project.value?.name ?? '' }) }}
      </div>

      <div class="pll-field">
        <label class="pll-label">{{ t('projects.llm.provider') }}</label>
        <div class="pll-seg">
          <button
            v-for="p in ctrl.providers"
            :key="p"
            type="button"
            class="chip pll-chip"
            :class="{ on: ctrl.draft.value.provider === p }"
            :disabled="!ctrl.isProviderConnected(p)"
            :title="ctrl.isProviderConnected(p) ? '' : t('projects.llm.providerOff')"
            @click="ctrl.setProvider(p)"
          >
            {{ providerLabel(p) }}
          </button>
        </div>
      </div>

      <div class="pll-field">
        <label class="pll-label">{{ t('projects.llm.account') }}</label>
        <AppSelect
          :model-value="ctrl.draft.value.accountId ?? '__active'"
          :options="accountOptions"
          width="100%"
          @update:model-value="onAccount"
        />
      </div>

      <div class="pll-field">
        <label class="pll-label">{{ t('projects.llm.model') }}</label>
        <AppSelect
          :model-value="ctrl.draft.value.modelId"
          :options="modelOptions"
          :placeholder="t('projects.llm.modelPh')"
          width="100%"
          @update:model-value="ctrl.setModel"
        />
      </div>

      <div class="pll-field">
        <label class="pll-label">{{ t('projects.llm.effort') }}</label>
        <div class="pll-seg">
          <button
            v-for="lv in ctrl.levels"
            :key="lv"
            type="button"
            class="chip pll-chip"
            :class="{ on: ctrl.draft.value.level === lv }"
            @click="ctrl.setLevel(lv)"
          >
            {{ t('projects.llm.level.' + lv) }}
          </button>
        </div>
      </div>

      <div class="pll-field">
        <div class="pll-mcphead">
          <label class="pll-label">{{ t('projects.llm.mcp') }}</label>
          <button
            v-if="ctrl.isMcpCustomized.value"
            type="button"
            class="pll-mcpreset"
            @click="ctrl.resetMcp"
          >
            {{ t('projects.llm.mcpReset') }}
          </button>
        </div>
        <p class="pll-mcphint">
          {{ ctrl.isMcpCustomized.value ? t('projects.llm.mcpCustom') : t('projects.llm.mcpAll') }}
        </p>
        <div v-if="!ctrl.mcpEnabledServers.value.length" class="listempty">
          {{ t('projects.llm.mcpNone') }}
        </div>
        <div v-else class="pll-mcplist">
          <div
            v-for="m in ctrl.mcpEnabledServers.value"
            :key="m.id"
            class="mcprow"
            @click="ctrl.toggleMcp(m.id)"
          >
            <span
              class="cdot"
              :style="{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: m.status === 'running' ? 'var(--green)' : 'var(--textFaint)',
              }"
            />
            <span class="mcpn">{{ m.name }}</span>
            <span class="mcpst">{{ m.status }}</span>
            <span class="tog2 sm" :class="{ off: !ctrl.isMcpActive(m.id) }" />
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <button
        v-if="ctrl.hasCustomDefaults.value"
        class="btn"
        style="margin-right: auto; color: var(--danger)"
        @click="onReset"
      >
        {{ t('projects.llm.reset') }}
      </button>
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="btn pri" @click="onSave">{{ t('projects.llm.save') }}</button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Per-project LLM defaults modal — provider / account / model / reasoning effort
// new sessions in this project inherit. Owns no state itself; delegates to
// useProjectLlmDefaults (reconciliation) and persists via the projects store.
import { computed } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useProjectLlmDefaults } from '~/composables/useProjectLlmDefaults'
import type { Project, ProviderName } from '~/types'

const props = defineProps<{ open: boolean; project: Project | null }>()
const emit = defineEmits<{ saved: [project: Project]; cancel: [] }>()

const { t } = useI18n()

const ctrl = useProjectLlmDefaults(
  () => props.project?.id ?? null,
  () => props.open,
)

const PROVIDER_LABEL: Record<ProviderName, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}
const providerLabel = (p: ProviderName) => PROVIDER_LABEL[p]

const accountOptions = computed<AppSelectOption[]>(() => [
  { value: '__active', label: t('projects.llm.accountActive') },
  ...ctrl.accounts.value.map((a) => ({ value: a.id, label: a.label || a.fingerprint })),
])

const modelOptions = computed<AppSelectOption[]>(() =>
  ctrl.availableModelIds.value.map((id) => ({ value: id, label: ctrl.modelLabel(id) })),
)

const onAccount = (v: string) => ctrl.setAccount(v === '__active' ? undefined : v)

const onSave = async () => {
  const saved = await ctrl.save()
  if (saved) emit('saved', saved)
}
const onReset = async () => {
  const saved = await ctrl.resetToAppDefault()
  if (saved) emit('saved', saved)
}
</script>

<style scoped>
.pll {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.pll-note {
  font-size: 0.9231rem;
  color: var(--textDim);
  line-height: 1.5;
}
.pll-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.pll-label {
  font-size: 0.8846rem;
  font-weight: 550;
  color: var(--text);
}
.pll-seg {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pll-chip {
  cursor: pointer;
  background: var(--bgInput);
}
.pll-chip.on {
  color: var(--accent);
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.pll-chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.pll-mcphead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.pll-mcpreset {
  font-size: 0.8462rem;
  color: var(--accent);
  cursor: pointer;
}
.pll-mcphint {
  font-size: 0.8462rem;
  color: var(--textDim);
}
.pll-mcplist {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 10px;
  max-height: 196px;
  overflow-y: auto;
}
</style>
