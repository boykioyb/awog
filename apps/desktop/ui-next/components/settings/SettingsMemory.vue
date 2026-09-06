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
      <span class="chip">
        {{ t('settings.memory.cost.value', { n: memory.enabledCount, chars: chars }) }}
      </span>
    </SettingsField>

    <div class="memhead">
      <div class="sech">{{ t('settings.memory.list.heading') }}</div>
      <div class="memhead-actions">
        <button class="btn sm" @click="startCreate">
          <Icon name="plus" :size="13" />
          {{ t('settings.memory.list.add') }}
        </button>
        <button v-if="memory.facts.length > 0" class="btn sm danger" @click="onClearAll">
          <Icon name="trash" :size="13" />
          {{ t('settings.memory.list.clear') }}
        </button>
      </div>
    </div>

    <div v-if="memory.facts.length === 0" class="memempty" :style="{ color: 'var(--textFaint)' }">
      {{ t('settings.memory.list.empty') }}
    </div>

    <template v-for="type in MEMORY_TYPES" :key="type">
      <div v-if="memory.byType[type].length > 0" class="memgroup">
        <div class="memgrouphead" :style="{ color: 'var(--textFaint)' }">
          {{ t('settings.memory.type.' + type) }}
        </div>
        <div v-for="fact in memory.byType[type]" :key="factKey(fact)" class="memrow">
          <SettingsTog
            :model-value="fact.enabled"
            @update:model-value="() => memory.toggleFact(fact)"
          />
          <div class="memtext">
            <div class="memname">
              {{ fact.name }}
              <span v-if="fact.source === 'project'" class="tag acc" style="padding: 1px 6px">
                {{ t('settings.memory.tier.project') }}
              </span>
            </div>
            <div class="memdesc" :style="{ color: 'var(--textDim)' }">{{ fact.description }}</div>
          </div>
          <button class="membtn" :title="t('common.edit')" @click="startEdit(fact)">
            <Icon name="edit" :size="13" />
          </button>
          <button class="membtn danger" :title="t('common.delete')" @click="onDelete(fact)">
            <Icon name="trash" :size="13" />
          </button>
        </div>
      </div>
    </template>

    <!-- inline editor (create + edit share it) -->
    <div v-if="draft" class="memeditor" :style="{ borderColor: 'var(--borderStrong)' }">
      <div class="memfields">
        <label class="memfield">
          <span class="sech">{{ t('settings.memory.editor.name') }}</span>
          <input v-model="draft.name" class="keyinp" />
        </label>
        <label class="memfield">
          <span class="sech">{{ t('settings.memory.editor.type') }}</span>
          <AppSelect v-model="draft.type" :options="typeOptions" />
        </label>
      </div>
      <label class="memfield">
        <span class="sech">{{ t('settings.memory.editor.description') }}</span>
        <input
          v-model="draft.description"
          class="keyinp"
          :placeholder="t('settings.memory.editor.descriptionHint')"
        />
      </label>
      <label class="memfield">
        <span class="sech">{{ t('settings.memory.editor.body') }}</span>
        <textarea v-model="draft.body" class="keyinp membody resize-y min-h-[6rem]" />
      </label>
      <div class="memeditor-actions">
        <button class="btn sm" @click="draft = null">{{ t('common.cancel') }}</button>
        <button class="btn sm pri" :disabled="!canSave" @click="onSave">
          {{ t('common.save') }}
        </button>
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

<style scoped>
.memhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 18px 0 6px;
}
.memhead-actions {
  display: flex;
  gap: 6px;
}
.memempty {
  padding: 10px 2px;
  font-size: 1em;
  line-height: 1.5;
}
.memgroup {
  margin-bottom: 12px;
}
.memgrouphead {
  font-size: 12px;
  line-height: 18px;
  margin: 8px 0 4px;
}
.memrow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px solid var(--border);
}
.memtext {
  flex: 1;
  min-width: 0;
}
.memname {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 1em;
}
.memdesc {
  font-size: 1em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.membtn {
  padding: 5px;
  border: 0;
  background: transparent;
  border-radius: var(--r-sm);
  color: var(--textDim);
  cursor: pointer;
}
.membtn:hover {
  background: var(--bgHover);
  color: var(--text);
}
.membtn.danger:hover {
  background: var(--dangerBg);
  color: var(--danger);
}
.memeditor {
  margin-top: 12px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.memfields {
  display: flex;
  gap: 8px;
}
.memfield {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.memeditor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.membody {
  line-height: 1.5;
}
</style>
