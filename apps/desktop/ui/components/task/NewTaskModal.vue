<template>
  <BaseModal :open="!dirtyWarnOpen" title="New task" @close="emit('cancel')">
    <div class="p-4 space-y-4">
      <Field label="Project">
        <AppSelect v-model="projectId">
          <option v-if="projects.length === 0" value="">No projects — create one first</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">
            {{ p.name }} — {{ p.path }}
          </option>
        </AppSelect>
        <div class="text-[1em] mt-1" :style="{ color: t.textDim }">
          Code changes will happen in this local repository
        </div>
      </Field>
      <Field label="Source">
        <div class="flex gap-1">
          <button
            v-for="s in sourceOptions"
            :key="s.id"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[1em] font-medium transition"
            :style="{
              background: sourceType === s.id ? t.accent : t.bgInput,
              color: sourceType === s.id ? t.accentText : t.textMuted,
              border: `1px solid ${sourceType === s.id ? t.accent : t.border}`,
            }"
            @click="sourceType = s.id"
          >
            <component :is="s.icon" :size="11" />
            {{ s.label }}
          </button>
        </div>
      </Field>
      <Field v-if="sourceType === 'github'" label="GitHub Issue / PR URL">
        <input
          v-model="githubUrl"
          placeholder="https://github.com/org/repo/pull/123"
          class="w-full rounded-lg px-2 py-1.5 text-[1em] font-mono"
          :style="inputStyle"
          @input="onGithubUrlInput"
        />
      </Field>
      <Field v-if="sourceType === 'jira'" label="Jira Key">
        <input
          :value="jiraKey"
          placeholder="PROJ-1234"
          class="w-full rounded-lg px-2 py-1.5 text-[1em] font-mono"
          :style="inputStyle"
          @input="jiraKey = ($event.target as HTMLInputElement).value.toUpperCase()"
        />
      </Field>
      <!-- Optional connection (ADR 0025 simplified): its tools are unioned into
           every task node so the agent can reach the source. -->
      <Field v-if="showConnectionPicker" :label="tr('connections.picker.label')">
        <div v-if="connectionOptions.length === 0" class="flex items-center justify-between gap-2">
          <span class="text-[1em]" :style="{ color: t.textDim }">
            {{ tr('connections.picker.empty') }}
          </span>
          <button
            class="inline-flex items-center gap-1.5 px-2.5 py-1 text-[1em] rounded-lg font-medium transition"
            :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
            @click="onAddConnection"
          >
            <Plus :size="11" />
            {{ tr('connections.picker.cta') }}
          </button>
        </div>
        <template v-else>
          <AppSelect v-model="connectionId">
            <option value="">{{ tr('connections.picker.none') }}</option>
            <option v-for="c in connectionOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
          </AppSelect>
          <div class="text-[1em] mt-1" :style="{ color: t.textDim }">
            {{ tr('connections.picker.hint') }}
          </div>
        </template>
      </Field>
      <Field label="Title">
        <input
          v-model="title"
          class="w-full rounded-lg px-2 py-1.5 text-[1em]"
          :style="inputStyle"
        />
      </Field>
      <Field label="Description">
        <textarea
          v-model="description"
          :rows="4"
          class="w-full rounded-lg px-2 py-1.5 text-[1em] resize-y min-h-[5rem]"
          :style="inputStyle"
        />
      </Field>
      <Field label="Workflow">
        <div class="space-y-1.5">
          <button
            v-for="wf in workflows"
            :key="wf.id"
            class="w-full text-left rounded-lg px-3 py-2 transition flex items-start gap-2.5"
            :style="{
              background: workflowId === wf.id ? t.bgActive : t.bgInput,
              border: `1px solid ${workflowId === wf.id ? t.borderFocus : t.border}`,
            }"
            @click="workflowId = wf.id"
          >
            <div
              class="w-4 h-4 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center"
              :style="{
                border: `1.5px solid ${workflowId === wf.id ? t.accent : t.borderStrong}`,
              }"
            >
              <div
                v-if="workflowId === wf.id"
                class="w-2 h-2 rounded-full"
                :style="{ background: t.accent }"
              />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[1em] font-medium" :style="{ color: t.text }">
                {{ wf.name }}
              </div>
              <div class="text-[1em]" :style="{ color: t.textDim }">
                {{ wf.description }}
              </div>
            </div>
          </button>
        </div>
      </Field>
    </div>

    <template #footer>
      <AppButton variant="ghost" @click="emit('cancel')">Cancel</AppButton>
      <AppButton :disabled="!canSubmit" @click="handleSubmit">Create task</AppButton>
    </template>
  </BaseModal>

  <DirtyWorkspaceWarnModal
    :open="dirtyWarnOpen"
    @close="dirtyWarnOpen = false"
    @commit-now="onDirtyCommitNow"
    @stash-and-continue="onDirtyStashAndContinue"
    @continue-anyway="onDirtyContinueAnyway"
  />
</template>

<script setup lang="ts">
import { Github, Layers, FileText, Plus } from 'lucide-vue-next'
import type { MCPServer, TaskSource } from '~/types'

interface CreateTaskInput {
  title: string
  description: string
  source: TaskSource
  workflowId: string
  projectId: string
}

const emit = defineEmits<{
  save: [data: CreateTaskInput]
  cancel: []
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const store = useWorkspaceStore()
const workflowsStore = useWorkflowsStore()
const gitStore = useGitStore()
const { git } = useGitSettings()

const projects = computed(() => store.projects)
const projectId = ref(projects.value[0]?.id || '')
// Workflows offered for the selected project: global (shared) + that project's
// own workflows (ADR 0024 follow-up — per-project workflow scoping).
const workflows = computed(() =>
  workflowsStore.workflows.filter(
    (w) => (w.source ?? 'global') === 'global' || w.projectId === projectId.value,
  ),
)

// Suppress the dirty-workspace warn modal for the rest of the browser session.
// `sessionStorage` resets on app reload — matches the spec "Đừng hỏi lại trong
// session này" toggle semantics.
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
    // Storage disabled — non-fatal, user just sees the modal again next time.
  }
}

const dirtyWarnOpen = ref(false)
const pendingPayload = ref<CreateTaskInput | null>(null)

const sourceType = ref<'github' | 'jira' | 'manual'>('github')
const githubUrl = ref('')
const jiraKey = ref('')
const title = ref('')
const description = ref('')
const workflowId = ref(workflows.value[0]?.id || '')

// Changing the project re-filters the workflow list; drop a selection that no
// longer belongs to the chosen project.
watch(projectId, () => {
  if (!workflows.value.some((w) => w.id === workflowId.value)) {
    workflowId.value = workflows.value[0]?.id || ''
  }
})

const sourceOptions = [
  { id: 'github' as const, label: 'GitHub', icon: Github },
  { id: 'jira' as const, label: 'Jira', icon: Layers },
  { id: 'manual' as const, label: 'Manual', icon: FileText },
]

// ─── Connection picker (ADR 0025, simplified) ────────────────────────────────
// Optional: a connection (MCP server) whose tools the engine unions into every
// node so the agent can reach the source. Flat list of ALL enabled connections
// (no service filter, no tier). '' = none (rely on the agent's own MCP set).
const connectionId = ref('')

const showConnectionPicker = computed(
  () => sourceType.value === 'github' || sourceType.value === 'jira',
)

const connectionOptions = computed<MCPServer[]>(() => store.mcpServers.filter((s) => s.enabled))

// Chosen connection was deleted / disabled since selection.
const connectionMissing = computed(
  () => !!connectionId.value && !connectionOptions.value.some((c) => c.id === connectionId.value),
)

const onAddConnection = () => {
  emit('cancel')
  navigateTo('/connections')
}

onMounted(() => {
  // The Tasks page does not hydrate connections — pull them so the picker lists
  // the enabled MCP servers (sidecar offline → empty state + CTA).
  store.hydrateMcpFromSidecar().catch(() => {})
})

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const parseGithubUrl = (url: string) => {
  // Accept both issue and PR URLs (GitHub shares the number space):
  //   github.com/<owner>/<repo>/issues/<n>  |  .../pull/<n>
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/)
  if (m && m[1] && m[2] && m[3]) {
    const kind = url.includes('/pull/') ? 'pull' : 'issue'
    return { repo: `${m[1]}/${m[2]}`, issueNumber: parseInt(m[3], 10), kind, url }
  }
  return null
}

const onGithubUrlInput = () => {
  const parsed = parseGithubUrl(githubUrl.value)
  if (parsed && !title.value) {
    const label = parsed.kind === 'pull' ? 'PR' : 'Issue'
    title.value = `${label} #${parsed.issueNumber} in ${parsed.repo}`
  }
}

const canSubmit = computed(
  () =>
    !!title.value &&
    !!workflowId.value &&
    !!projectId.value &&
    (sourceType.value === 'manual' ||
      (sourceType.value === 'github' && !!githubUrl.value) ||
      (sourceType.value === 'jira' && !!jiraKey.value)),
)

const buildPayload = (): CreateTaskInput => {
  // Attach the connection only when one is picked and still valid.
  const conn =
    connectionId.value && !connectionMissing.value ? { connectionId: connectionId.value } : {}
  let source: TaskSource
  if (sourceType.value === 'github') {
    const parsed = parseGithubUrl(githubUrl.value)
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
    title: title.value,
    description: description.value,
    source,
    workflowId: workflowId.value,
    projectId: projectId.value,
  }
}

const handleSubmit = async () => {
  if (!canSubmit.value) return
  const payload = buildPayload()

  // Select the right project in the git store first so `hasUncommitted`
  // reflects the project the user is actually about to run a task against.
  if (gitStore.selectedProjectId !== payload.projectId) {
    gitStore.setSelectedProject(payload.projectId)
    try {
      await gitStore.loadStatus()
    } catch {
      // Silent: sidecar unavailable means we fall back to whatever mock seed
      // the store carries — that's fine for the dirty warn decision.
    }
  }

  // Auto-stash short-circuit: skip the modal entirely.
  if (gitStore.hasUncommitted && git.value.dirtyTaskPolicy === 'auto-stash') {
    try {
      await gitStore.stashSave(`awog-auto-stash before task ${payload.title}`, true)
    } catch {
      // Stash failed — proceed anyway. The git store already surfaced a toast.
    }
    emit('save', payload)
    return
  }

  // Warn policy: open dialog only when actually dirty and not suppressed.
  if (gitStore.hasUncommitted && git.value.dirtyTaskPolicy === 'warn' && !isSuppressed()) {
    pendingPayload.value = payload
    dirtyWarnOpen.value = true
    return
  }

  emit('save', payload)
}

const closeDirtyModal = () => {
  dirtyWarnOpen.value = false
  pendingPayload.value = null
}

const onDirtyCommitNow = (suppress: boolean) => {
  setSuppressed(suppress)
  closeDirtyModal()
  // Abort task start — user is going to /git to commit first.
  emit('cancel')
  navigateTo('/git')
}

const onDirtyStashAndContinue = async (suppress: boolean) => {
  setSuppressed(suppress)
  const payload = pendingPayload.value
  closeDirtyModal()
  if (!payload) return
  try {
    await gitStore.stashSave(`awog-auto-stash before task ${payload.title}`, true)
  } catch {
    // Stash failed — surface via existing toast, continue anyway so the user
    // can decide what to do.
  }
  emit('save', payload)
}

const onDirtyContinueAnyway = (suppress: boolean) => {
  setSuppressed(suppress)
  const payload = pendingPayload.value
  closeDirtyModal()
  if (!payload) return
  // Spec calls for a trace event `task.started_dirty: true` here. The engine
  // doesn't yet emit task lifecycle traces, so we log a warning instead and
  // wire the trace event once the engine layer lands (deferred).

  console.warn('[task] started with dirty workspace', { taskTitle: payload.title })
  emit('save', payload)
}
</script>
