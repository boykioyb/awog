<template>
  <MasterDetailShell
    v-model:mobile-pane="mobilePane"
    :selected-id="tasksStore.selectedTaskId"
    list-width="20rem"
  >
    <template #list>
      <!-- Single-row toolbar -->
      <div
        class="px-3 py-3 flex items-center gap-1.5"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <SearchInput v-model="searchQuery" class="flex-1" placeholder="Search..." />
        <button
          class="p-1.5 rounded-lg transition relative"
          :style="filterBtnStyle"
          title="Filters"
          @click="showFilters = !showFilters"
          @mouseenter="filterHover = true"
          @mouseleave="filterHover = false"
        >
          <ListFilter :size="13" />
          <div
            v-if="activeFilterCount > 0"
            class="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full flex items-center justify-center text-[12px] font-mono font-semibold leading-none"
            :style="{ background: t.accent, color: t.accentText }"
          >
            {{ activeFilterCount }}
          </div>
        </button>
        <AppButton variant="ghost" size="icon" title="New task" @click="showNewModal = true">
          <Plus :size="14" />
        </AppButton>
      </div>

      <!-- Collapsible filters drawer -->
      <div
        v-if="showFilters"
        class="px-3 py-2.5 space-y-2"
        :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgSubtle }"
      >
        <CompactSelect
          v-model="groupBy"
          label="Group by"
          :options="[
            { value: 'project', label: 'Project' },
            { value: 'status', label: 'Status' },
            { value: 'workflow', label: 'Workflow' },
            { value: 'none', label: 'None (flat)' },
          ]"
        />
        <CompactSelect v-model="projectFilter" label="Project" :options="projectOptions" />
        <CompactSelect
          v-model="statusFilter"
          label="Status"
          :options="[
            { value: 'all', label: 'All' },
            { value: 'running', label: 'Running' },
            { value: 'waiting_approval', label: 'Awaiting approval' },
            { value: 'queued', label: 'Queued' },
            { value: 'completed', label: 'Completed' },
            { value: 'failed', label: 'Failed' },
          ]"
        />
        <button
          v-if="activeFilterCount > 0"
          class="text-[1em] transition"
          :style="{ color: clearHover ? t.text : t.textDim }"
          @click="clearFilters"
          @mouseenter="clearHover = true"
          @mouseleave="clearHover = false"
        >
          Clear filters
        </button>
      </div>

      <!-- Task list -->
      <div class="flex-1 overflow-y-auto py-1">
        <EmptyView v-if="filtered.length === 0" :icon="Inbox" title="No tasks" />
        <template v-else>
          <div
            v-for="(group, gi) in grouped"
            :key="group.key"
            :style="{ marginTop: group.label && gi > 0 ? '4px' : '0' }"
          >
            <button
              v-if="group.label"
              class="w-full mx-1.5 px-2 py-1.5 flex items-center gap-1.5 rounded-lg transition"
              :style="{
                width: 'calc(100% - 12px)',
                color: t.textDim,
                background: pill(false, groupHover === group.key).background,
              }"
              @click="toggleGroup(group.key)"
              @mouseenter="groupHover = group.key"
              @mouseleave="groupHover = null"
            >
              <ChevronDown
                :size="11"
                :style="{
                  transform: collapsedGroups[group.key] ? 'rotate(-90deg)' : 'none',
                  transition: 'transform 0.15s',
                }"
              />
              <span
                class="text-[1em] uppercase tracking-wider font-semibold flex-1 text-left truncate"
                :style="{ color: t.text }"
              >
                {{ group.label }}
              </span>
              <span
                class="text-[12px] font-mono leading-none px-1.5 py-0.5 rounded-full"
                :style="{ color: t.textDim, background: t.bgInput }"
              >
                {{ group.tasks.length }}
              </span>
            </button>
            <template v-if="!collapsedGroups[group.key]">
              <TaskListItem
                v-for="tk in group.tasks"
                :key="tk.id"
                :task="tk"
                :selected="tasksStore.selectedTaskId === tk.id"
                :group-by="groupBy"
                :renaming="renamingId === tk.id"
                :rename-value="renameValue"
                @click="tasksStore.selectTask(tk.id)"
                @context-menu="(e) => onContextMenu(e, tk.id)"
                @open-menu="(e) => openMenuFromButton(e, tk.id)"
                @start-rename="startRename(tk.id, tk.title)"
                @commit-rename="commitRename"
                @cancel-rename="cancelRename"
                @update:rename-value="renameValue = $event"
              />
            </template>
          </div>
        </template>
      </div>
    </template>

    <template #detail>
      <TaskDetail
        v-if="tasksStore.selectedTask"
        :task="tasksStore.selectedTask"
        @open-file="onOpenFile"
        @delete="askDelete(tasksStore.selectedTask.id)"
      />
    </template>

    <template #empty-detail>
      <div class="flex-1 flex items-center justify-center text-[1em]" :style="{ color: t.textDim }">
        Select a task
      </div>
    </template>
  </MasterDetailShell>

  <NewTaskModal v-if="showNewModal" @save="onSaveTask" @cancel="showNewModal = false" />

  <ConfirmDeleteModal
    v-if="pendingDeleteId"
    title="Delete task?"
    :description="`Task '${pendingDeleteName}' sẽ bị xóa vĩnh viễn.`"
    @confirm="confirmDelete"
    @cancel="pendingDeleteId = null"
  />

  <ContextMenu
    v-if="contextMenu"
    :x="contextMenu.x"
    :y="contextMenu.y"
    :items="menuItems"
    @close="contextMenu = null"
  />
</template>

<script setup lang="ts">
import { Plus, ChevronDown, Inbox, ListFilter, Edit3, Trash2 } from 'lucide-vue-next'
import type { Task, TaskSource } from '~/types'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'
import { STATUS_META } from '~/utils/status-meta'

const { t } = useTheme()
const { pill } = useGlass()
// Projects stay in the workspace store; tasks + workflows are their own live stores.
const store = useWorkspaceStore()
const tasksStore = useTasksStore()
const workflowsStore = useWorkflowsStore()

onMounted(async () => {
  // TaskDetail's pipeline resolves agent name/role from the workspace store —
  // hydrate agents + skills (with project ids for project-tier) on landing here.
  await store.hydrateProjectsFromSidecar()
  const ids = store.projects.map((p) => p.id)
  void store.hydrateAgentsFromSidecar(ids)
  void store.hydrateSkillsFromSidecar(ids)
})

const statusFilter = ref('all')
const projectFilter = ref('all')
const groupBy = ref('project')
const searchQuery = ref('')
const collapsedGroups = ref<Record<string, boolean>>({})
const showFilters = ref(false)
const showNewModal = ref(false)
const mobilePane = ref<'list' | 'detail'>('list')
const filterHover = ref(false)
const clearHover = ref(false)
const groupHover = ref<string | null>(null)

const tasks = computed(() => tasksStore.tasks)
const projects = computed(() => store.projects)
const workflows = computed(() => workflowsStore.workflows)

const filtered = computed(() =>
  tasks.value.filter((tk) => {
    if (statusFilter.value !== 'all' && tk.status !== statusFilter.value) return false
    if (projectFilter.value !== 'all' && tk.projectId !== projectFilter.value) return false
    if (
      searchQuery.value &&
      !tk.title.toLowerCase().includes(searchQuery.value.toLowerCase()) &&
      !tk.id.includes(searchQuery.value.toLowerCase())
    )
      return false
    return true
  }),
)

interface Group {
  key: string
  label: string | null
  tasks: Task[]
}

const grouped = computed<Group[]>(() => {
  if (groupBy.value === 'none') {
    return [{ key: '_all', label: null, tasks: filtered.value }]
  }
  if (groupBy.value === 'project') {
    const map = new Map<string, Group>()
    projects.value.forEach((p) => map.set(p.id, { key: p.id, label: p.name, tasks: [] }))
    map.set('_none', { key: '_none', label: 'No project', tasks: [] })
    filtered.value.forEach((tk) => {
      ;(map.get(tk.projectId) || map.get('_none')!).tasks.push(tk)
    })
    return Array.from(map.values()).filter((g) => g.tasks.length > 0)
  }
  if (groupBy.value === 'status') {
    const order = ['running', 'waiting_approval', 'queued', 'completed', 'failed']
    const map = new Map<string, Group>()
    order.forEach((s) =>
      map.set(s, {
        key: s,
        label: STATUS_META[s as keyof typeof STATUS_META]?.label || s,
        tasks: [],
      }),
    )
    filtered.value.forEach((tk) => {
      const b = map.get(tk.status)
      if (b) b.tasks.push(tk)
    })
    return Array.from(map.values()).filter((g) => g.tasks.length > 0)
  }
  if (groupBy.value === 'workflow') {
    const map = new Map<string, Group>()
    workflows.value.forEach((w) => map.set(w.id, { key: w.id, label: w.name, tasks: [] }))
    filtered.value.forEach((tk) => {
      const b = map.get(tk.workflowId)
      if (b) b.tasks.push(tk)
    })
    return Array.from(map.values()).filter((g) => g.tasks.length > 0)
  }
  return [{ key: '_all', label: null, tasks: filtered.value }]
})

const toggleGroup = (key: string) => {
  collapsedGroups.value = { ...collapsedGroups.value, [key]: !collapsedGroups.value[key] }
}

const activeFilterCount = computed(
  () => (statusFilter.value !== 'all' ? 1 : 0) + (projectFilter.value !== 'all' ? 1 : 0),
)

const clearFilters = () => {
  statusFilter.value = 'all'
  projectFilter.value = 'all'
}

const filterActiveLike = computed(() => showFilters.value || activeFilterCount.value > 0)

const filterBtnStyle = computed(() => {
  const active = filterActiveLike.value
  const hover = filterHover.value
  let background: string
  if (active) background = t.value.bgActive
  else if (hover) background = t.value.bgHover
  else background = 'transparent'
  const color = active || hover ? t.value.text : t.value.textDim
  return {
    background,
    color,
    border: `1px solid ${active ? t.value.borderStrong : 'transparent'}`,
  }
})

const projectOptions = computed(() => [
  { value: 'all', label: `All projects (${tasks.value.length})` },
  ...projects.value.map((p) => ({
    value: p.id,
    label: `${p.name} (${tasks.value.filter((tk) => tk.projectId === p.id).length})`,
  })),
])

const onSaveTask = (data: {
  title: string
  description: string
  source: TaskSource
  workflowId: string
  projectId: string
}) => {
  tasksStore.createTask(data)
  showNewModal.value = false
}

const onOpenFile = (fileName: string, _content: string) => {
  if (!tasksStore.selectedTaskId) return
  navigateTo(`/edit/${tasksStore.selectedTaskId}?file=${encodeURIComponent(fileName)}`)
}

watch(
  () => tasksStore.selectedTaskId,
  (id) => {
    if (id) mobilePane.value = 'detail'
  },
)

const contextMenu = ref<{ x: number; y: number; id: string } | null>(null)
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const pendingDeleteId = ref<string | null>(null)

const pendingDeleteName = computed(
  () => tasksStore.tasks.find((tk) => tk.id === pendingDeleteId.value)?.title ?? '',
)

const onContextMenu = (e: MouseEvent, id: string) => {
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
  if (!id) {
    return
  }
  const trimmed = renameValue.value.trim()
  const task = tasksStore.tasks.find((tk) => tk.id === id)
  if (trimmed && task && trimmed !== task.title) {
    tasksStore.renameTask(id, trimmed)
  }
  renamingId.value = null
}

const cancelRename = () => {
  renamingId.value = null
}

const askDelete = (id: string) => {
  pendingDeleteId.value = id
}

const confirmDelete = () => {
  if (!pendingDeleteId.value) return
  tasksStore.deleteTask(pendingDeleteId.value)
  pendingDeleteId.value = null
}

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const task = tasksStore.tasks.find((tk) => tk.id === ctx.id)
  if (!task) return []
  return [
    { label: 'Rename', icon: Edit3, action: () => startRename(task.id, task.title) },
    {
      label: 'Delete',
      icon: Trash2,
      danger: true,
      action: () => {
        pendingDeleteId.value = task.id
      },
    },
  ]
})
</script>
