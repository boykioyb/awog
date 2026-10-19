<template>
  <LibraryEntityModal
    :open="open"
    :title="project ? t('projects.editor.editTitle') : t('projects.editor.newTitle')"
    :lock-scrim="busy"
    :width="600"
    @close="emit('cancel')"
  >
    <!-- Thứ tự field đổi theo chế độ bằng flex `order` (cột flex-col):
         clone → git remote (1) · clone dest (2) · name+language (3) · description (5);
         existing/edit → name+language (1) · path (2) · git remote (4) · description (5). -->
    <div class="flex flex-col gap-4">
      <!-- Source (create only): link existing folder vs clone a git remote. -->
      <div v-if="!project" :class="FIELD" :style="{ order: 0 }">
        <Label>{{ t('projects.editor.source') }}</Label>
        <ToggleGroup
          type="single"
          :spacing="2"
          class="grid w-full grid-cols-2"
          :model-value="importMode"
          :disabled="busy"
          @update:model-value="(v) => v && (importMode = v as 'existing' | 'clone')"
        >
          <ToggleGroupItem
            v-for="m in importOptions"
            :key="m.id"
            :value="m.id"
            class="h-auto flex-col items-start gap-1 rounded-lg border bg-muted px-3 py-2.5 text-left whitespace-normal hover:bg-muted data-[state=on]:border-selected-border data-[state=on]:bg-selected"
          >
            <span class="flex items-center gap-2 text-sm font-medium text-foreground">
              <Icon :name="m.icon" class="size-3.5" />
              {{ m.label }}
            </span>
            <span class="text-xs font-normal text-dim">{{ m.hint }}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div class="grid grid-cols-3 gap-3" :style="{ order: nameOrder }">
        <div :class="[FIELD, 'col-span-2']">
          <Label>{{ t('projects.editor.name') }}</Label>
          <Input v-model="draft.name" :placeholder="t('projects.editor.namePh')" :disabled="busy" />
        </div>
        <div :class="FIELD">
          <Label>{{ t('projects.editor.language') }}</Label>
          <Input
            v-model="draft.language"
            :placeholder="t('projects.editor.languagePh')"
            :disabled="busy"
          />
        </div>
      </div>

      <div :class="FIELD" :style="{ order: 2 }">
        <Label>
          {{ isClone ? t('projects.editor.dest') : t('projects.editor.path') }}
        </Label>
        <div class="flex gap-1.5">
          <!-- mono-ok: đường dẫn thư mục -->
          <Input
            v-model="draft.path"
            :placeholder="t('projects.editor.pathPh')"
            :disabled="busy"
            class="flex-1 font-mono"
            @blur="onPathBlur"
          />
          <Button
            :disabled="busy || !canBrowse"
            :title="canBrowse ? t('projects.editor.browse') : t('projects.editor.browseUnavail')"
            variant="outline"
            @click="onBrowse"
          >
            <Icon name="folder" />
            {{ t('projects.editor.browse') }}
          </Button>
        </div>
        <div class="text-xs text-dim">
          {{ isClone ? t('projects.editor.destHint') : t('projects.editor.pathHint') }}
        </div>
      </div>

      <div v-if="isClone || project" class="grid grid-cols-3 gap-3" :style="{ order: gitOrder }">
        <div :class="[FIELD, 'col-span-2']">
          <Label>
            {{ t('projects.editor.gitRemote') }}
            <span v-if="detecting" class="ml-2 text-xs font-normal text-dim">
              {{ t('projects.editor.detecting') }}
            </span>
          </Label>
          <!-- mono-ok: URL git remote -->
          <Input
            v-model="draft.gitRemote"
            placeholder="git@github.com:org/repo.git"
            :disabled="busy"
            class="font-mono"
            @blur="onRemoteBlur"
          />
        </div>
        <div :class="FIELD">
          <Label>{{ t('projects.editor.branch') }}</Label>
          <!-- mono-ok: tên nhánh git -->
          <Input
            v-model="draft.gitBranch"
            placeholder="main"
            :disabled="busy || isClone"
            class="font-mono"
          />
        </div>
      </div>

      <div :class="FIELD" :style="{ order: 5 }">
        <div class="flex items-center justify-between gap-2">
          <Label>{{ t('projects.editor.description') }}</Label>
          <Button
            variant="outline"
            size="xs"
            class="text-dim hover:border-selected-border hover:text-primary"
            :disabled="busy || generating || !draft.name.trim()"
            :title="t('projects.editor.genDescHint')"
            @click="onGenerateDescription"
          >
            <Icon
              :name="generating ? 'refresh' : 'sparkles'"
              class="size-3"
              :class="{ 'animate-spin': generating }"
            />
            {{ t('projects.editor.genDesc') }}
          </Button>
        </div>
        <Textarea
          v-model="draft.description"
          class="min-h-16 resize-y"
          rows="3"
          :placeholder="t('projects.editor.descriptionPh')"
          :disabled="busy"
        />
        <div v-if="genError" class="text-xs text-destructive">{{ genError }}</div>
      </div>

      <div
        v-if="busy || error"
        class="rounded-md border px-3 py-2.5 text-sm"
        :class="error ? 'border-destructive text-destructive' : 'bg-muted text-muted-foreground'"
        :style="{ order: 6 }"
      >
        <div v-if="busy" class="flex items-center gap-2">
          <span class="size-2 animate-pulse rounded-full bg-primary" />
          {{ progress || (isClone ? t('projects.editor.cloning') : t('projects.editor.saving')) }}
        </div>
        <!-- mono-ok: thông báo lỗi git/fs nguyên văn -->
        <div v-if="error" class="font-mono">{{ error }}</div>
      </div>
    </div>

    <template #footer>
      <Button :disabled="busy" variant="outline" @click="emit('cancel')">
        {{ t('common.cancel') }}
      </Button>
      <Button :disabled="!canSave || busy" variant="default" @click="onSubmit">
        {{ saveLabel }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Project form editor — link an existing folder, clone a git remote, or edit an
// existing project. Dựng bằng component shadcn bên trong LibraryEntityModal. Path
// inspection (pre-fill empty fields) + the native folder picker are proxied from
// the page-controller. Emits a discriminated save payload.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import type { ProjectInspectResult, RemoteInspectResult } from '~/stores/projects'
import type { Project } from '~/types'
import type { ProjectEditorDraft, ProjectEditorSavePayload } from './types'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import Label from '~/components/ui/label/Label.vue'
import Textarea from '~/components/ui/textarea/Textarea.vue'
import ToggleGroup from '~/components/ui/toggle-group/ToggleGroup.vue'
import ToggleGroupItem from '~/components/ui/toggle-group/ToggleGroupItem.vue'

const props = defineProps<{
  open: boolean
  project: Project | null
  busy: boolean
  error: string
  progress: string
  canBrowse: boolean
  inspect: (path: string) => Promise<ProjectInspectResult | null>
  inspectRemote: (gitRemote: string) => Promise<RemoteInspectResult | null>
  generateDescription: (input: {
    name: string
    language?: string
    gitRemote?: string
    hint?: string
  }) => Promise<string | null>
  browse: (title: string) => Promise<string | null>
}>()

const emit = defineEmits<{ save: [payload: ProjectEditorSavePayload]; cancel: [] }>()

const { t } = useI18n()

const importMode = ref<'existing' | 'clone'>('existing')
const isClone = computed(() => !props.project && importMode.value === 'clone')

// Field ordering (flex `order` on the .pe column). Clone puts the git remote first
// (name/language/dest derive from it); existing/edit keeps name+language first.
const nameOrder = computed(() => (isClone.value ? 3 : 1))
const gitOrder = computed(() => (isClone.value ? 1 : 4))

// Remote-detection + AI-description state.
const detecting = ref(false)
const generating = ref(false)
const genError = ref('')

// Một ô form: nhãn + control + gợi ý xếp dọc.
const FIELD = 'flex flex-col gap-1.5'

const importOptions = [
  {
    id: 'existing' as const,
    label: t('projects.editor.existing'),
    icon: 'folder',
    hint: t('projects.editor.existingHint'),
  },
  {
    id: 'clone' as const,
    label: t('projects.editor.clone'),
    icon: 'fork',
    hint: t('projects.editor.cloneHint'),
  },
]

const makeBlank = (): ProjectEditorDraft => ({
  name: '',
  path: '~/code/',
  description: '',
  gitRemote: '',
  gitBranch: 'main',
  language: '',
})

const fromProject = (p: Project): ProjectEditorDraft => ({
  name: p.name,
  path: p.path,
  description: p.description,
  gitRemote: p.gitRemote,
  gitBranch: p.gitBranch,
  language: p.language,
})

const draft = ref<ProjectEditorDraft>(props.project ? fromProject(props.project) : makeBlank())

// Re-seed each time the modal opens or the target project changes.
watch(
  () => [props.open, props.project] as const,
  ([isOpen]) => {
    if (!isOpen) return
    draft.value = props.project ? fromProject(props.project) : makeBlank()
    importMode.value = 'existing'
    detecting.value = false
    generating.value = false
    genError.value = ''
  },
)

const canSave = computed(() => {
  if (!draft.value.name.trim() || !draft.value.path.trim()) return false
  if (isClone.value && !draft.value.gitRemote.trim()) return false
  return true
})

const saveLabel = computed(() => {
  if (props.project) return t('projects.editor.saveChanges')
  if (isClone.value) return t('projects.editor.cloneRepo')
  return t('projects.editor.addProject')
})

// Pre-fill empty fields from inspection. Never overwrite values the user typed.
const applyInspect = (info: ProjectInspectResult) => {
  if (!draft.value.name) draft.value.name = info.name
  if (!draft.value.description) draft.value.description = info.description
  if (!draft.value.language) draft.value.language = info.language
  if (!draft.value.gitRemote) draft.value.gitRemote = info.gitRemote
  if ((!draft.value.gitBranch || draft.value.gitBranch === 'main') && info.gitBranch)
    draft.value.gitBranch = info.gitBranch
}

// Inspect only when adding an existing folder and the user has not typed a name
// yet (otherwise we'd clobber their typing).
const onPathBlur = async () => {
  if (props.project || importMode.value !== 'existing') return
  if (!draft.value.path || draft.value.name) return
  const info = await props.inspect(draft.value.path)
  if (info) applyInspect(info)
}

const onBrowse = async () => {
  if (!props.canBrowse) return
  const picked = await props.browse(
    isClone.value ? t('projects.editor.pickParent') : t('projects.editor.pickFolder'),
  )
  if (!picked) return
  if (isClone.value) {
    // The picked folder is the PARENT; the clone lands in <parent>/<repo>. Append
    // the repo name (from the remote, else the typed project name) when known.
    const repo = repoNameFromRemote(draft.value.gitRemote) || draft.value.name.trim()
    draft.value.path = repo ? `${picked.replace(/\/$/, '')}/${repo}` : picked
    return
  }
  draft.value.path = picked
  if (!props.project) {
    const info = await props.inspect(picked)
    if (info) applyInspect(info)
  }
}

// Folder-safe repo name from a git remote URL (client-side, no network): last path
// segment sans a trailing `.git`. Powers the immediate name + clone-dest pre-fill.
const repoNameFromRemote = (remote: string): string => {
  const s = remote
    .trim()
    .replace(/\/$/, '')
    .replace(/\.git$/, '')
  return s.split(/[/:]/).filter(Boolean).pop() ?? ''
}

// On git-remote blur (clone mode, new project): derive name + clone destination
// from the URL immediately, then fetch repo metadata (language + description) via
// gh — filling only fields the user hasn't typed. Never clobbers user input.
const onRemoteBlur = async () => {
  if (props.project || !isClone.value) return
  const remote = draft.value.gitRemote.trim()
  if (!remote) return
  const repo = repoNameFromRemote(remote)
  if (repo && !draft.value.name) draft.value.name = repo
  if (repo && (!draft.value.path.trim() || draft.value.path.trim() === '~/code/')) {
    draft.value.path = `~/code/${repo}`
  }
  detecting.value = true
  try {
    const info = await props.inspectRemote(remote)
    if (!info) return
    if (!draft.value.name) draft.value.name = info.name
    if (info.language && !draft.value.language) draft.value.language = info.language
    if (info.description && !draft.value.description) draft.value.description = info.description
  } finally {
    detecting.value = false
  }
}

// AI-generate the description from the current name/language/remote (+ refine any
// existing text). Optional convenience — failure surfaces inline, never blocks.
const onGenerateDescription = async () => {
  if (props.busy || generating.value || !draft.value.name.trim()) return
  generating.value = true
  genError.value = ''
  try {
    const desc = await props.generateDescription({
      name: draft.value.name.trim(),
      ...(draft.value.language.trim() ? { language: draft.value.language.trim() } : {}),
      ...(draft.value.gitRemote.trim() ? { gitRemote: draft.value.gitRemote.trim() } : {}),
      ...(draft.value.description.trim() ? { hint: draft.value.description.trim() } : {}),
    })
    if (desc) draft.value.description = desc
  } catch (err) {
    genError.value = err instanceof Error ? err.message : String(err)
  } finally {
    generating.value = false
  }
}

const onSubmit = () => {
  if (!canSave.value || props.busy) return
  if (props.project) {
    emit('save', { kind: 'update', project: { ...props.project, ...draft.value } })
    return
  }
  emit('save', { kind: isClone.value ? 'clone' : 'link', data: { ...draft.value } })
}
</script>
