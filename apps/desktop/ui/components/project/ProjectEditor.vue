<template>
  <EditorShell
    :title="project ? 'Edit Project' : 'New Project'"
    :dirty="dirty"
    :can-save="canSave"
    :save-label="project ? 'Save changes' : 'Add project'"
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
          />
        </Field>
        <Field label="Language">
          <input
            v-model="draft.language"
            placeholder="Python"
            class="w-full rounded px-2 py-1.5 text-xs"
            :style="inputStyle"
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
          />
          <button
            class="px-3 py-1.5 text-xs rounded transition inline-flex items-center gap-1.5"
            :style="{ color: t.text, border: `1px solid ${t.borderStrong}` }"
            title="Browse..."
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
          />
        </Field>
        <Field label="Branch">
          <input
            v-model="draft.gitBranch"
            placeholder="main"
            class="w-full rounded px-2 py-1.5 text-xs font-mono"
            :style="inputStyle"
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
        />
      </Field>
    </div>
  </EditorShell>
</template>

<script setup lang="ts">
import { FolderOpen, GitFork } from 'lucide-vue-next'
import type { Project } from '~/types'

const props = defineProps<{
  project: Project | null
}>()

const emit = defineEmits<{
  save: [project: Project]
  cancel: []
}>()

const { t } = useTheme()

const makeBlankDraft = (): Project => ({
  id: '',
  name: '',
  path: '~/code/',
  description: '',
  gitRemote: '',
  gitBranch: 'main',
  language: '',
  createdAt: '',
})

const draft = ref<Project>(props.project ? { ...props.project } : makeBlankDraft())
const original = ref<Project>(props.project ? { ...props.project } : makeBlankDraft())
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

const canSave = computed(() => !!draft.value.name && !!draft.value.path)
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(original.value))

const onSave = () => {
  if (!canSave.value) return
  emit('save', { ...draft.value })
}
</script>
