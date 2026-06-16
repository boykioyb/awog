<template>
  <BaseModal :open="open" :title="tr('project.llm.title')" size="sm" @close="emit('close')">
    <div class="px-4 py-4 space-y-4">
      <p class="text-[1em] leading-relaxed" :style="{ color: t.textDim }">
        {{ tr('project.llm.subtitle') }}
      </p>

      <!-- Provider -->
      <div class="space-y-1.5">
        <label class="text-[1em] uppercase tracking-wider" :style="{ color: t.textDim }">
          {{ tr('project.llm.provider') }}
        </label>
        <AppSelect
          :model-value="draft.provider"
          @update:model-value="(v) => setProvider(v as ProviderName)"
        >
          <option v-for="p in providers" :key="p" :value="p">
            {{ PROVIDER_LABEL[p]
            }}{{ isProviderConnected(p) ? '' : ` — ${tr('project.llm.not_connected')}` }}
          </option>
        </AppSelect>
      </div>

      <!-- Account -->
      <div class="space-y-1.5">
        <label class="text-[1em] uppercase tracking-wider" :style="{ color: t.textDim }">
          {{ tr('project.llm.account') }}
        </label>
        <AppSelect
          :model-value="draft.accountId ?? ''"
          @update:model-value="(v) => setAccount(v ? String(v) : undefined)"
        >
          <option value="">{{ tr('project.llm.follow_active') }}</option>
          <option v-for="acc in accounts" :key="acc.id" :value="acc.id">
            {{ acc.label }}{{ acc.account?.email ? ` (${acc.account.email})` : '' }}
          </option>
        </AppSelect>
      </div>

      <!-- Model -->
      <div class="space-y-1.5">
        <label class="text-[1em] uppercase tracking-wider" :style="{ color: t.textDim }">
          {{ tr('project.llm.model') }}
        </label>
        <AppSelect :model-value="draft.modelId" @update:model-value="(v) => setModel(String(v))">
          <option v-for="m in availableModels" :key="m.id" :value="m.id">
            {{ m.label }} · {{ m.tier }}
          </option>
        </AppSelect>
      </div>

      <!-- Effort -->
      <div class="space-y-1.5">
        <label class="text-[1em] uppercase tracking-wider" :style="{ color: t.textDim }">
          {{ tr('project.llm.effort') }}
        </label>
        <AppSelect
          :model-value="draft.level"
          :disabled="!currentModel?.supportsThinking"
          @update:model-value="(v) => setLevel(v as ThinkingLevel)"
        >
          <option v-for="lv in availableLevels" :key="lv" :value="lv">
            {{ LEVEL_LABEL[lv] }}
          </option>
        </AppSelect>
      </div>
    </div>

    <template #footer>
      <AppButton v-if="hasCustomDefaults" variant="ghost" class="mr-auto" @click="onReset">
        {{ tr('project.llm.reset') }}
      </AppButton>
      <AppButton variant="ghost" @click="emit('close')">
        {{ tr('common.cancel') }}
      </AppButton>
      <AppButton :disabled="saving" @click="onSave">
        {{ tr('common.save') }}
      </AppButton>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { ProviderName, ThinkingLevel } from '~/types'
import { LEVEL_LABEL, PROVIDER_LABEL } from '~/utils/models'

const props = defineProps<{
  open: boolean
  projectId: string | null
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const { t } = useTheme()
const { t: tr } = useI18n()

const {
  draft,
  providers,
  accounts,
  availableModels,
  availableLevels,
  currentModel,
  isProviderConnected,
  hasCustomDefaults,
  setProvider,
  setAccount,
  setModel,
  setLevel,
  save,
  resetToAppDefault,
} = useProjectLlmDefaults(
  () => props.projectId,
  () => props.open,
)

const saving = ref(false)

const onSave = async () => {
  if (saving.value) return
  saving.value = true
  try {
    await save()
    emit('saved')
    emit('close')
  } finally {
    saving.value = false
  }
}

const onReset = async () => {
  if (saving.value) return
  saving.value = true
  try {
    await resetToAppDefault()
    emit('saved')
    emit('close')
  } finally {
    saving.value = false
  }
}
</script>
