<template>
  <div
    class="relative flex flex-col h-full overflow-hidden flex-shrink-0"
    :style="{
      width: collapsed ? '40px' : `${width}px`,
      background: parts.bg,
      backdropFilter: parts.blur,
      borderRight: `1px solid ${parts.border}`,
      transition: dragging ? 'none' : 'width 150ms ease',
    }"
  >
    <!-- Collapse toggle -->
    <div
      class="flex items-center px-2 py-2 flex-shrink-0"
      :style="{ borderBottom: `1px solid ${t.border}` }"
      :class="collapsed ? 'justify-center' : 'justify-between'"
    >
      <span
        v-if="!collapsed"
        class="text-[1em] uppercase tracking-wider px-2"
        :style="{ color: t.textDim }"
      >
        {{ tr('git.sidebar.title') }}
      </span>
      <button
        class="p-1 rounded transition"
        :title="collapsed ? tr('git.sidebar.expand') : tr('git.sidebar.collapse')"
        :style="{ color: t.textDim }"
        @click="toggleCollapse"
      >
        <PanelLeftClose v-if="!collapsed" :size="14" />
        <PanelLeftOpen v-else :size="14" />
      </button>
    </div>

    <!-- Branch search (local + remote) -->
    <div
      v-if="!collapsed"
      class="px-2 py-2 flex-shrink-0"
      :style="{ borderBottom: `1px solid ${t.border}` }"
    >
      <SearchInput v-model="branchQuery" :placeholder="tr('git.sidebar.search_branches')" />
    </div>

    <!-- Scroll body -->
    <div v-if="!collapsed" class="flex-1 overflow-y-auto py-1">
      <!-- Top items -->
      <GitSidebarItem
        :active="isActive({ kind: 'local-changes' })"
        :label="tr('git.sidebar.local_changes')"
        :icon="FileEdit"
        :badge="dirtyCount > 0 ? dirtyCount : null"
        :badge-tone="dirtyToneForBadge"
        @select="select({ kind: 'local-changes' })"
      />
      <GitSidebarItem
        :active="isActive({ kind: 'all-commits' })"
        :label="tr('git.sidebar.all_commits')"
        :icon="History"
        @select="select({ kind: 'all-commits' })"
      />

      <!-- Branches -->
      <GitSidebarSection
        :label="tr('git.sidebar.branches')"
        :icon="GitBranch"
        :open="open.branches || hasBranchQuery"
        :count="localBranches.length"
        :action-icon="Plus"
        :action-title="tr('git.branches.new')"
        @toggle="open.branches = !open.branches"
        @action="emit('create-branch')"
      >
        <template v-if="branchRows.length === 0">
          <div
            class="px-3 py-1.5 text-[1em] italic"
            :style="{ color: t.textFaint, paddingLeft: '28px' }"
          >
            {{ hasBranchQuery ? tr('git.sidebar.no_match') : tr('git.sidebar.empty') }}
          </div>
        </template>
        <template v-for="row in branchRows" :key="`${row.kind}:${row.id}`">
          <!-- Folder row: groups branches sharing a `/` prefix (sora-hoa/…) -->
          <button
            v-if="row.kind === 'folder'"
            class="flex items-center gap-1.5 w-full py-1 pr-2 transition select-none"
            :style="{
              paddingLeft: `${8 + (row.depth + 1) * 14}px`,
              cursor: 'pointer',
              background: 'transparent',
            }"
            @click="toggleBranchFolder(row.id)"
          >
            <component
              :is="collapsedBranchFolders.has(row.id) ? ChevronRight : ChevronDown"
              :size="11"
              :style="{ color: t.textDim, flexShrink: 0 }"
            />
            <Folder :size="12" :style="{ color: t.textDim, flexShrink: 0 }" />
            <span
              class="text-[1em] flex-1 truncate text-left font-mono"
              :style="{ color: t.textMuted }"
            >
              {{ row.displayName }}
            </span>
            <span
              class="text-[12px] flex-shrink-0 font-mono leading-none"
              :style="{ color: t.textFaint }"
            >
              {{ row.leafCount }}
            </span>
          </button>
          <!-- Branch leaf -->
          <GitSidebarItem
            v-else
            :active="isActive({ kind: 'branch', name: row.branch.name })"
            :label="row.displayName"
            :icon="row.branch.isCurrent ? GitBranchPlus : GitBranch"
            :icon-tone="row.branch.isCurrent ? 'accent' : 'dim'"
            :indent="row.depth + 1"
            :hint="branchHint(row.branch)"
            :highlight="row.branch.isCurrent"
            mono
            @select="select({ kind: 'branch', name: row.branch.name })"
            @context="(ev: MouseEvent) => emit('context-branch', ev, row.branch)"
          />
        </template>
      </GitSidebarSection>

      <!-- Remotes -->
      <GitSidebarSection
        :label="tr('git.sidebar.remotes')"
        :icon="Cloud"
        :open="open.remotes || hasBranchQuery"
        :count="remoteCount"
        @toggle="open.remotes = !open.remotes"
      >
        <template v-if="visibleRemotes.length === 0">
          <div
            class="px-3 py-1.5 text-[1em] italic"
            :style="{ color: t.textFaint, paddingLeft: '28px' }"
          >
            {{ hasBranchQuery ? tr('git.sidebar.no_match') : tr('git.sidebar.empty') }}
          </div>
        </template>
        <template v-for="r in visibleRemotes" :key="r.name">
          <GitSidebarItem
            :active="isActive({ kind: 'remote', name: r.name })"
            :label="r.name"
            :icon="Cloud"
            :indent="1"
            mono
            @select="select({ kind: 'remote', name: r.name })"
          />
          <GitSidebarItem
            v-for="rb in remoteBranchesFor(r.name)"
            :key="`rb:${rb.name}`"
            :active="isActive({ kind: 'branch', name: rb.name })"
            :label="stripRemotePrefix(rb.name, r.name)"
            :icon="GitBranch"
            :indent="2"
            mono
            @select="select({ kind: 'branch', name: rb.name })"
            @context="(ev: MouseEvent) => emit('context-branch', ev, rb)"
          />
        </template>
      </GitSidebarSection>

      <!-- Tags (placeholder — no data wire yet) -->
      <GitSidebarSection
        :label="tr('git.sidebar.tags')"
        :icon="Tag"
        :open="open.tags"
        :count="0"
        @toggle="open.tags = !open.tags"
      >
        <div
          class="px-3 py-1.5 text-[1em] italic"
          :style="{ color: t.textFaint, paddingLeft: '28px' }"
        >
          {{ tr('git.sidebar.empty') }}
        </div>
      </GitSidebarSection>

      <!-- Stashes -->
      <GitSidebarSection
        :label="tr('git.sidebar.stashes')"
        :icon="Archive"
        :open="open.stashes"
        :count="store.stashes.length"
        :action-icon="Plus"
        :action-title="tr('git.stash.title_save')"
        @toggle="open.stashes = !open.stashes"
        @action="emit('save-stash')"
      >
        <template v-if="store.stashes.length === 0">
          <div
            class="px-3 py-1.5 text-[1em] italic"
            :style="{ color: t.textFaint, paddingLeft: '28px' }"
          >
            {{ tr('git.sidebar.empty') }}
          </div>
        </template>
        <GitSidebarItem
          v-for="s in store.stashes"
          :key="`stash:${s.index}`"
          :active="isActive({ kind: 'stash', index: s.index })"
          :label="stashLabel(s)"
          :icon="Archive"
          :indent="1"
          @select="select({ kind: 'stash', index: s.index })"
        />
      </GitSidebarSection>

      <!-- Submodules (placeholder) -->
      <GitSidebarSection
        :label="tr('git.sidebar.submodules')"
        :icon="Boxes"
        :open="open.submodules"
        :count="0"
        @toggle="open.submodules = !open.submodules"
      >
        <div
          class="px-3 py-1.5 text-[1em] italic"
          :style="{ color: t.textFaint, paddingLeft: '28px' }"
        >
          {{ tr('git.sidebar.empty') }}
        </div>
      </GitSidebarSection>
    </div>

    <!-- Collapsed quick icons -->
    <div v-else class="flex-1 overflow-hidden flex flex-col items-center py-2 gap-1">
      <button
        v-for="quick in quickIcons"
        :key="quick.key"
        class="p-2 rounded transition"
        :title="quick.title"
        :style="{
          color: isActive(quick.section) ? t.accent : t.textDim,
          background: isActive(quick.section) ? t.bgHover : 'transparent',
        }"
        @click="select(quick.section)"
      >
        <component :is="quick.icon" :size="14" />
      </button>
    </div>

    <!-- Resize handle (right edge) -->
    <div
      v-if="!collapsed"
      class="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:opacity-100 opacity-0 transition"
      :style="{ background: dragging ? t.accent : t.borderStrong, marginRight: '-2px' }"
      :class="{ 'opacity-100': dragging }"
      @mousedown="onDragStart"
    />
  </div>
</template>

<script setup lang="ts">
import {
  Archive,
  Boxes,
  ChevronDown,
  ChevronRight,
  Cloud,
  FileEdit,
  Folder,
  GitBranch,
  GitBranchPlus,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Tag,
} from 'lucide-vue-next'
import type { GitBranch as GitBranchType, GitStashEntry } from '~/types'
import { buildBranchTree, flattenTree } from '~/utils/branch-tree'
import type { GitSection } from './git-section'
import { sectionKey } from './git-section'

type Props = {
  selected: GitSection
  dirtyCount: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:selected': [section: GitSection]
  'create-branch': []
  'save-stash': []
  'context-branch': [event: MouseEvent, branch: GitBranchType]
}>()

const { t } = useTheme()
const { parts } = useGlass()
const { t: tr } = useI18n()
const store = useGitStore()

// ─── Selection ──────────────────────────────────────────────────────────
const isActive = (s: GitSection) => sectionKey(props.selected) === sectionKey(s)
const select = (s: GitSection) => emit('update:selected', s)

// ─── Branch search (local + remote) ───────────────────────────────────────
const branchQuery = ref('')
const hasBranchQuery = computed(() => branchQuery.value.trim().length > 0)
const matchBranch = (name: string) =>
  name.toLowerCase().includes(branchQuery.value.trim().toLowerCase())

// ─── Branches ────────────────────────────────────────────────────────────
const localBranches = computed(() => store.branches.filter((b: GitBranchType) => !b.isRemote))
const filteredLocalBranches = computed(() =>
  hasBranchQuery.value
    ? localBranches.value.filter((b) => matchBranch(b.name))
    : localBranches.value,
)

// Group branches sharing a `/` prefix into collapsible folders (e.g. all
// `sora-hoa/*` under one `sora-hoa` folder). Singleton chains stay flat.
// Folders are collapsed by default — we track which the user has expanded, so
// any folder (incl. nested) starts closed until clicked. While searching, every
// folder is forced open so matches are visible.
const branchTree = computed(() => buildBranchTree(filteredLocalBranches.value))
const expandedBranchFolders = ref<Set<string>>(new Set())
const collapsedBranchFolders = computed(() => {
  if (hasBranchQuery.value) return new Set<string>()
  const collapsed = new Set<string>()
  flattenTree(branchTree.value, new Set<string>()).forEach((row) => {
    if (row.kind === 'folder' && !expandedBranchFolders.value.has(row.id)) collapsed.add(row.id)
  })
  return collapsed
})
const branchRows = computed(() => flattenTree(branchTree.value, collapsedBranchFolders.value))
const toggleBranchFolder = (id: string) => {
  const next = new Set(expandedBranchFolders.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedBranchFolders.value = next
}
const remoteBranches = computed(() => store.branches.filter((b: GitBranchType) => b.isRemote))
const remoteCount = computed(() => store.remotes.length + remoteBranches.value.length)

const remoteBranchesFor = (remoteName: string) =>
  remoteBranches.value.filter(
    (b: GitBranchType) =>
      b.name.startsWith(`${remoteName}/`) && (!hasBranchQuery.value || matchBranch(b.name)),
  )

// While searching, hide remote headers that have no matching branches.
const visibleRemotes = computed(() =>
  hasBranchQuery.value
    ? store.remotes.filter((r) => remoteBranchesFor(r.name).length > 0)
    : store.remotes,
)

const stripRemotePrefix = (full: string, remoteName: string) =>
  full.startsWith(`${remoteName}/`) ? full.slice(remoteName.length + 1) : full

const branchHint = (b: GitBranchType): string | null => {
  if (b.isCurrent) return tr('git.sidebar.current')
  const parts: string[] = []
  if (b.ahead > 0) parts.push(`↑${b.ahead}`)
  if (b.behind > 0) parts.push(`↓${b.behind}`)
  return parts.length > 0 ? parts.join(' ') : null
}

// ─── Stashes ─────────────────────────────────────────────────────────────
const stashLabel = (s: GitStashEntry) => {
  // Strip leading "WIP on <branch>: " noise so each row reads as the user's
  // own message when present.
  const m = s.message.match(/^(?:WIP on [^:]+: |On [^:]+: )(.*)$/)
  return m && m[1] ? m[1] : s.message
}

// ─── Dirty badge tone ────────────────────────────────────────────────────
const dirtyToneForBadge = computed<'warning' | 'danger'>(() =>
  store.hasConflict ? 'danger' : 'warning',
)

// ─── Open sections ───────────────────────────────────────────────────────
const STORAGE_OPEN = 'awog.git.sidebar.open'
const STORAGE_WIDTH = 'awog.git.sidebar.width'
const STORAGE_COLLAPSED = 'awog.git.sidebar.collapsed'

type OpenMap = {
  branches: boolean
  remotes: boolean
  tags: boolean
  stashes: boolean
  submodules: boolean
}

const defaultOpen = (): OpenMap => ({
  branches: true,
  remotes: true,
  tags: false,
  stashes: true,
  submodules: false,
})

const readOpen = (): OpenMap => {
  if (typeof window === 'undefined') return defaultOpen()
  try {
    const raw = window.localStorage.getItem(STORAGE_OPEN)
    if (!raw) return defaultOpen()
    const parsed = JSON.parse(raw) as Partial<OpenMap>
    return { ...defaultOpen(), ...parsed }
  } catch {
    return defaultOpen()
  }
}

const open = ref<OpenMap>(readOpen())

watch(
  open,
  (next) => {
    try {
      window.localStorage.setItem(STORAGE_OPEN, JSON.stringify(next))
    } catch {
      // ignore — quota / private mode
    }
  },
  { deep: true },
)

// ─── Width + collapse ────────────────────────────────────────────────────
const MIN_WIDTH = 200
const MAX_WIDTH = 480
const DEFAULT_WIDTH = 260

const readWidth = (): number => {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  const raw = window.localStorage.getItem(STORAGE_WIDTH)
  const n = Number(raw)
  return Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH ? n : DEFAULT_WIDTH
}

const readCollapsed = (): boolean => {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(STORAGE_COLLAPSED) === '1'
}

const width = ref<number>(readWidth())
const collapsed = ref<boolean>(readCollapsed())
const dragging = ref(false)

const toggleCollapse = () => {
  collapsed.value = !collapsed.value
  try {
    window.localStorage.setItem(STORAGE_COLLAPSED, collapsed.value ? '1' : '0')
  } catch {
    // ignore
  }
}

let dragStartX = 0
let dragStartWidth = 0
const onDragMove = (e: MouseEvent) => {
  const delta = e.clientX - dragStartX
  width.value = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, dragStartWidth + delta))
}
const onDragEnd = () => {
  if (!dragging.value) return
  dragging.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  try {
    window.localStorage.setItem(STORAGE_WIDTH, String(width.value))
  } catch {
    // ignore
  }
}
const onDragStart = (e: MouseEvent) => {
  e.preventDefault()
  dragStartX = e.clientX
  dragStartWidth = width.value
  dragging.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
})

// ─── Collapsed quick icons ───────────────────────────────────────────────
const quickIcons = computed(() => [
  {
    key: 'local-changes',
    icon: FileEdit,
    title: tr('git.sidebar.local_changes'),
    section: { kind: 'local-changes' as const },
  },
  {
    key: 'all-commits',
    icon: History,
    title: tr('git.sidebar.all_commits'),
    section: { kind: 'all-commits' as const },
  },
])
</script>
