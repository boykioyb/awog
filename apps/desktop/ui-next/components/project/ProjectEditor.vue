<template>
  <LibraryEntityModal
    :open="open"
    :title="project ? t('projects.editor.editTitle') : t('projects.editor.newTitle')"
    :lock-scrim="busy"
    :width="600"
    @close="emit('cancel')"
  >
    <div class="pe">
      <!-- Field order differs per mode via flex `order` (the .pe column):
           clone → git remote (1) · clone dest (2) · name+language (3) · description (5);
           existing/edit → name+language (1) · path (2) · git remote (4) · description (5). -->
      <!-- Source (create only): link existing folder vs clone a git remote. -->
      <div v-if="!project" class="pe-field" :style="{ order: 0 }">
        <label class="pe-label">{{ t('projects.editor.source') }}</label>
        <div class="pe-src">
          <button
            v-for="m in importOptions"
            :key="m.id"
            type="button"
            class="pe-srcbtn"
            :class="{ on: importMode === m.id }"
            :disabled="busy"
            @click="importMode = m.id"
          >
            <div class="pe-srctitle">
              <Icon :name="m.icon" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ m.label }}
            </div>
            <div class="pe-srchint">{{ m.hint }}</div>
          </button>
        </div>
      </div>

      <div class="pe-grid" :style="{ order: nameOrder }">
        <div class="pe-field" style="grid-column: span 2">
          <label class="pe-label">{{ t('projects.editor.name') }}</label>
          <input
            v-model="draft.name"
            class="pe-input"
            :placeholder="t('projects.editor.namePh')"
            :disabled="busy"
          />
        </div>
        <div class="pe-field">
          <label class="pe-label">{{ t('projects.editor.language') }}</label>
          <input
            v-model="draft.language"
            class="pe-input"
            :placeholder="t('projects.editor.languagePh')"
            :disabled="busy"
          />
        </div>
      </div>

      <div class="pe-field" :style="{ order: 2 }">
        <label class="pe-label">
          {{ isClone ? t('projects.editor.dest') : t('projects.editor.path') }}
        </label>
        <div style="display: flex; gap: 6px">
          <input
            v-model="draft.path"
            class="pe-input mono"
            :placeholder="t('projects.editor.pathPh')"
            :disabled="busy"
            style="flex: 1"
            @blur="onPathBlur"
          />
          <button
            class="btn"
            :disabled="busy || !canBrowse"
            :title="canBrowse ? t('projects.editor.browse') : t('projects.editor.browseUnavail')"
            @click="onBrowse"
          >
            <Icon name="folder" />
            {{ t('projects.editor.browse') }}
          </button>
        </div>
        <div class="pe-hint">
          {{ isClone ? t('projects.editor.destHint') : t('projects.editor.pathHint') }}
        </div>
      </div>

      <div v-if="isClone || project" class="pe-grid" :style="{ order: gitOrder }">
        <div class="pe-field" style="grid-column: span 2">
          <label class="pe-label">
            {{ t('projects.editor.gitRemote') }}
            <span v-if="detecting" class="pe-detecting">{{ t('projects.editor.detecting') }}</span>
          </label>
          <input
            v-model="draft.gitRemote"
            class="pe-input mono"
            placeholder="git@github.com:org/repo.git"
            :disabled="busy"
            @blur="onRemoteBlur"
          />
        </div>
        <div class="pe-field">
          <label class="pe-label">{{ t('projects.editor.branch') }}</label>
          <input
            v-model="draft.gitBranch"
            class="pe-input mono"
            placeholder="main"
            :disabled="busy || isClone"
          />
        </div>
      </div>

      <div class="pe-field" :style="{ order: 5 }">
        <div class="pe-labelrow">
          <label class="pe-label">{{ t('projects.editor.description') }}</label>
          <button
            type="button"
            class="pe-genbtn"
            :disabled="busy || generating || !draft.name.trim()"
            :title="t('projects.editor.genDescHint')"
            @click="onGenerateDescription"
          >
            <Icon
              :name="generating ? 'refresh' : 'sparkles'"
              :class="{ spin: generating }"
              style="width: var(--icon-xs); height: var(--icon-xs)"
            />
            {{ t('projects.editor.genDesc') }}
          </button>
        </div>
        <textarea
          v-model="draft.description"
          class="pe-input pe-ta"
          rows="3"
          :placeholder="t('projects.editor.descriptionPh')"
          :disabled="busy"
        />
        <div v-if="genError" class="pe-hint" style="color: var(--danger)">{{ genError }}</div>
      </div>

      <div v-if="busy || error" class="pe-status" :class="{ err: !!error }" :style="{ order: 6 }">
        <div v-if="busy" class="pe-busy">
          <span class="pe-dot" />
          {{ progress || (isClone ? t('projects.editor.cloning') : t('projects.editor.saving')) }}
        </div>
        <div v-if="error" class="mono" style="line-height: 1.5">{{ error }}</div>
      </div>
    </div>

    <template #footer>
      <button class="btn" :disabled="busy" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="btn pri" :disabled="!canSave || busy" @click="onSubmit">
        {{ saveLabel }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Project form editor — link an existing folder, clone a git remote, or edit an
// existing project. Rendered in prototype CSS inside LibraryEntityModal. Path
// inspection (pre-fill empty fields) + the native folder picker are proxied from
// the page-controller. Emits a discriminated save payload.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import type { ProjectInspectResult, RemoteInspectResult } from '~/stores/projects'
import type { Project } from '~/types'
import type { ProjectEditorDraft, ProjectEditorSavePayload } from './types'

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

<style scoped>
.pe {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.pe-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}
.pe-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pe-label {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 550;
  color: var(--text);
}
.pe-input {
  width: 100%;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-family: var(--sans);
  outline: none;
}
.pe-input.mono {
  /* mono-ok: the `.mono` opt-in variant — project path */
  font-family: var(--code);
}
.pe-input:focus {
  border-color: var(--accent);
}
.pe-input:disabled {
  opacity: 0.55;
}
.pe-ta {
  resize: vertical;
  min-height: 4rem;
  line-height: 1.55;
}
.pe-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.pe-labelrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.pe-detecting {
  margin-left: 8px;
  font-weight: 400;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.pe-genbtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--r-xs);
  background: transparent;
  border: 1px solid var(--border);
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
  transition:
    color 0.12s ease,
    border-color 0.12s ease;
}
.pe-genbtn:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accentBorder);
}
.pe-genbtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.spin {
  animation: pe-spin 0.9s linear infinite;
}
@keyframes pe-spin {
  to {
    transform: rotate(360deg);
  }
}
.pe-src {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.pe-srcbtn {
  text-align: left;
  border-radius: var(--r-btn);
  padding: 10px 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  cursor: pointer;
}
.pe-srcbtn.on {
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.pe-srcbtn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.pe-srctitle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 550;
  color: var(--text);
  margin-bottom: 2px;
}
.pe-srchint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.pe-status {
  border-radius: var(--r-sm);
  padding: 10px 12px;
  background: var(--bgSubtle);
  border: 1px solid var(--border);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.pe-status.err {
  border-color: var(--danger);
  color: var(--danger);
}
.pe-busy {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pe-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: pe-pulse 1.1s ease-in-out infinite;
}
@keyframes pe-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
</style>
