<template>
  <BaseModal
    :open="open"
    :title="tr('templates.save_dialog.title')"
    size="md"
    @close="emit('close')"
  >
    <div class="p-4 space-y-4">
      <Field v-if="!fixedProjectId" :label="tr('templates.save_dialog.source_project')">
        <AppSelect v-model="pickedProjectId">
          <option value="" disabled>{{ tr('templates.save_dialog.pick_source') }}</option>
          <option v-for="p in ws.projects" :key="p.id" :value="p.id">
            {{ p.name }} ({{ p.path }})
          </option>
        </AppSelect>
      </Field>

      <Field :label="tr('templates.save_dialog.name')">
        <input
          v-model="name"
          :placeholder="tr('templates.save_dialog.name_placeholder')"
          class="w-full rounded px-2 py-1.5 text-[1em]"
          :style="inputStyle"
        />
      </Field>

      <Field :label="tr('templates.save_dialog.description')">
        <textarea
          v-model="description"
          :rows="2"
          :placeholder="tr('templates.save_dialog.description_placeholder')"
          class="w-full rounded px-2 py-1.5 text-[1em] resize-y min-h-[3rem]"
          :style="inputStyle"
        />
      </Field>

      <Field :label="tr('templates.save_dialog.include')">
        <div class="space-y-0.5">
          <label
            v-for="k in KIND_ORDER"
            :key="k"
            class="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition"
            :style="{ background: includedKinds.has(k) ? t.bgActive : 'transparent' }"
          >
            <input
              type="checkbox"
              :checked="includedKinds.has(k)"
              :style="{ accentColor: t.accent }"
              @change="toggleKind(k)"
            />
            <span class="text-[1em]" :style="{ color: t.text }">{{ tr(`import.kind.${k}`) }}</span>
            <span
              class="text-[12px] font-mono leading-none px-1.5 py-0.5 rounded ml-auto"
              :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
            >
              {{ countByKind[k] }}
            </span>
          </label>
        </div>
        <div class="text-[1em] mt-1.5" :style="{ color: t.textDim }">
          {{ tr('templates.save_dialog.hint') }}
        </div>
      </Field>
    </div>

    <template #footer>
      <AppButton variant="ghost" @click="emit('close')">
        {{ tr('common.cancel') }}
      </AppButton>
      <AppButton :disabled="!canSave || saving" @click="onSave">
        {{ tr('templates.save_dialog.confirm', { count: selectedEntities.length }) }}
      </AppButton>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { ConfigKind } from '~/types'
import { KIND_ORDER } from '~/composables/useConfigImport'
import { useTemplatesStore, type TemplateEntitySpec } from '~/stores/templates'

// `fixedProjectId` pins the source project (Projects-page "Save as template").
// When absent (Templates-page "New from project…") the dialog shows a project
// picker.
const props = defineProps<{ open: boolean; fixedProjectId?: string }>()
const emit = defineEmits<{ close: []; saved: [{ name: string; count: number }] }>()

const { t } = useTheme()
const { t: tr } = useI18n()
const ws = useWorkspaceStore()
const templatesStore = useTemplatesStore()

const name = ref('')
const description = ref('')
const includedKinds = ref<Set<ConfigKind>>(new Set(KIND_ORDER))
const pickedProjectId = ref('')
const saving = ref(false)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      name.value = ''
      description.value = ''
      includedKinds.value = new Set(KIND_ORDER)
      pickedProjectId.value = props.fixedProjectId ?? ''
      // Entity stores hydrate lazily on their own pages; pull them so the
      // project-tier counts + selection are accurate when exporting from here.
      void Promise.all([
        ws.hydrateAgentsFromSidecar(),
        ws.hydrateSkillsFromSidecar(),
        ws.hydrateHooksFromSidecar(),
        ws.hydrateRulesFromSidecar(),
        ws.hydrateCommandsFromSidecar(),
      ])
    }
  },
  { immediate: true },
)

const sourceProjectId = computed(() => props.fixedProjectId ?? pickedProjectId.value)

// Every `project`-tier entity of the source project, gathered from the live
// stores. Templates bundle the per-project config the user has authored
// (ADR 0036 D-4).
const projectEntities = computed<TemplateEntitySpec[]>(() => {
  const pid = sourceProjectId.value
  if (!pid) return []
  const out: TemplateEntitySpec[] = []
  ws.agents
    .filter((a) => a.source === 'project' && a.projectId === pid)
    .forEach((a) => out.push({ kind: 'agent', id: a.id, source: 'project', projectId: pid }))
  ws.skills
    .filter((s) => s.source === 'project' && s.projectId === pid)
    .forEach((s) => out.push({ kind: 'skill', id: s.id, source: 'project', projectId: pid }))
  ws.hooks
    .filter((h) => h.source === 'project' && h.projectId === pid)
    .forEach((h) => out.push({ kind: 'hook', id: h.id, source: 'project', projectId: pid }))
  ws.rules
    .filter((r) => r.source === 'project' && r.projectId === pid)
    .forEach((r) => out.push({ kind: 'rule', id: r.id, source: 'project', projectId: pid }))
  ws.commands
    .filter((c) => c.source === 'project' && c.projectId === pid)
    .forEach((c) => out.push({ kind: 'command', id: c.id, source: 'project', projectId: pid }))
  return out
})

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

const inputStyle = computed<CSSProperties>(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const canSave = computed(
  () => !!name.value.trim() && !!sourceProjectId.value && selectedEntities.value.length > 0,
)

const onSave = async () => {
  if (!canSave.value) return
  saving.value = true
  try {
    await templatesStore.create({
      name: name.value.trim(),
      description: description.value.trim(),
      sourceProjectId: sourceProjectId.value,
      entities: selectedEntities.value,
    })
    emit('saved', { name: name.value.trim(), count: selectedEntities.value.length })
    emit('close')
  } finally {
    saving.value = false
  }
}
</script>
