<template>
  <EditorShell
    :title="project ? 'Edit Project' : 'New Project'"
    :dirty="dirty"
    :can-save="canSave && !busy"
    :save-label="saveLabel"
    @save="onSave"
    @cancel="emit('cancel')"
  >
    <Field v-if="!project" label="Source" class="mb-5">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          v-for="m in importOptions"
          :key="m.id"
          class="text-left rounded p-3 transition"
          :style="{
            background: importMode === m.id ? t.bgActive : t.bgInput,
            border: `1px solid ${importMode === m.id ? t.borderFocus : t.border}`,
          }"
          :disabled="busy"
          @click="importMode = m.id"
        >
          <div class="flex items-center gap-2 mb-1">
            <component :is="m.icon" :size="13" :style="{ color: t.text }" />
            <div class="text-[12px] font-medium" :style="{ color: t.text }">
              {{ m.label }}
            </div>
          </div>
          <div class="text-[10px]" :style="{ color: t.textDim }">
            {{ m.hint }}
          </div>
        </button>
      </div>
    </Field>

    <div class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Project name" class="sm:col-span-2">
          <input
            v-model="draft.name"
            placeholder="e.g. payment-service"
            class="w-full rounded px-2 py-1.5 text-xs"
            :style="inputStyle"
            :disabled="busy"
          />
        </Field>
        <Field label="Language">
          <input
            v-model="draft.language"
            placeholder="Python"
            class="w-full rounded px-2 py-1.5 text-xs"
            :style="inputStyle"
            :disabled="busy"
          />
        </Field>
      </div>

      <Field :label="importMode === 'clone' ? 'Clone destination' : 'Local path'">
        <div class="flex gap-1">
          <input
            v-model="draft.path"
            placeholder="~/code/my-project"
            class="flex-1 rounded px-2 py-1.5 text-xs font-mono"
            :style="inputStyle"
            :disabled="busy"
            @blur="onPathBlur"
          />
          <button
            class="px-3 py-1.5 text-xs rounded transition inline-flex items-center gap-1.5 disabled:opacity-50"
            :style="{ color: t.text, border: `1px solid ${t.borderStrong}` }"
            :disabled="busy || !canBrowse"
            :title="canBrowse ? 'Pick folder' : 'Native dialog unavailable (browser dev)'"
            @click="onBrowse"
          >
            <FolderOpen :size="11" />
            Browse
          </button>
        </div>
        <div class="text-[10px] mt-1" :style="{ color: t.textDim }">
          {{
            importMode === 'clone'
              ? 'New folder will be created here'
              : 'Agents will read and write files in this location'
          }}
        </div>
      </Field>

      <div v-if="importMode === 'clone' || project" class="grid grid-cols-3 gap-3">
        <Field label="Git remote" class="col-span-2">
          <input
            v-model="draft.gitRemote"
            placeholder="git@github.com:org/repo.git"
            class="w-full rounded px-2 py-1.5 text-xs font-mono"
            :style="inputStyle"
            :disabled="busy"
          />
        </Field>
        <Field label="Branch">
          <input
            v-model="draft.gitBranch"
            placeholder="main"
            class="w-full rounded px-2 py-1.5 text-xs font-mono"
            :style="inputStyle"
            :disabled="busy || importMode === 'clone'"
          />
        </Field>
      </div>

      <Field label="Description">
        <textarea
          v-model="draft.description"
          :rows="3"
          placeholder="What does this project do?"
          class="w-full rounded px-2 py-1.5 text-[12px] leading-relaxed resize-none"
          :style="inputStyle"
          :disabled="busy"
        />
      </Field>

      <div
        v-if="busy || error"
        class="rounded p-3 text-[11px]"
        :style="{
          background: t.bgElevated,
          border: `1px solid ${error ? t.danger : t.border}`,
          color: error ? t.danger : t.textMuted,
        }"
      >
        <div v-if="busy" class="flex items-center gap-2">
          <span
            class="inline-block w-2 h-2 rounded-full animate-pulse"
            :style="{ background: t.accent }"
          />
          {{ busyLabel }}
        </div>
        <div v-if="error" class="font-mono leading-relaxed">{{ error }}</div>
        <pre
          v-if="busy && lastProgressLine"
          class="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap font-mono text-[10px]"
          :style="{ color: t.textDim }"
          >{{ lastProgressLine }}</pre
        >
      </div>
    </div>
  </EditorShell>
</template>

<script setup lang="ts">
import { FolderOpen, GitFork } from 'lucide-vue-next'
import type { Project } from '~/types'
import type { ProjectEditorDraft, ProjectEditorSavePayload } from './types'

type DraftFields = ProjectEditorDraft

const props = defineProps<{
  project: Project | null
  busy?: boolean
  busyLabel?: string
  lastProgressLine?: string
  error?: string
}>()

const emit = defineEmits<{
  save: [payload: ProjectEditorSavePayload]
  cancel: []
}>()

const { t } = useTheme()
const sidecar = useSidecar()

const makeBlankDraft = (): DraftFields => ({
  name: '',
  path: '~/code/',
  description: '',
  gitRemote: '',
  gitBranch: 'main',
  language: '',
})

const projectToDraft = (p: Project): DraftFields => ({
  name: p.name,
  path: p.path,
  description: p.description,
  gitRemote: p.gitRemote,
  gitBranch: p.gitBranch,
  language: p.language,
})

const draft = ref<DraftFields>(props.project ? projectToDraft(props.project) : makeBlankDraft())
const original = ref<DraftFields>(props.project ? projectToDraft(props.project) : makeBlankDraft())
const importMode = ref<'existing' | 'clone'>('existing')

const importOptions = [
  {
    id: 'existing' as const,
    label: 'Existing folder',
    icon: FolderOpen,
    hint: 'Link a folder already on your machine',
  },
  {
    id: 'clone' as const,
    label: 'Clone from Git',
    icon: GitFork,
    hint: 'Clone a repository into a new folder',
  },
]

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const canSave = computed(() => {
  if (!draft.value.name || !draft.value.path) return false
  if (!props.project && importMode.value === 'clone' && !draft.value.gitRemote) return false
  return true
})
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(original.value))
const busy = computed(() => props.busy ?? false)
const canBrowse = computed(() => sidecar.available)

const saveLabel = computed(() => {
  if (props.project) return 'Save changes'
  if (importMode.value === 'clone') return 'Clone repository'
  return 'Add project'
})

interface InspectResult {
  name: string
  description: string
  language: string
  gitRemote: string
  gitBranch: string
  path: string
}

// Pre-fill empty fields from sidecar inspection. We never overwrite values the
// user already typed — typing wins over auto-detect.
const applyInspect = (info: InspectResult) => {
  if (!draft.value.name) draft.value.name = info.name
  if (!draft.value.description) draft.value.description = info.description
  if (!draft.value.language) draft.value.language = info.language
  if (!draft.value.gitRemote) draft.value.gitRemote = info.gitRemote
  if (!draft.value.gitBranch || draft.value.gitBranch === 'main') {
    if (info.gitBranch) draft.value.gitBranch = info.gitBranch
  }
}

const inspecting = ref(false)
const inspectPath = async (path: string) => {
  if (!sidecar.available || !path) return
  inspecting.value = true
  try {
    const info = await sidecar.request<InspectResult>('projects.inspect', { path })
    applyInspect(info)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[ProjectEditor] inspect failed', err)
  } finally {
    inspecting.value = false
  }
}

// Inspect when user pastes/types a path manually, but only for the existing-
// folder + create mode (where prefilling helps) and only if the user has not
// yet entered a name (otherwise we would clobber their typing).
const onPathBlur = async () => {
  if (props.project) return
  if (importMode.value !== 'existing') return
  if (!draft.value.path) return
  if (draft.value.name) return
  await inspectPath(draft.value.path)
}

const onBrowse = async () => {
  if (!canBrowse.value) return
  try {
    const picked = await pickFolder({
      title: importMode.value === 'clone' ? 'Pick clone parent folder' : 'Pick project folder',
    })
    if (!picked) return
    draft.value.path = picked
    // Inspect is only meaningful for "existing folder" mode — for clone the
    // destination doesn't exist yet.
    if (importMode.value === 'existing' && !props.project) {
      await inspectPath(picked)
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[ProjectEditor] folder picker failed', err)
  }
}

const onSave = () => {
  if (!canSave.value || busy.value) return
  if (props.project) {
    emit('save', {
      kind: 'update',
      project: { ...props.project, ...draft.value },
    })
    return
  }
  if (importMode.value === 'clone') {
    emit('save', { kind: 'clone', data: { ...draft.value } })
  } else {
    emit('save', { kind: 'link', data: { ...draft.value } })
  }
}
</script>
