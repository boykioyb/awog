<template>
  <LibraryEntityModal
    :open="open"
    :title="t('projects.llm.title')"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-4">
      <div class="text-sm text-dim">
        {{ t('projects.llm.note', { name: ctrl.project.value?.name ?? '' }) }}
      </div>

      <div :class="FIELD">
        <Label>{{ t('projects.llm.provider') }}</Label>
        <ToggleGroup
          type="single"
          :spacing="1.5"
          class="flex-wrap"
          :model-value="ctrl.draft.value.provider"
          @update:model-value="(v) => v && ctrl.setProvider(v as ProviderName)"
        >
          <ToggleGroupItem
            v-for="p in ctrl.providers"
            :key="p"
            :value="p"
            :class="CHIP"
            :disabled="!ctrl.isProviderConnected(p)"
            :title="ctrl.isProviderConnected(p) ? '' : t('projects.llm.providerOff')"
          >
            {{ providerLabel(p) }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div :class="FIELD">
        <Label>{{ t('projects.llm.account') }}</Label>
        <AppSelect
          :model-value="ctrl.draft.value.accountId ?? '__active'"
          :options="accountOptions"
          width="100%"
          @update:model-value="onAccount"
        />
      </div>

      <div :class="FIELD">
        <Label>{{ t('projects.llm.model') }}</Label>
        <AppSelect
          :model-value="ctrl.draft.value.modelId"
          :options="modelOptions"
          :placeholder="t('projects.llm.modelPh')"
          width="100%"
          @update:model-value="ctrl.setModel"
        />
      </div>

      <div :class="FIELD">
        <Label>{{ t('projects.llm.effort') }}</Label>
        <ToggleGroup
          type="single"
          :spacing="1.5"
          class="flex-wrap"
          :model-value="ctrl.draft.value.level"
          @update:model-value="(v) => v && ctrl.setLevel(v as ThinkingLevel)"
        >
          <ToggleGroupItem v-for="lv in ctrl.levels" :key="lv" :value="lv" :class="CHIP">
            {{ t('common.thinking.' + lv) }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div :class="FIELD">
        <div class="flex items-center justify-between gap-2">
          <Label>{{ t('projects.llm.mcp') }}</Label>
          <Button
            v-if="ctrl.isMcpCustomized.value"
            variant="link"
            size="xs"
            class="h-auto px-0"
            @click="ctrl.resetMcp"
          >
            {{ t('projects.llm.mcpReset') }}
          </Button>
        </div>
        <p class="text-xs text-dim">
          {{ ctrl.isMcpCustomized.value ? t('projects.llm.mcpCustom') : t('projects.llm.mcpAll') }}
        </p>
        <div
          v-if="!ctrl.mcpEnabledServers.value.length"
          class="px-3.5 py-8 text-center text-sm text-dim"
        >
          {{ t('projects.llm.mcpNone') }}
        </div>
        <div v-else class="max-h-49 divide-y overflow-y-auto rounded-md border px-2.5">
          <!-- Cả hàng là vùng bấm bật/tắt; Switch chỉ hiển thị trạng thái (pointer-events-none)
               để một cú bấm không lật hai lần. -->
          <div
            v-for="m in ctrl.mcpEnabledServers.value"
            :key="m.id"
            class="flex cursor-pointer items-center gap-2 py-2 text-sm"
            @click="ctrl.toggleMcp(m.id)"
          >
            <span
              class="size-2 flex-none rounded-full"
              :class="m.connectionStatus === 'connected' ? 'bg-success' : 'bg-faint'"
            />
            <span class="text-foreground">{{ m.name }}</span>
            <span class="ml-auto text-xs text-faint">{{ m.connectionStatus ?? 'untested' }}</span>
            <Switch
              :checked="ctrl.isMcpActive(m.id)"
              tabindex="-1"
              aria-hidden="true"
              class="pointer-events-none"
            />
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <Button
        v-if="ctrl.hasCustomDefaults.value"
        class="mr-auto"
        :disabled="ctrl.saving.value"
        variant="danger"
        @click="onReset"
      >
        {{ t('projects.llm.reset') }}
      </Button>
      <Button :disabled="ctrl.saving.value" variant="outline" @click="emit('cancel')">
        {{ t('common.cancel') }}
      </Button>
      <Button :disabled="ctrl.saving.value" variant="default" @click="onSave">
        {{ ctrl.saving.value ? t('projects.llm.saving') : t('projects.llm.save') }}
      </Button>
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
import type { ThinkingLevel } from '~/composables/useSessionsData'
import Button from '~/components/ui/button/Button.vue'
import Label from '~/components/ui/label/Label.vue'
import Switch from '~/components/ui/switch/Switch.vue'
import ToggleGroup from '~/components/ui/toggle-group/ToggleGroup.vue'
import ToggleGroupItem from '~/components/ui/toggle-group/ToggleGroupItem.vue'

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

const FIELD = 'flex flex-col gap-2'
// Chip chọn một (provider / mức suy luận): viền trung tính, đang chọn = accent-tint.
const CHIP =
  'h-ctrl-xs rounded-sm border bg-muted px-2.5 text-xs font-medium text-muted-foreground data-[state=on]:border-selected-border data-[state=on]:bg-selected data-[state=on]:text-primary'

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
