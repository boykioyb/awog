<template>
  <LibraryEntityModal
    :open="open && !dirtyOpen"
    :title="t('tasks.new.title')"
    :width="560"
    @close="emit('cancel')"
  >
    <div class="nt">
      <!-- project -->
      <div class="nt-field">
        <label class="nt-label">{{ t('tasks.new.project') }}</label>
        <AppSelect
          v-model="projectId"
          :options="projectOptions"
          :placeholder="t('tasks.new.projectPlaceholder')"
          width="100%"
        />
        <div class="nt-hint">{{ t('tasks.new.projectHint') }}</div>
      </div>

      <!-- source (hidden for a session-spawned task — its source IS the session) -->
      <div v-if="!originSessionId" class="nt-field">
        <label class="nt-label">{{ t('tasks.new.source') }}</label>
        <div class="seg">
          <span
            v-for="s in sourceOptions"
            :key="s.id"
            :class="{ on: sourceType === s.id }"
            @click="sourceType = s.id"
          >
            {{ s.label }}
          </span>
        </div>
      </div>

      <div v-if="!originSessionId && sourceType === 'github'" class="nt-field">
        <label class="nt-label">{{ t('tasks.new.githubUrl') }}</label>
        <input
          v-model="githubUrl"
          class="nt-input mono"
          placeholder="https://github.com/org/repo/pull/123"
          @input="onGithubInput"
        />
      </div>
      <div v-if="!originSessionId && sourceType === 'jira'" class="nt-field">
        <label class="nt-label">{{ t('tasks.new.jiraKey') }}</label>
        <input
          :value="jiraKey"
          class="nt-input mono"
          placeholder="PROJ-1234"
          @input="jiraKey = ($event.target as HTMLInputElement).value.toUpperCase()"
        />
      </div>

      <!-- optional connection -->
      <div v-if="!originSessionId && showConnectionPicker" class="nt-field">
        <label class="nt-label">{{ t('tasks.new.connection') }}</label>
        <div v-if="!connections.length" class="nt-hint">{{ t('tasks.new.connectionEmpty') }}</div>
        <template v-else>
          <AppSelect
            v-model="connectionId"
            :options="connectionOptions"
            :placeholder="t('tasks.new.connectionNone')"
            width="100%"
          />
          <div class="nt-hint">{{ t('tasks.new.connectionHint') }}</div>
        </template>
      </div>

      <!-- title -->
      <div class="nt-field">
        <label class="nt-label">{{ t('tasks.new.titleLabel') }}</label>
        <input v-model="title" class="nt-input" :placeholder="t('tasks.new.titlePh')" />
      </div>

      <!-- description -->
      <div class="nt-field">
        <label class="nt-label">{{ t('tasks.new.description') }}</label>
        <textarea
          v-model="description"
          class="nt-input nt-ta"
          rows="3"
          :placeholder="t('tasks.new.descriptionPh')"
        />
      </div>

      <!-- workflow -->
      <div class="nt-field">
        <label class="nt-label">{{ t('tasks.new.workflow') }}</label>
        <div v-if="!workflows.length" class="nt-hint">{{ t('tasks.new.workflowEmpty') }}</div>
        <div v-else class="nt-wflist">
          <button
            v-for="wf in workflows"
            :key="wf.id"
            type="button"
            class="nt-wf"
            :class="{ on: workflowId === wf.id }"
            @click="workflowId = wf.id"
          >
            <span class="nt-wf-radio" :class="{ on: workflowId === wf.id }" />
            <span class="nt-wf-text">
              <span class="nt-wf-name">{{ wf.name }}</span>
              <span v-if="wf.description" class="nt-wf-desc">{{ wf.description }}</span>
            </span>
          </button>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="btn pri" :disabled="!canSubmit" @click="submit">
        {{ t('tasks.new.create') }}
      </button>
    </template>
  </LibraryEntityModal>

  <DirtyWorkspaceWarnModal
    :open="dirtyOpen"
    :file-count="dirtyFileCount"
    @close="onDirtyCancel"
    @commit-now="onDirtyCommit"
    @stash-and-continue="onDirtyStash"
    @continue-anyway="onDirtyContinue"
  />
</template>

<script setup lang="ts">
// New Task modal — port of the old UI NewTaskModal in prototype CSS. Project +
// source (github/jira/manual) + optional connection + title/description +
// workflow picker. Source/connection/workflow data come from the page via the
// useNewTaskData bundle (no store import — SoC). Before creating the task the
// modal probes the SELECTED project's git status (via useGitApi, not the git
// page's active root) and gates per `dirtyTaskPolicy`: 'warn' opens the
// DirtyWorkspaceWarnModal (commit / stash / continue), 'auto-stash' stashes
// silently then continues. Clean workspace (or suppressed warn) creates directly.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import DirtyWorkspaceWarnModal from '~/components/task/DirtyWorkspaceWarnModal.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useGitApi } from '~/composables/useGitApi'
import type { useNewTaskData } from '~/composables/useNewTaskData'
import { useI18n } from '~/composables/useI18n'
import { useSidecar } from '~/composables/useSidecar'
import { useSettingsStore } from '~/stores/settings'
import type { CreateTaskInput, TaskSource } from '~/stores/tasks'

const props = defineProps<{
  open: boolean
  data: ReturnType<typeof useNewTaskData>
  // Pre-fill (ADR 0055): seed project + title when opened from a session/elsewhere.
  seedProjectId?: string
  seedTitle?: string
  // Pre-select a workflow (e.g. opened from the Workflows "Run" button).
  seedWorkflowId?: string
  // When set, the task is spawned from this session: the source picker is hidden
  // and the created task's source becomes { type:'session', sessionId }.
  originSessionId?: string
}>()

const emit = defineEmits<{
  save: [data: CreateTaskInput]
  cancel: []
}>()

const { t } = useI18n()
const sc = useSidecar()
const git = useGitApi()
const settings = useSettingsStore()

const projects = computed(() => props.data.projects.value)
const connections = computed(() => props.data.connections.value)
const workflows = computed(() => props.data.workflowsForProject(projectId.value))

const projectOptions = computed<AppSelectOption[]>(() =>
  projects.value.map((p) => ({ value: p.id, label: p.path ? `${p.name} — ${p.path}` : p.name })),
)
const connectionOptions = computed<AppSelectOption[]>(() => [
  { value: '', label: t('tasks.new.connectionNone') },
  ...connections.value.map((c) => ({ value: c.id, label: c.name })),
])

const sourceOptions = [
  { id: 'github' as const, label: 'GitHub' },
  { id: 'jira' as const, label: 'Jira' },
  { id: 'manual' as const, label: 'Manual' },
]

const projectId = ref('')
const sourceType = ref<'github' | 'jira' | 'manual'>('github')
const githubUrl = ref('')
const jiraKey = ref('')
const connectionId = ref('')
const title = ref('')
const description = ref('')
const workflowId = ref('')

// ── dirty-workspace gate state ───────────────────────────────────────────────
// Declared before the seed watch so the watch's immediate run (which calls
// closeDirty when the modal starts closed) is safe — `const` is in TDZ until
// here, and `immediate: true` fires during setup.
const dirtyOpen = ref(false)
const dirtyFileCount = ref(0)
const pendingPayload = ref<CreateTaskInput | null>(null)

const closeDirty = () => {
  dirtyOpen.value = false
  pendingPayload.value = null
  dirtyFileCount.value = 0
}

// Re-seed defaults each time the modal opens (data may have just loaded);
// clear any dangling dirty-gate state when it closes.
watch(
  () => [props.open, projects.value, workflows.value] as const,
  ([isOpen]) => {
    if (!isOpen) {
      closeDirty()
      return
    }
    // Seed project + title (ADR 0055) take precedence on open; fall back to the
    // first project. Title only seeds when the field is still empty (don't clobber
    // user edits if the modal re-seeds while open).
    projectId.value = props.seedProjectId || projectId.value || projects.value[0]?.id || ''
    if (props.seedTitle && !title.value) title.value = props.seedTitle
    // When the current selection is no longer valid (modal just opened, or the
    // project changed the offered set), prefer a seeded workflow if it's offered
    // for this project; otherwise fall back to the first.
    if (!workflows.value.some((w) => w.id === workflowId.value)) {
      const seeded = props.seedWorkflowId
      workflowId.value =
        (seeded && workflows.value.some((w) => w.id === seeded)
          ? seeded
          : workflows.value[0]?.id) ?? ''
    }
  },
  { immediate: true },
)

// Changing the project re-filters workflows; drop a stale selection.
watch(projectId, () => {
  if (!workflows.value.some((w) => w.id === workflowId.value)) {
    workflowId.value = workflows.value[0]?.id ?? ''
  }
})

const showConnectionPicker = computed(
  () => sourceType.value === 'github' || sourceType.value === 'jira',
)

const parseGithub = (url: string) => {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/)
  if (m && m[1] && m[2] && m[3]) {
    const kind = url.includes('/pull/') ? 'pull' : 'issue'
    return { repo: `${m[1]}/${m[2]}`, issueNumber: Number.parseInt(m[3], 10), kind, url }
  }
  return null
}

const onGithubInput = () => {
  const parsed = parseGithub(githubUrl.value)
  if (parsed && !title.value) {
    const label = parsed.kind === 'pull' ? 'PR' : 'Issue'
    title.value = `${label} #${parsed.issueNumber} in ${parsed.repo}`
  }
}

const canSubmit = computed(
  () =>
    !!title.value.trim() &&
    !!workflowId.value &&
    !!projectId.value &&
    // A session-spawned task has an implicit source; the picker is hidden.
    (!!props.originSessionId ||
      sourceType.value === 'manual' ||
      (sourceType.value === 'github' && !!githubUrl.value) ||
      (sourceType.value === 'jira' && !!jiraKey.value)),
)

const buildPayload = (): CreateTaskInput => {
  const conn = connectionId.value ? { connectionId: connectionId.value } : {}
  let source: TaskSource
  if (props.originSessionId) {
    // Spawned from a chat session (ADR 0055) — the session is the origin.
    source = { type: 'session', sessionId: props.originSessionId }
  } else if (sourceType.value === 'github') {
    const parsed = parseGithub(githubUrl.value)
    source = parsed
      ? {
          type: 'github',
          repo: parsed.repo,
          issueNumber: parsed.issueNumber,
          url: parsed.url,
          ...conn,
        }
      : { type: 'github', repo: 'unknown', issueNumber: 0, url: githubUrl.value, ...conn }
  } else if (sourceType.value === 'jira') {
    source = { type: 'jira', key: jiraKey.value, ...conn }
  } else {
    source = { type: 'manual' }
  }
  return {
    title: title.value.trim(),
    description: description.value.trim(),
    source,
    workflowId: workflowId.value,
    projectId: projectId.value,
  }
}

// ── dirty-workspace gate ─────────────────────────────────────────────────────
// Probe the selected project's git status before creating, then honor
// settings.git.dirtyTaskPolicy. The dirty signal = number of changed files
// (staged + unstaged + untracked) reported by git.status on the project's PATH
// (resolved from the project picker — NOT the git page's active root). The gate
// state (dirtyOpen / dirtyFileCount / pendingPayload / closeDirty) is declared
// above, before the seed watch.

// Map the chosen projectId → its absolute path. The path is the workspaceRoot
// git.* RPCs take. Empty when the project carries no path.
const selectedProjectPath = computed(
  () => projects.value.find((p) => p.id === projectId.value)?.path ?? '',
)

// Suppress the warn modal for the rest of the browser session — sessionStorage
// resets on app reload (matches the "Don't ask again this session" toggle).
const SUPPRESS_KEY = 'awog.dirty-warn.suppress'
const isSuppressed = (): boolean => {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(SUPPRESS_KEY) === '1'
  } catch {
    return false
  }
}
const setSuppressed = (v: boolean) => {
  if (typeof window === 'undefined') return
  try {
    if (v) window.sessionStorage.setItem(SUPPRESS_KEY, '1')
    else window.sessionStorage.removeItem(SUPPRESS_KEY)
  } catch {
    // Storage disabled — non-fatal; the user just sees the modal again.
  }
}

// Count uncommitted files in the project. Returns 0 when the sidecar is offline,
// the project has no path, or the path is not a git repo (status rejects) — in
// all those cases we treat the workspace as clean and create directly.
const probeDirtyCount = async (path: string): Promise<number> => {
  if (!sc.available || !path) return 0
  try {
    const status = await git.status(path)
    return status.files.length
  } catch {
    return 0
  }
}

const stashBeforeRun = async (path: string, title: string): Promise<void> => {
  if (!sc.available || !path) return
  try {
    await git.stashSave(path, {
      message: `awog-auto-stash before task ${title}`,
      includeUntracked: true,
    })
  } catch {
    // Stash failed — proceed anyway so the user can still start the task.
  }
}

const submit = async () => {
  if (!canSubmit.value) return
  const payload = buildPayload()
  const path = selectedProjectPath.value
  const policy = settings.git.dirtyTaskPolicy
  // `autoStashDirtyBeforeTask` is the always-on form of the 'auto-stash' policy:
  // when set, dirty changes are stashed before every task run regardless of the
  // policy seg. The two settings overlap by design — the toggle wins so a user
  // who turned it on never sees the warn dialog. Effective auto-stash = toggle OR
  // policy === 'auto-stash'.
  const autoStash = settings.git.autoStashDirtyBeforeTask || policy === 'auto-stash'

  const count = await probeDirtyCount(path)
  if (count === 0) {
    emit('save', payload)
    return
  }

  // auto-stash: stash silently then create, no prompt.
  if (autoStash) {
    await stashBeforeRun(path, payload.title)
    emit('save', payload)
    return
  }

  // warn: open the dialog unless suppressed this session.
  if (isSuppressed()) {
    emit('save', payload)
    return
  }
  pendingPayload.value = payload
  dirtyFileCount.value = count
  dirtyOpen.value = true
}

// Cancel the dirty modal (scrim/X) — abort the task start entirely.
const onDirtyCancel = () => {
  closeDirty()
  emit('cancel')
}

// "Commit changes" — abort the start and send the user to the git page so they
// can commit the project's changes first.
const onDirtyCommit = (suppress: boolean) => {
  setSuppressed(suppress)
  closeDirty()
  emit('cancel')
  navigateTo('/git')
}

const onDirtyStash = async (suppress: boolean) => {
  setSuppressed(suppress)
  const payload = pendingPayload.value
  const path = selectedProjectPath.value
  closeDirty()
  if (!payload) return
  await stashBeforeRun(path, payload.title)
  emit('save', payload)
}

const onDirtyContinue = (suppress: boolean) => {
  setSuppressed(suppress)
  const payload = pendingPayload.value
  closeDirty()
  if (payload) emit('save', payload)
}
</script>

<style scoped>
.nt {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.nt-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.nt-label {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 550;
  color: var(--text);
}
.nt-input {
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
.nt-input.mono {
  /* mono-ok: the `.mono` opt-in variant — path / branch */
  font-family: var(--code);
}
.nt-input:focus {
  border-color: var(--accent);
}
.nt-ta {
  resize: vertical;
  min-height: 4rem;
  line-height: 1.5;
}
.nt-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.nt-wflist {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.nt-wf {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  cursor: pointer;
}
.nt-wf.on {
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.nt-wf-radio {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 1.5px solid var(--borderStrong);
  flex: 0 0 auto;
  margin-top: 2px;
  display: grid;
  place-items: center;
}
.nt-wf-radio.on {
  border-color: var(--accent);
}
.nt-wf-radio.on::after {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
}
.nt-wf-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.nt-wf-name {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 550;
  color: var(--text);
}
.nt-wf-desc {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
</style>
