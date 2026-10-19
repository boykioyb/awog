<template>
  <LibraryEntityModal
    :open="open && !dirtyOpen"
    :title="t('tasks.new.title')"
    :width="560"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-4">
      <!-- project -->
      <div class="flex flex-col gap-1.5">
        <Label>{{ t('tasks.new.project') }}</Label>
        <AppSelect
          v-model="projectId"
          :options="projectOptions"
          :placeholder="t('tasks.new.projectPlaceholder')"
          width="100%"
        />
        <div class="text-xs text-dim">{{ t('tasks.new.projectHint') }}</div>
      </div>

      <!-- source (hidden for a session-spawned task — its source IS the session) -->
      <div v-if="!originSessionId" class="flex flex-col gap-1.5">
        <Label>{{ t('tasks.new.source') }}</Label>
        <ToggleGroup
          type="single"
          :spacing="1"
          class="self-start rounded-lg bg-muted p-0.5"
          :model-value="sourceType"
          @update:model-value="pickSource"
        >
          <ToggleGroupItem
            v-for="s in sourceOptions"
            :key="s.id"
            :value="s.id"
            class="h-ctrl-xs px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          >
            {{ s.label }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div v-if="!originSessionId && sourceType === 'github'" class="flex flex-col gap-1.5">
        <Label>{{ t('tasks.new.githubUrl') }}</Label>
        <Input
          v-model="githubUrl"
          placeholder="https://github.com/org/repo/pull/123"
          class="font-mono"
          @input="onGithubInput"
        />
      </div>
      <div v-if="!originSessionId && sourceType === 'jira'" class="flex flex-col gap-1.5">
        <Label>{{ t('tasks.new.jiraKey') }}</Label>
        <Input
          :model-value="jiraKey"
          placeholder="PROJ-1234"
          class="font-mono"
          @update:model-value="jiraKey = $event.toUpperCase()"
        />
      </div>

      <!-- optional connection -->
      <div v-if="!originSessionId && showConnectionPicker" class="flex flex-col gap-1.5">
        <Label>{{ t('tasks.new.connection') }}</Label>
        <div v-if="!connections.length" class="text-xs text-dim">
          {{ t('tasks.new.connectionEmpty') }}
        </div>
        <template v-else>
          <AppSelect
            v-model="connectionId"
            :options="connectionOptions"
            :placeholder="t('tasks.new.connectionNone')"
            width="100%"
          />
          <div class="text-xs text-dim">{{ t('tasks.new.connectionHint') }}</div>
        </template>
      </div>

      <!-- title -->
      <div class="flex flex-col gap-1.5">
        <Label>{{ t('tasks.new.titleLabel') }}</Label>
        <Input v-model="title" :placeholder="t('tasks.new.titlePh')" />
      </div>

      <!-- description -->
      <div class="flex flex-col gap-1.5">
        <Label>{{ t('tasks.new.description') }}</Label>
        <Textarea
          v-model="description"
          class="min-h-16 resize-y"
          rows="3"
          :placeholder="t('tasks.new.descriptionPh')"
        />
      </div>

      <!-- workflow -->
      <div class="flex flex-col gap-1.5">
        <Label>{{ t('tasks.new.workflow') }}</Label>
        <div v-if="!workflows.length" class="text-xs text-dim">
          {{ t('tasks.new.workflowEmpty') }}
        </div>
        <RadioGroup
          v-else
          class="gap-1.5"
          :model-value="workflowId"
          @update:model-value="(v) => (workflowId = String(v))"
        >
          <label
            v-for="wf in workflows"
            :key="wf.id"
            class="flex w-full cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5"
            :class="workflowId === wf.id ? 'border-selected-border bg-selected' : 'bg-muted'"
          >
            <RadioGroupItem :value="wf.id" class="mt-0.5" />
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="text-sm font-medium text-foreground">{{ wf.name }}</span>
              <span v-if="wf.description" class="text-xs text-dim">{{ wf.description }}</span>
            </span>
          </label>
        </RadioGroup>
      </div>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canSubmit" variant="default" @click="submit">
        {{ t('tasks.new.create') }}
      </Button>
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
// New Task modal. Project +
// source (github/jira/manual) + optional connection + title/description +
// workflow picker. Source/connection/workflow data come from the page via the
// useNewTaskData bundle (no store import — SoC). Before creating the task the
// modal probes the SELECTED project's git status (via useGitApi, not the git
// page's active root) and gates per `dirtyTaskPolicy`: 'warn' opens the
// DirtyWorkspaceWarnModal (commit / stash / continue), 'auto-stash' stashes
// silently then continues. Clean workspace (or suppressed warn) creates directly.
import { computed, ref, watch } from 'vue'
import type { AcceptableValue } from 'reka-ui'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import DirtyWorkspaceWarnModal from '~/components/task/DirtyWorkspaceWarnModal.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useGitApi } from '~/composables/useGitApi'
import type { useNewTaskData } from '~/composables/useNewTaskData'
import { useI18n } from '~/composables/useI18n'
import { useSidecar } from '~/composables/useSidecar'
import { useSettingsStore } from '~/stores/settings'
import type { CreateTaskInput, TaskSource } from '~/stores/tasks'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import { ghRefTitle } from '~/utils/gh-ref'

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

// ToggleGroup single cho bấm lại mục đang bật để bỏ chọn (emit rỗng) — nguồn luôn
// phải có một giá trị nên bỏ qua lần bỏ chọn đó.
const pickSource = (v: AcceptableValue | AcceptableValue[]) => {
  const opt = sourceOptions.find((o) => o.id === v)
  if (opt) sourceType.value = opt.id
}

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

// Fetch lần cuối theo `repo#number` — gõ lại cùng một URL không spawn gh thêm.
let lastGhTitleKey = ''
const onGithubInput = () => {
  const parsed = parseGithub(githubUrl.value)
  if (!parsed || title.value) return
  // Quy ước `#<n>_IS:` / `#<n>_PR:` (utils/gh-ref) — gh.get chỉ resolve qua cwd
  // của project đang chọn, nên URL của repo khác sẽ trả sai: kiểm ngược
  // thread.url về đúng repo+number trước khi lấy title làm mô tả.
  const kind: 'issue' | 'pr' = parsed.kind === 'pull' ? 'pr' : 'issue'
  const refKey = `${parsed.repo}#${parsed.issueNumber}:${kind}`
  if (lastGhTitleKey === refKey) return
  lastGhTitleKey = refKey
  const fallback = ghRefTitle({ kind, number: parsed.issueNumber }, '')
  title.value = fallback
  if (!projectId.value || !sc.available) return
  void sc
    .request<{ title: string; url?: string }>('gh.get', {
      projectId: projectId.value,
      kind,
      number: parsed.issueNumber,
    })
    .then((th) => {
      // Repo lệch (gh chạy trong project khác repo của URL) → giữ prefix trần.
      const okUrl = th.url?.includes(
        `/${parsed.repo}/${kind === 'pr' ? 'pull' : 'issues'}/${parsed.issueNumber}`,
      )
      // User đã sửa tay khỏi fallback trong lúc chờ → không đè.
      if (okUrl && th.title?.trim() && title.value === fallback) {
        title.value = ghRefTitle({ kind, number: parsed.issueNumber }, th.title)
      }
    })
    .catch(() => {})
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
