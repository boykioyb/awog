<template>
  <MasterDetailShell
    :mobile-pane="mobilePane"
    :selected-id="creating ? '_creating' : selectedId"
    list-width="18rem"
    @update:mobile-pane="onBack"
  >
    <template #list>
      <div
        class="px-3 py-3 flex items-center gap-2"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <SearchInput v-model="searchQuery" class="flex-1" placeholder="Search projects..." />
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          title="Add project"
          @click="startCreate"
          @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
          @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
        >
          <Plus :size="14" />
        </button>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div
          v-for="p in filtered"
          :key="p.id"
          class="w-full px-3 py-2.5 text-left cursor-pointer transition"
          :style="{
            background: pill(isActive(p.id)).background,
            borderBottom: `1px solid ${t.border}`,
            borderLeft: `2px solid ${isActive(p.id) ? t.accent : 'transparent'}`,
          }"
          @click="selectProject(p.id)"
          @contextmenu="onContextMenu($event, p.id)"
        >
          <div class="flex items-center gap-2 mb-0.5">
            <FolderGit2 :size="12" :style="{ color: t.textDim }" />
            <input
              v-if="renamingId === p.id"
              :ref="setRenameInputRef"
              v-model="renameValue"
              class="text-[1em] font-medium flex-1 rounded px-1 py-0.5"
              :style="{
                background: t.bgInput,
                border: `1px solid ${t.borderStrong}`,
                color: t.text,
                outline: 'none',
              }"
              @click.stop
              @keydown.enter="commitRename"
              @keydown.escape="cancelRename"
              @blur="commitRename"
            />
            <div
              v-else
              class="text-[1em] font-medium flex-1 truncate"
              :style="{ color: t.text }"
              @dblclick.stop="startRename(p.id, p.name)"
            >
              {{ p.name }}
            </div>
            <button
              class="p-1 rounded flex-shrink-0 transition opacity-60 hover:opacity-100"
              :style="{ color: t.textMuted }"
              title="Actions"
              @click.stop="openMenuFromButton($event, p.id)"
            >
              <MoreHorizontal :size="13" />
            </button>
          </div>
          <div class="text-[1em] font-mono truncate ml-5" :style="{ color: t.textDim }">
            {{ p.path }}
          </div>
        </div>
      </div>
    </template>

    <template #detail>
      <ProjectEditor
        v-if="creating"
        :project="null"
        :busy="busy"
        :busy-label="busyLabel"
        :last-progress-line="lastProgressLine"
        :error="error"
        @save="handleSave"
        @cancel="cancelCreate"
      />
      <ProjectEditor
        v-else-if="editing && selectedProject"
        :project="selectedProject"
        :busy="busy"
        :error="error"
        @save="handleSave"
        @cancel="editing = false"
      />
      <div v-else-if="selectedProject" class="flex flex-col h-full min-h-0">
        <div class="flex-1 overflow-y-auto p-4 md:p-6">
          <div class="flex items-start gap-3 mb-6">
            <div
              class="w-12 h-12 rounded flex items-center justify-center"
              :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
            >
              <FolderGit2 :size="20" :style="{ color: t.textMuted }" />
            </div>
            <div class="flex-1 min-w-0">
              <h1 class="text-lg font-semibold mb-1" :style="{ color: t.text }">
                {{ selectedProject.name }}
              </h1>
              <div class="text-[1em] font-mono truncate" :style="{ color: t.textDim }">
                {{ selectedProject.path }}
              </div>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
              <button
                class="px-3 py-1.5 text-[1em] rounded inline-flex items-center gap-1.5 transition"
                :style="{ background: t.accent, color: t.accentText }"
                @click="openInEditor(selectedProject.id)"
              >
                <Code2 :size="13" />
                Open in Editor
              </button>
              <button
                class="px-3 py-1.5 text-[1em] rounded inline-flex items-center gap-1.5 transition"
                :style="
                  isTerminalOpen
                    ? {
                        background: t.bgActive,
                        color: t.accent,
                        border: `1px solid ${t.borderStrong}`,
                      }
                    : { color: t.text, border: `1px solid ${t.borderStrong}` }
                "
                title="Terminal"
                @click="toggleTerminal"
              >
                <TerminalSquare :size="13" />
                Terminal
              </button>
              <button
                class="px-3 py-1.5 text-[1em] rounded inline-flex items-center gap-1.5 transition"
                :style="{ color: t.text, border: `1px solid ${t.borderStrong}` }"
                @click="editing = true"
              >
                <Edit3 :size="11" />
                Edit
              </button>
              <button
                class="p-1.5 rounded transition"
                :style="{ color: t.textDim }"
                :title="tr('project.llm.title')"
                @click="llmModalOpen = true"
              >
                <SlidersHorizontal :size="13" />
              </button>
              <button
                class="p-1.5 rounded transition"
                :style="{ color: t.textDim }"
                @click="confirmDelete = selectedProject"
              >
                <Trash2 :size="13" />
              </button>
            </div>
          </div>

          <div class="mb-6 flex items-center gap-2 flex-wrap">
            <button
              class="px-3 py-1.5 text-[1em] rounded inline-flex items-center gap-1.5 transition"
              :style="{ color: t.text, border: `1px solid ${t.borderStrong}` }"
              @click="openSaveAsTemplate"
            >
              <Package :size="13" />
              {{ tr('templates.projects.save_as') }}
            </button>
            <button
              class="px-3 py-1.5 text-[1em] rounded inline-flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
              :style="{ color: t.text, border: `1px solid ${t.borderStrong}` }"
              :disabled="templatesStore.templates.length === 0"
              @click="openInstallTemplate"
            >
              <PackagePlus :size="13" />
              {{ tr('templates.projects.install') }}
            </button>
          </div>

          <ConfigImportBanner
            :project-id="selectedProject.id"
            class="mb-6"
            @imported="onImported"
          />

          <div
            v-if="selectedProject.description"
            class="mb-6 text-[1em] leading-relaxed"
            :style="{ color: t.textMuted }"
          >
            {{ selectedProject.description }}
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-6">
            <ProjectMeta :icon="GitBranch" label="Branch" :value="selectedProject.gitBranch" mono />
            <ProjectMeta :icon="Code2" label="Language" :value="selectedProject.language" />
            <ProjectMeta
              :icon="Clock"
              label="Created"
              :value="formatTime(selectedProject.createdAt)"
            />
          </div>

          <!-- Per-project session LLM defaults. New sessions in this project
               inherit provider/account/model/effort from here. -->
          <button
            class="w-full rounded p-3 mb-6 flex items-center gap-3 text-left transition"
            :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
            @click="llmModalOpen = true"
          >
            <SlidersHorizontal :size="15" :style="{ color: t.textDim }" />
            <div class="flex-1 min-w-0">
              <div
                class="text-[1em] uppercase tracking-wider font-medium"
                :style="{ color: t.textDim }"
              >
                {{ tr('project.llm.title') }}
              </div>
              <div
                class="text-[1em] mt-0.5 truncate"
                :style="{ color: llmSummary.custom ? t.text : t.textDim }"
              >
                {{ llmSummary.text }}
              </div>
            </div>
            <ChevronRight :size="15" :style="{ color: t.textDim }" />
          </button>

          <div
            v-if="selectedProject.gitRemote"
            class="mb-6 rounded p-3"
            :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
          >
            <div
              class="text-[1em] uppercase tracking-wider font-medium mb-2"
              :style="{ color: t.textDim }"
            >
              Git Remote
            </div>
            <div class="flex items-center gap-2">
              <GitFork :size="12" :style="{ color: t.textDim }" />
              <span class="text-[1em] font-mono flex-1 truncate" :style="{ color: t.text }">
                {{ selectedProject.gitRemote }}
              </span>
              <button
                class="px-2 py-0.5 text-[1em] rounded transition"
                :style="{ color: t.textDim }"
              >
                Open
              </button>
            </div>
          </div>

          <div class="mb-2 flex items-center justify-between flex-wrap gap-2">
            <div
              class="text-[1em] uppercase tracking-wider font-medium"
              :style="{ color: t.textDim }"
            >
              Sessions · {{ projectSessions.length }}
            </div>
            <button
              class="px-2.5 py-1 text-[1em] rounded inline-flex items-center gap-1.5 transition"
              :style="{ color: t.text, border: `1px solid ${t.borderStrong}` }"
              title="New session for this project"
              @click="startSessionForProject"
            >
              <Plus :size="12" />
              New session
            </button>
          </div>
          <div
            v-if="projectSessions.length === 0"
            class="text-[1em] py-4 mb-6"
            :style="{ color: t.textFaint }"
          >
            No sessions yet for this project
          </div>
          <div v-else class="space-y-1.5 mb-6">
            <button
              v-for="ses in projectSessions"
              :key="ses.id"
              class="w-full text-left rounded px-3 py-2 transition flex items-start gap-2.5"
              :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
              @click="openSession(ses.id)"
            >
              <MessageSquare :size="12" :style="{ color: t.textDim, marginTop: '2px' }" />
              <div class="flex-1 min-w-0">
                <div class="text-[1em] truncate" :style="{ color: t.text }">
                  {{ ses.title }}
                </div>
                <div
                  class="text-[1em] mt-0.5 flex items-center gap-1.5"
                  :style="{ color: t.textDim }"
                >
                  <span>{{ formatTime(ses.updatedAt) }}</span>
                  <span :style="{ color: t.textFaint }">·</span>
                  <span>{{ ses.messages.length }} msg</span>
                  <template v-if="ses.invitedAgentIds.length">
                    <span :style="{ color: t.textFaint }">·</span>
                    <span>
                      {{ ses.invitedAgentIds.length }} agent{{
                        ses.invitedAgentIds.length > 1 ? 's' : ''
                      }}
                    </span>
                  </template>
                </div>
              </div>
              <ExternalLink :size="11" :style="{ color: t.textDim, marginTop: '2px' }" />
            </button>
          </div>

          <div class="mb-2 flex items-center justify-between flex-wrap gap-2">
            <div
              class="text-[1em] uppercase tracking-wider font-medium"
              :style="{ color: t.textDim }"
            >
              Tasks · {{ projectTaskStats.total }}
            </div>
            <div class="flex items-center gap-3 text-[1em]" :style="{ color: t.textDim }">
              <span v-if="projectTaskStats.running > 0" class="inline-flex items-center gap-1">
                <Circle :size="8" class="animate-pulse" :style="{ color: t.text, fill: t.text }" />
                {{ projectTaskStats.running }} running
              </span>
              <span v-if="projectTaskStats.waiting > 0" class="inline-flex items-center gap-1">
                <AlertCircle :size="9" :style="{ color: t.warning }" />
                {{ projectTaskStats.waiting }} waiting
              </span>
              <span v-if="projectTaskStats.completed > 0">
                {{ projectTaskStats.completed }} done
              </span>
            </div>
          </div>
          <div
            v-if="projectTasks.length === 0"
            class="text-[1em] py-4"
            :style="{ color: t.textFaint }"
          >
            No tasks yet for this project
          </div>
          <div v-else class="space-y-1.5">
            <button
              v-for="tk in projectTasks"
              :key="tk.id"
              class="w-full text-left rounded px-3 py-2 transition flex items-start gap-2.5"
              :style="{
                background: t.bgElevated,
                border: `1px solid ${t.border}`,
              }"
              @click="openTask(tk.id)"
            >
              <component
                :is="STATUS_META[tk.status].icon"
                :size="12"
                :class="tk.status === 'running' ? 'animate-pulse' : ''"
                :style="{
                  color: statusColor(tk),
                  marginTop: '2px',
                  fill: tk.status === 'completed' ? statusColor(tk) : 'none',
                }"
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-baseline gap-2 mb-0.5 flex-wrap">
                  <span class="text-[1em] font-mono" :style="{ color: t.textFaint }">
                    {{ tk.id }}
                  </span>
                  <span class="text-[1em]" :style="{ color: t.textFaint }">{{ tk.createdAt }}</span>
                </div>
                <div class="text-[1em]" :style="{ color: t.text }">
                  {{ tk.title }}
                </div>
              </div>
              <ExternalLink :size="11" :style="{ color: t.textDim, marginTop: '2px' }" />
            </button>
          </div>
        </div>
        <!-- One dock per project with an open terminal, kept mounted so its
             shell + content persist across project switches; only the selected
             project's dock is shown. -->
        <ProjectTerminalDock
          v-for="pid in terminalProjectIds"
          v-show="pid === selectedProject.id"
          :key="pid"
          :terminal-key="`proj:${pid}`"
          :workspace-root="terminalPathOf(pid)"
          @close="closeTerminal(pid)"
        />
      </div>
    </template>

    <template #empty-detail>
      <EmptyView :icon="FolderGit2" title="Select a project or add a new one" />
    </template>
  </MasterDetailShell>

  <ConfirmDeleteModal
    v-if="confirmDelete"
    :title="`Remove project &quot;${confirmDelete.name}&quot;?`"
    description="This removes the project from AgentFlow but does not delete the local folder. Existing tasks will keep their project reference but show as orphaned."
    @confirm="doDelete(confirmDelete.id)"
    @cancel="confirmDelete = null"
  />

  <ContextMenu
    v-if="contextMenu"
    :x="contextMenu.x"
    :y="contextMenu.y"
    :items="menuItems"
    @close="contextMenu = null"
  />

  <SaveAsTemplateDialog
    v-if="selectedProject"
    :open="saveTemplateOpen"
    :fixed-project-id="selectedProject.id"
    @close="saveTemplateOpen = false"
    @saved="onTemplateSaved"
  />

  <InstallTemplateDialog
    v-if="selectedProject"
    :open="installTemplateOpen"
    :fixed-project-id="selectedProject.id"
    @close="installTemplateOpen = false"
    @installed="onTemplateInstalled"
  />

  <ProjectLlmDefaultsModal
    v-if="selectedProject"
    :open="llmModalOpen"
    :project-id="selectedProject.id"
    @close="llmModalOpen = false"
  />

  <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="px-3 py-2 rounded text-[1em] shadow-lg"
      :style="toastStyle(toast.kind)"
    >
      {{ toast.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  AlertCircle,
  ChevronRight,
  Circle,
  Clock,
  Code2,
  Edit3,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitFork,
  MessageSquare,
  MoreHorizontal,
  Package,
  PackagePlus,
  Plus,
  SlidersHorizontal,
  TerminalSquare,
  Trash2,
} from 'lucide-vue-next'
import type { Project, Session, Task } from '~/types'
import { LEVEL_LABEL, PROVIDER_LABEL, modelById } from '~/utils/models'
import ProjectTerminalDock from '~/components/workspace/ProjectTerminalDock.vue'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'
import type { ProjectEditorSavePayload } from '~/components/project/types'
import { STATUS_META } from '~/utils/status-meta'
import { formatTime } from '~/utils/time'

const { t } = useTheme()
const { t: tr } = useI18n()
const { pill } = useGlass()
const ws = useWorkspaceStore()
const tasksStore = useTasksStore()
const sessionsStore = useSessionsStore()
const settingsStore = useSettingsStore()
const templatesStore = useTemplatesStore()
const sidecar = useSidecar()
const { toasts, pushToast, toastStyle } = useToasts()

// Templates are needed for the "Install template" button's enabled-state +
// picker. Guarded so this runs once across the app lifetime.
templatesStore.hydrate()

const saveTemplateOpen = ref(false)
const installTemplateOpen = ref(false)

const openSaveAsTemplate = () => {
  saveTemplateOpen.value = true
}

const openInstallTemplate = () => {
  installTemplateOpen.value = true
}

const onTemplateSaved = (e: { name: string; count: number }) => {
  pushToast(tr('templates.toast.saved', { name: e.name, count: e.count }), 'success')
}

const onTemplateInstalled = async (e: { installed: number; skipped: number }) => {
  pushToast(
    tr('templates.toast.installed', { installed: e.installed, skipped: e.skipped }),
    'success',
  )
  // Re-pull entity stores so the freshly-installed project-tier config shows up.
  await Promise.all([
    ws.hydrateAgentsFromSidecar(),
    ws.hydrateSkillsFromSidecar(),
    ws.hydrateHooksFromSidecar(),
    ws.hydrateRulesFromSidecar(),
    ws.hydrateCommandsFromSidecar(),
  ])
}

const onImported = (e: { imported: number; skipped: number }) => {
  pushToast(tr('import.toast.done', { imported: e.imported, skipped: e.skipped }), 'success')
}

const selectedId = ref<string | null>(ws.projects[0]?.id ?? null)
const creating = ref(false)
const editing = ref(false)
const searchQuery = ref('')
const confirmDelete = ref<Project | null>(null)
const mobilePane = ref<'list' | 'detail'>('list')
// Projects whose terminal is open. One dock stays mounted per id (v-show'd by
// selection) so a project's terminal — shell + typed content — survives
// switching to another project and back.
const terminalProjectIds = ref<string[]>([])

const busy = ref(false)
const busyLabel = ref('')
const lastProgressLine = ref('')
const error = ref('')

ws.hydrateProjectsFromSidecar().then(() => {
  if (!selectedId.value && ws.projects.length > 0) {
    selectedId.value = ws.projects[0]!.id
  }
})

// Sessions list per project is shown in the detail pane; hydrate once so it's
// populated. Guarded internally, so navigating to /sessions later won't re-load.
sessionsStore.hydrateFromSidecar()

if (sidecar.available) {
  let unlisten: (() => void) | null = null
  sidecar
    .onEvent((evt) => {
      if (evt.type === 'project.clone.progress') {
        const p = evt.payload as { line?: string } | null
        if (p?.line) lastProgressLine.value = p.line.trim()
      }
    })
    .then((fn) => {
      unlisten = fn
    })
    .catch(() => {})
  onBeforeUnmount(() => {
    unlisten?.()
  })
}

const selectedProject = computed<Project | null>(
  () => ws.projects.find((p) => p.id === selectedId.value) ?? null,
)

// ── Per-project session LLM defaults ──
const llmModalOpen = ref(false)
const llmSummary = computed<{ custom: boolean; text: string }>(() => {
  const ld = selectedProject.value?.llmDefaults
  if (!ld) return { custom: false, text: tr('project.llm.using_app_default') }
  const parts = [
    PROVIDER_LABEL[ld.provider],
    modelById(ld.modelId)?.label ?? ld.modelId,
    LEVEL_LABEL[ld.level],
  ]
  if (ld.accountId) {
    const acc = settingsStore.providers[ld.provider]?.accounts.find((a) => a.id === ld.accountId)
    if (acc) parts.push(acc.label)
  }
  return { custom: true, text: parts.join(' · ') }
})

// ── Per-project terminal ──
const terminalPathOf = (id: string): string => ws.projects.find((p) => p.id === id)?.path ?? ''
const isTerminalOpen = computed(
  () => !!selectedProject.value && terminalProjectIds.value.includes(selectedProject.value.id),
)
const toggleTerminal = () => {
  const id = selectedProject.value?.id
  if (!id) return
  terminalProjectIds.value = terminalProjectIds.value.includes(id)
    ? terminalProjectIds.value.filter((x) => x !== id)
    : [...terminalProjectIds.value, id]
}
const closeTerminal = (id: string) => {
  terminalProjectIds.value = terminalProjectIds.value.filter((x) => x !== id)
}

const filtered = computed(() => {
  const q = searchQuery.value.toLowerCase()
  if (!q) return ws.projects
  return ws.projects.filter(
    (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
  )
})

const isActive = (id: string) => selectedId.value === id && !creating.value

const projectTasks = computed<Task[]>(() =>
  selectedProject.value
    ? tasksStore.tasks.filter((tk) => tk.projectId === selectedProject.value!.id)
    : [],
)

const projectSessions = computed<Session[]>(() => {
  const proj = selectedProject.value
  if (!proj) return []
  return sessionsStore.sessions
    .filter((s) => s.projectId === proj.id)
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
})

const projectTaskStats = computed(() => ({
  total: projectTasks.value.length,
  running: projectTasks.value.filter((tk) => tk.status === 'running').length,
  waiting: projectTasks.value.filter((tk) => tk.status === 'waiting_approval').length,
  completed: projectTasks.value.filter((tk) => tk.status === 'completed').length,
}))

const statusColor = (tk: Task) => {
  if (tk.status === 'running') return t.value.text
  if (tk.status === 'waiting_approval') return t.value.warning
  if (tk.status === 'completed') return t.value.success
  if (tk.status === 'failed') return t.value.danger
  return t.value.textDim
}

const startCreate = () => {
  creating.value = true
  editing.value = false
  selectedId.value = null
  mobilePane.value = 'detail'
}

const cancelCreate = () => {
  creating.value = false
  selectedId.value = ws.projects[0]?.id ?? null
  mobilePane.value = 'list'
}

const selectProject = (id: string) => {
  selectedId.value = id
  creating.value = false
  editing.value = false
  mobilePane.value = 'detail'
}

const handleSave = async (payload: ProjectEditorSavePayload) => {
  if (busy.value) return
  error.value = ''
  try {
    if (payload.kind === 'update') {
      busy.value = true
      busyLabel.value = 'Saving…'
      const saved = await ws.updateProject(payload.project)
      selectedId.value = saved.id
      editing.value = false
    } else if (payload.kind === 'link') {
      busy.value = true
      busyLabel.value = 'Linking folder…'
      const saved = await ws.linkProject({
        name: payload.data.name,
        path: payload.data.path,
        description: payload.data.description,
        language: payload.data.language,
        gitRemote: payload.data.gitRemote,
        gitBranch: payload.data.gitBranch,
      })
      selectedId.value = saved.id
      creating.value = false
    } else {
      busy.value = true
      busyLabel.value = 'Cloning repository…'
      lastProgressLine.value = ''
      const saved = await ws.cloneProject({
        name: payload.data.name,
        destPath: payload.data.path,
        gitRemote: payload.data.gitRemote,
        description: payload.data.description,
        language: payload.data.language,
      })
      selectedId.value = saved.id
      creating.value = false
    }
    mobilePane.value = 'detail'
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
    busyLabel.value = ''
  }
}

const doDelete = async (id: string) => {
  await ws.deleteProject(id)
  if (selectedId.value === id) {
    selectedId.value = ws.projects[0]?.id ?? null
  }
  confirmDelete.value = null
  mobilePane.value = 'list'
}

const onBack = () => {
  mobilePane.value = 'list'
  creating.value = false
  editing.value = false
}

const openTask = (id: string) => {
  tasksStore.selectTask(id)
  navigateTo('/tasks')
}

const openSession = (id: string) => {
  sessionsStore.selectSession(id)
  navigateTo('/sessions')
}

// Create a fresh session scoped to this project, then jump to the Sessions
// page where the new (selected) session is rendered. Awaiting hydrate first
// avoids a later sessions.list response clobbering the just-created session.
const startSessionForProject = async () => {
  const proj = selectedProject.value
  if (!proj) return
  await sessionsStore.hydrateFromSidecar()
  sessionsStore.createSession({ title: '', projectId: proj.id })
  navigateTo('/sessions')
}

const openInEditor = (id: string) => navigateTo(`/projects/${id}/code`)

const contextMenu = ref<{ x: number; y: number; id: string } | null>(null)
const renamingId = ref<string | null>(null)
const renameValue = ref('')

const setRenameInputRef = (el: unknown) => {
  if (el instanceof HTMLInputElement) {
    nextTick(() => {
      el.focus()
      el.select()
    })
  }
}

const onContextMenu = (e: MouseEvent, id: string) => {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, id }
}

const openMenuFromButton = (e: MouseEvent, id: string) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  contextMenu.value = { x: rect.right, y: rect.bottom + 4, id }
}

const startRename = (id: string, current: string) => {
  renamingId.value = id
  renameValue.value = current
}

const commitRename = () => {
  const id = renamingId.value
  if (!id) return
  const trimmed = renameValue.value.trim()
  const item = ws.projects.find((p) => p.id === id)
  if (trimmed && item && trimmed !== item.name) {
    ws.updateProject({ ...item, name: trimmed }).catch((err) => {
      console.warn('[projects] rename failed', err)
    })
  }
  renamingId.value = null
}

const cancelRename = () => {
  renamingId.value = null
}

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const item = ws.projects.find((p) => p.id === ctx.id)
  if (!item) return []
  return [
    { label: 'Rename', icon: Edit3, action: () => startRename(item.id, item.name) },
    {
      label: 'Delete',
      icon: Trash2,
      danger: true,
      action: () => {
        confirmDelete.value = item
      },
    },
  ]
})
</script>
