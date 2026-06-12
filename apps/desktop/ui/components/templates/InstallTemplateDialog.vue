<template>
  <BaseModal
    :open="open"
    :title="tr('templates.install_dialog.title')"
    size="md"
    @close="emit('close')"
  >
    <div class="p-4 space-y-4">
      <Field v-if="!fixedTemplateId" :label="tr('templates.install_dialog.template')">
        <AppSelect v-model="templateId">
          <option value="" disabled>{{ tr('templates.install_dialog.pick_template') }}</option>
          <option v-for="tpl in templatesStore.templates" :key="tpl.id" :value="tpl.id">
            {{ tpl.name }}
          </option>
        </AppSelect>
      </Field>

      <Field v-if="!fixedProjectId" :label="tr('templates.install_dialog.target')">
        <AppSelect v-model="projectId">
          <option value="" disabled>{{ tr('templates.install_dialog.pick_target') }}</option>
          <option v-for="p in ws.projects" :key="p.id" :value="p.id">
            {{ p.name }} ({{ p.path }})
          </option>
        </AppSelect>
      </Field>

      <Field :label="tr('templates.install_dialog.conflict')">
        <AppSelect v-model="conflictPolicy">
          <option value="skip">{{ tr('templates.install_dialog.conflict_skip') }}</option>
          <option value="overwrite">{{ tr('templates.install_dialog.conflict_overwrite') }}</option>
        </AppSelect>
      </Field>

      <div class="text-[1em]" :style="{ color: t.textDim }">
        {{ tr('templates.install_dialog.hint') }}
      </div>
    </div>

    <template #footer>
      <button
        class="px-3 py-1.5 text-[1em] rounded transition"
        :style="{ color: t.textMuted, border: `1px solid ${t.border}` }"
        @click="emit('close')"
      >
        {{ tr('common.cancel') }}
      </button>
      <button
        class="px-3 py-1.5 text-[1em] rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
        :style="{ background: t.accent, color: t.accentText }"
        :disabled="!canInstall || installing"
        @click="onInstall"
      >
        {{ tr('templates.install_dialog.confirm') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { useTemplatesStore } from '~/stores/templates'

const props = defineProps<{
  open: boolean
  // When provided, that field is fixed and its picker is hidden.
  fixedTemplateId?: string
  fixedProjectId?: string
}>()

const emit = defineEmits<{
  close: []
  installed: [{ installed: number; skipped: number }]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const ws = useWorkspaceStore()
const templatesStore = useTemplatesStore()

const templateId = ref('')
const projectId = ref('')
const conflictPolicy = ref<'skip' | 'overwrite'>('skip')
const installing = ref(false)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      templateId.value = props.fixedTemplateId ?? ''
      projectId.value = props.fixedProjectId ?? ''
      conflictPolicy.value = 'skip'
    }
  },
  { immediate: true },
)

const resolvedTemplateId = computed(() => props.fixedTemplateId ?? templateId.value)
const resolvedProjectId = computed(() => props.fixedProjectId ?? projectId.value)

const canInstall = computed(() => !!resolvedTemplateId.value && !!resolvedProjectId.value)

const onInstall = async () => {
  if (!canInstall.value) return
  installing.value = true
  try {
    const result = await templatesStore.install({
      templateId: resolvedTemplateId.value,
      targetProjectId: resolvedProjectId.value,
      conflictPolicy: conflictPolicy.value,
    })
    emit('installed', { installed: result.installed.length, skipped: result.skipped.length })
    emit('close')
  } finally {
    installing.value = false
  }
}
</script>
