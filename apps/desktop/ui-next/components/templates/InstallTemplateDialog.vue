<template>
  <LibraryEntityModal
    :open="open"
    :title="t('templates.installDialog.title')"
    :lock-scrim="installing"
    :width="480"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-4">
      <div v-if="!fixedTemplateId" class="flex flex-col gap-1.5">
        <Label>{{ t('templates.installDialog.template') }}</Label>
        <AppSelect
          v-model="templateId"
          :options="templateOptions"
          :placeholder="t('templates.installDialog.pickTemplate')"
          width="100%"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <Label>{{ t('templates.installDialog.target') }}</Label>
        <AppSelect
          v-model="projectId"
          :options="projectOptions"
          :placeholder="t('templates.installDialog.pickTarget')"
          width="100%"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <Label>{{ t('templates.installDialog.conflict') }}</Label>
        <AppSelect v-model="conflictPolicy" :options="conflictOptions" width="100%" />
      </div>

      <div class="text-xs text-dim">{{ t('templates.installDialog.hint') }}</div>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('close')">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canInstall || installing" variant="default" @click="onInstall">
        {{ t('templates.installDialog.confirm') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Install-template dialog — write a template bundle into a target project's
// project tier, rendered inside LibraryEntityModal. `fixedTemplateId` pins the template (Install
// launched from a template's detail pane) and hides its picker.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useTemplatesStore } from '~/stores/templates'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  open: boolean
  projects: { id: string; name: string }[]
  fixedTemplateId?: string
}>()

const emit = defineEmits<{
  close: []
  installed: [{ installed: number; skipped: number }]
}>()

const { t } = useI18n()
const store = useTemplatesStore()

const templateId = ref('')
const projectId = ref('')
// String-typed for the AppSelect v-model (defineModel<string>); narrowed to the
// 'skip' | 'overwrite' union when handed to the store.
const conflictPolicy = ref('skip')
const installing = ref(false)

const templateOptions = computed<AppSelectOption[]>(() =>
  store.templates.map((tpl) => ({ value: tpl.id, label: tpl.name })),
)
const projectOptions = computed<AppSelectOption[]>(() =>
  props.projects.map((p) => ({ value: p.id, label: p.name })),
)
const conflictOptions = computed<AppSelectOption[]>(() => [
  { value: 'skip', label: t('templates.installDialog.conflictSkip') },
  { value: 'overwrite', label: t('templates.installDialog.conflictOverwrite') },
])

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    templateId.value = props.fixedTemplateId ?? ''
    projectId.value = props.projects[0]?.id ?? ''
    conflictPolicy.value = 'skip'
    installing.value = false
  },
  { immediate: true },
)

const resolvedTemplateId = computed(() => props.fixedTemplateId ?? templateId.value)
const canInstall = computed(() => !!resolvedTemplateId.value && !!projectId.value)

const onInstall = async () => {
  if (!canInstall.value || installing.value) return
  installing.value = true
  try {
    const result = await store.install({
      templateId: resolvedTemplateId.value,
      targetProjectId: projectId.value,
      conflictPolicy: conflictPolicy.value === 'overwrite' ? 'overwrite' : 'skip',
    })
    emit('installed', { installed: result.installed.length, skipped: result.skipped.length })
    emit('close')
  } finally {
    installing.value = false
  }
}
</script>
