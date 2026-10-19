<template>
  <div>
    <SettingsPaneHeader :title="t('settings.memory.heading')" />

    <SettingsField
      :name="t('settings.memory.enabled.name')"
      :desc="t('settings.memory.enabled.desc')"
    >
      <SettingsTog v-model="memoryEnabled" />
    </SettingsField>

    <SettingsField
      :name="t('settings.memory.autoWrite.name')"
      :desc="t('settings.memory.autoWrite.desc')"
    >
      <SettingsTog v-model="autoWrite" />
    </SettingsField>

    <SettingsField
      :name="t('settings.memory.budget.name')"
      :desc="t('settings.memory.budget.desc')"
    >
      <SettingsNumber v-model="budget" :min="500" :max="40000" :step="500" />
    </SettingsField>

    <SettingsField :name="t('settings.memory.cost.name')" :desc="t('settings.memory.cost.desc')">
      <Badge variant="outline" class="text-muted-foreground">
        {{ t('settings.memory.cost.value', { n: memory.enabledCount, chars: chars }) }}
      </Badge>
    </SettingsField>

    <div class="mt-4.5 mb-1.5 flex items-center justify-between">
      <div data-set-label class="text-xs font-medium text-muted-foreground">
        {{ t('settings.memory.list.heading') }}
      </div>
      <div class="flex gap-1.5">
        <Button variant="outline" size="sm" @click="startCreate">
          <Icon name="plus" class="size-3.5" />
          {{ t('settings.memory.list.add') }}
        </Button>
        <Button v-if="memory.facts.length > 0" variant="danger" size="sm" @click="onClearAll">
          <Icon name="trash" class="size-3.5" />
          {{ t('settings.memory.list.clear') }}
        </Button>
      </div>
    </div>

    <div v-if="memory.facts.length === 0" class="px-0.5 py-2.5 text-faint">
      {{ t('settings.memory.list.empty') }}
    </div>

    <template v-for="type in MEMORY_TYPES" :key="type">
      <div v-if="memory.byType[type].length > 0" class="mb-3">
        <div class="mt-2 mb-1 text-sm text-faint">
          {{ t('settings.memory.type.' + type) }}
        </div>
        <div
          v-for="fact in memory.byType[type]"
          :key="factKey(fact)"
          class="flex items-center gap-2 border-t py-1.5"
        >
          <SettingsTog
            :model-value="fact.enabled"
            @update:model-value="() => memory.toggleFact(fact)"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              {{ fact.name }}
              <Badge
                v-if="fact.source === 'project'"
                variant="outline"
                class="border-primary/45 bg-primary/10 text-primary"
              >
                {{ t('settings.memory.tier.project') }}
              </Badge>
            </div>
            <div class="truncate text-dim">{{ fact.description }}</div>
          </div>
          <Button
            variant="ghost"
            size="iconSm"
            class="shrink-0 text-dim"
            :title="t('common.edit')"
            :aria-label="t('common.edit')"
            @click="startEdit(fact)"
          >
            <Icon name="edit" />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            class="shrink-0 text-dim hover:bg-destructive/10 hover:text-destructive"
            :title="t('common.delete')"
            :aria-label="t('common.delete')"
            @click="onDelete(fact)"
          >
            <Icon name="trash" />
          </Button>
        </div>
      </div>
    </template>

    <!-- inline editor (create + edit share it) -->
    <div v-if="draft" class="mt-3 flex flex-col gap-2 rounded-md border border-input p-2.5">
      <div class="flex gap-2">
        <label class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-xs font-medium text-muted-foreground">
            {{ t('settings.memory.editor.name') }}
          </span>
          <Input v-model="draft.name" class="flex-1" />
        </label>
        <label class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-xs font-medium text-muted-foreground">
            {{ t('settings.memory.editor.type') }}
          </span>
          <AppSelect v-model="draft.type" :options="typeOptions" />
        </label>
      </div>
      <label class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-xs font-medium text-muted-foreground">
          {{ t('settings.memory.editor.description') }}
        </span>
        <Input
          v-model="draft.description"
          :placeholder="t('settings.memory.editor.descriptionHint')"
          class="flex-1"
        />
      </label>
      <label class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-xs font-medium text-muted-foreground">
          {{ t('settings.memory.editor.body') }}
        </span>
        <Textarea v-model="draft.body" class="min-h-24 resize-y" />
      </label>
      <div class="flex justify-end gap-1.5">
        <Button variant="outline" size="sm" @click="draft = null">{{ t('common.cancel') }}</Button>
        <Button :disabled="!canSave" variant="default" size="sm" @click="onSave">
          {{ t('common.save') }}
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Settings → Memory (ADR 0073 part B): the switches plus the full list of what the
// agent remembers, editable and deletable. The list is the point of the feature —
// memory the user cannot inspect is memory they cannot trust.
import { computed, onMounted, ref } from 'vue'
import AppSelect from '~/components/common/AppSelect.vue'
import { useSettingsStore } from '~/stores/settings'
import {
  MEMORY_TYPES,
  memoryKey,
  useMemoryStore,
  type MemoryFact,
  type MemoryType,
} from '~/stores/memory'
import { useConfirm } from '~/composables/useConfirm'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const { t } = useI18n()
const settings = useSettingsStore()
const memory = useMemoryStore()
const { confirm } = useConfirm()

const memoryEnabled = computed({
  get: () => settings.context.memoryEnabled,
  set: (v: boolean) => settings.updateContext({ memoryEnabled: v }),
})
const autoWrite = computed({
  get: () => settings.context.memoryAutoWrite,
  set: (v: boolean) => settings.updateContext({ memoryAutoWrite: v }),
})
const budget = computed({
  get: () => settings.context.memoryBudgetChars,
  set: (v: number) => settings.updateContext({ memoryBudgetChars: v }),
})

const chars = computed(() =>
  memory.indexChars >= 1000
    ? `${(memory.indexChars / 1000).toFixed(1)}k`
    : String(memory.indexChars),
)

const typeOptions = computed(() =>
  MEMORY_TYPES.map((type) => ({ value: type, label: t('settings.memory.type.' + type) })),
)

type Draft = {
  id?: string
  source: 'global' | 'project'
  projectId?: string
  name: string
  description: string
  body: string
  type: MemoryType
}
const draft = ref<Draft | null>(null)
const canSave = computed(
  () => !!draft.value && draft.value.name.trim() !== '' && draft.value.description.trim() !== '',
)

const factKey = (fact: MemoryFact): string => memoryKey(fact)

function startCreate(): void {
  draft.value = { source: 'global', name: '', description: '', body: '', type: 'project' }
}

function startEdit(fact: MemoryFact): void {
  draft.value = {
    id: fact.id,
    source: fact.source,
    ...(fact.projectId ? { projectId: fact.projectId } : {}),
    name: fact.name,
    description: fact.description,
    body: fact.body,
    type: fact.type,
  }
}

async function onSave(): Promise<void> {
  const d = draft.value
  if (!d) return
  await memory.saveFact({
    ...(d.id ? { id: d.id } : {}),
    source: d.source,
    ...(d.projectId ? { projectId: d.projectId } : {}),
    name: d.name.trim(),
    description: d.description.trim(),
    body: d.body,
    type: d.type,
  })
  draft.value = null
}

async function onDelete(fact: MemoryFact): Promise<void> {
  const ok = await confirm({
    title: t('settings.memory.delete.title'),
    description: t('settings.memory.delete.body', { name: fact.name }),
    confirmLabel: t('common.delete'),
  })
  if (ok) await memory.deleteFact(fact)
}

async function onClearAll(): Promise<void> {
  const ok = await confirm({
    title: t('settings.memory.clear.title'),
    description: t('settings.memory.clear.body', { n: memory.facts.length }),
    confirmLabel: t('settings.memory.clear.confirm'),
  })
  if (ok) await memory.clearTier('global')
}

onMounted(() => {
  if (!memory.loaded) void memory.loadMemory()
})
</script>
