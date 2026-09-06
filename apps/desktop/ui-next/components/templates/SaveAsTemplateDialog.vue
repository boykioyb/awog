<template>
  <LibraryEntityModal
    :open="open"
    :title="t('templates.saveDialog.title')"
    :lock-scrim="saving"
    :width="520"
    @close="emit('close')"
  >
    <div class="tpd">
      <div class="tpd-field">
        <label class="tpd-label">{{ t('templates.saveDialog.sourceProject') }}</label>
        <AppSelect
          v-model="pickedProjectId"
          :options="projectOptions"
          :placeholder="t('templates.saveDialog.pickSource')"
          width="100%"
        />
      </div>

      <div class="tpd-field">
        <label class="tpd-label">{{ t('templates.saveDialog.name') }}</label>
        <input v-model="name" class="tpd-input" :placeholder="t('templates.saveDialog.namePh')" />
      </div>

      <div class="tpd-field">
        <label class="tpd-label">{{ t('templates.saveDialog.description') }}</label>
        <textarea
          v-model="description"
          class="tpd-input tpd-ta"
          rows="2"
          :placeholder="t('templates.saveDialog.descPh')"
        />
      </div>

      <div class="tpd-field">
        <label class="tpd-label">{{ t('templates.saveDialog.include') }}</label>
        <div class="tpd-kinds">
          <label
            v-for="k in KIND_ORDER"
            :key="k"
            class="tpd-kind"
            :class="{ on: includedKinds.has(k) }"
          >
            <input type="checkbox" :checked="includedKinds.has(k)" @change="toggleKind(k)" />
            <span class="tpd-kind-label">{{ t('templates.kind.' + k) }}</span>
            <span class="chip tpd-count">{{ countByKind[k] }}</span>
          </label>
        </div>
        <div class="tpd-hint">{{ t('templates.saveDialog.hint') }}</div>
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="btn pri" :disabled="!canSave || saving" @click="onSave">
        {{ t('templates.saveDialog.confirm', { count: selectedEntities.length }) }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Save-as-template dialog — export a source project's project-tier entities into
// a new template bundle. Port of the old UI SaveAsTemplateDialog, rendered in
// prototype CSS inside LibraryEntityModal. Project-tier entities are resolved via
// the store's resolveProjectEntities (entity-list RPCs) so this component never
// imports the sibling entity stores.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import {
  KIND_ORDER,
  useTemplatesStore,
  type ConfigKind,
  type TemplateEntitySpec,
} from '~/stores/templates'

const props = defineProps<{
  open: boolean
  projects: { id: string; name: string }[]
}>()
const emit = defineEmits<{ close: []; saved: [{ name: string; count: number }] }>()

const { t } = useI18n()
const store = useTemplatesStore()

const name = ref('')
const description = ref('')
const includedKinds = ref<Set<ConfigKind>>(new Set(KIND_ORDER))
const pickedProjectId = ref('')
const saving = ref(false)
const projectEntities = ref<TemplateEntitySpec[]>([])

const projectOptions = computed<AppSelectOption[]>(() =>
  props.projects.map((p) => ({ value: p.id, label: p.name })),
)

// Re-seed the form + reload the source project's entities each time the dialog
// opens or the picked project changes.
watch(
  () => [props.open, pickedProjectId.value] as const,
  async ([isOpen]) => {
    if (!isOpen) return
    if (!pickedProjectId.value) {
      pickedProjectId.value = props.projects[0]?.id ?? ''
    }
    projectEntities.value = pickedProjectId.value
      ? await store.resolveProjectEntities(pickedProjectId.value)
      : []
  },
  { immediate: true },
)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      name.value = ''
      description.value = ''
      includedKinds.value = new Set(KIND_ORDER)
      saving.value = false
    }
  },
)

const countByKind = computed<Record<ConfigKind, number>>(() => {
  const counts: Record<ConfigKind, number> = { agent: 0, skill: 0, hook: 0, rule: 0, command: 0 }
  for (const e of projectEntities.value) counts[e.kind] += 1
  return counts
})

const selectedEntities = computed<TemplateEntitySpec[]>(() =>
  projectEntities.value.filter((e) => includedKinds.value.has(e.kind)),
)

const toggleKind = (k: ConfigKind) => {
  const next = new Set(includedKinds.value)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  includedKinds.value = next
}

const canSave = computed(
  () => !!name.value.trim() && !!pickedProjectId.value && selectedEntities.value.length > 0,
)

const onSave = async () => {
  if (!canSave.value || saving.value) return
  saving.value = true
  try {
    await store.create({
      name: name.value.trim(),
      description: description.value.trim(),
      sourceProjectId: pickedProjectId.value,
      entities: selectedEntities.value,
    })
    emit('saved', { name: name.value.trim(), count: selectedEntities.value.length })
    emit('close')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.tpd {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.tpd-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tpd-label {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 550;
  color: var(--text);
}
.tpd-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-family: var(--sans);
  outline: none;
}
.tpd-input:focus {
  border-color: var(--accent);
}
.tpd-ta {
  resize: vertical;
  min-height: 3rem;
  line-height: 1.55;
}
.tpd-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.tpd-kinds {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tpd-kind {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background 0.12s ease;
}
.tpd-kind:hover {
  background: var(--bgHover);
}
.tpd-kind.on {
  background: var(--bgActive);
}
.tpd-kind input {
  accent-color: var(--accent);
}
.tpd-kind-label {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  color: var(--text);
}
.tpd-count {
  margin-left: auto;
}
</style>
