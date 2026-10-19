<template>
  <LibraryEntityModal
    :open="open"
    :title="t('templates.saveDialog.title')"
    :lock-scrim="saving"
    :width="520"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <Label>{{ t('templates.saveDialog.sourceProject') }}</Label>
        <AppSelect
          v-model="pickedProjectId"
          :options="projectOptions"
          :placeholder="t('templates.saveDialog.pickSource')"
          width="100%"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <Label>{{ t('templates.saveDialog.name') }}</Label>
        <Input v-model="name" :placeholder="t('templates.saveDialog.namePh')" />
      </div>

      <div class="flex flex-col gap-1.5">
        <Label>{{ t('templates.saveDialog.description') }}</Label>
        <Textarea
          v-model="description"
          class="min-h-12 resize-y"
          rows="2"
          :placeholder="t('templates.saveDialog.descPh')"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <Label>{{ t('templates.saveDialog.include') }}</Label>
        <div class="flex flex-col gap-0.5">
          <label
            v-for="k in KIND_ORDER"
            :key="k"
            class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors"
            :class="includedKinds.has(k) ? 'bg-selected' : 'hover:bg-accent'"
          >
            <Checkbox :model-value="includedKinds.has(k)" @update:model-value="toggleKind(k)" />
            <span class="text-sm font-medium text-foreground">{{ t('templates.kind.' + k) }}</span>
            <Badge variant="outline" class="ml-auto rounded-sm tabular-nums text-muted-foreground">
              {{ countByKind[k] }}
            </Badge>
          </label>
        </div>
        <div class="text-xs text-dim">{{ t('templates.saveDialog.hint') }}</div>
      </div>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('close')">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canSave || saving" variant="default" @click="onSave">
        {{ t('templates.saveDialog.confirm', { count: selectedEntities.length }) }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Save-as-template dialog — export a source project's project-tier entities into
// a new template bundle, rendered inside LibraryEntityModal. Project-tier entities are resolved via
// the store's resolveProjectEntities (entity-list RPCs) so this component never
// imports the sibling entity stores.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
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
