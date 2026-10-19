<template>
  <div
    class="flex flex-col overflow-hidden border-r bg-sidebar text-sidebar-foreground"
    :style="{
      flex: `0 0 ${collapsed ? 44 : sideW}px`,
      width: `${collapsed ? 44 : sideW}px`,
    }"
  >
    <!-- Header: title + collapse toggle -->
    <!-- Cùng 46px + hairline inset với toolbar GitPageHeader bên cạnh: hai vạch phải
         nằm trên một dòng quét. -->
    <div
      class="flex h-11.5 flex-none items-center justify-between gap-2 px-2.5 shadow-[inset_0_-1px_0_var(--color-border)]"
    >
      <span v-if="!collapsed" class="text-xs text-faint">{{ t('git.sidebar.title') }}</span>
      <Button
        variant="ghost"
        size="iconSm"
        class="size-6 flex-none text-muted-foreground"
        :title="collapsed ? t('git.sidebar.expand') : t('git.sidebar.collapse')"
        :aria-label="collapsed ? t('git.sidebar.expand') : t('git.sidebar.collapse')"
        @click="emit('toggle-collapse')"
      >
        <Icon name="panel" class="size-3.5" />
      </Button>
    </div>

    <!-- Collapsed quick rail -->
    <template v-if="collapsed">
      <div class="flex flex-col items-center py-2">
        <Button
          variant="ghost"
          size="iconSm"
          :class="[RAIL, { [ON]: section.kind === 'local-changes' }]"
          :title="t('git.sidebar.localChanges')"
          :aria-label="t('git.sidebar.localChanges')"
          @click="emit('update:section', { kind: 'local-changes' })"
        >
          <Icon name="edit" class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          :class="[RAIL, { [ON]: section.kind === 'all-commits' }]"
          :title="t('git.sidebar.allCommits')"
          :aria-label="t('git.sidebar.allCommits')"
          @click="emit('update:section', { kind: 'all-commits' })"
        >
          <Icon name="clock" class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          :class="[RAIL, { [ON]: section.kind === 'command-log' }]"
          :title="t('git.sidebar.commandLog')"
          :aria-label="t('git.sidebar.commandLog')"
          @click="emit('update:section', { kind: 'command-log' })"
        >
          <Icon name="terminal" class="size-3.5" />
        </Button>
      </div>
    </template>

    <template v-else>
      <!-- Branch search -->
      <div class="flex flex-none items-center gap-2 border-b px-2.5 py-2">
        <Icon name="search" class="size-3.5 text-muted-foreground" />
        <Input
          unstyled
          class="min-w-0 flex-1 text-sm placeholder:text-muted-foreground"
          :model-value="search"
          :placeholder="t('git.sidebar.searchBranches')"
          @update:model-value="emit('update:search', $event)"
        />
      </div>

      <!-- Scroll body -->
      <div class="flex-1 overflow-y-auto p-1.5">
        <!-- Local Changes -->
        <div
          :class="[ITEM, { [ON]: section.kind === 'local-changes' }]"
          @click="emit('update:section', { kind: 'local-changes' })"
        >
          <Icon name="edit" class="size-3.5" />
          <span class="flex-1">{{ t('git.sidebar.localChanges') }}</span>
          <Badge
            v-if="dirtyCount > 0"
            variant="outline"
            class="rounded-sm border-warning/40 bg-warning/10 px-1.5 py-0 font-semibold text-warning tabular-nums"
          >
            {{ dirtyCount }}
          </Badge>
        </div>

        <!-- All Commits -->
        <div
          :class="[ITEM, { [ON]: section.kind === 'all-commits' }]"
          @click="emit('update:section', { kind: 'all-commits' })"
        >
          <Icon name="clock" class="size-3.5" />
          <span class="flex-1">{{ t('git.sidebar.allCommits') }}</span>
        </div>

        <!-- Command log — what git actually ran -->
        <div
          :class="[ITEM, { [ON]: section.kind === 'command-log' }]"
          @click="emit('update:section', { kind: 'command-log' })"
        >
          <Icon name="terminal" class="size-3.5" />
          <span class="flex-1">{{ t('git.sidebar.commandLog') }}</span>
        </div>

        <!-- Branches -->
        <div :class="SEC" @click="emit('toggle-section', 'branches')">
          <Icon name="chev" :class="[CHEV, { '-rotate-90': !sectionOpenWithSearch.branches }]" />
          <Icon name="branch" class="size-3" />
          <span class="flex-1">{{ t('git.sidebar.branches') }}</span>
          <span :class="ZONE_COUNT">{{ localBranches.length }}</span>
          <Button
            variant="ghost"
            size="iconSm"
            :class="SEC_ADD"
            :title="t('git.sidebar.newBranch')"
            :aria-label="t('git.sidebar.newBranch')"
            @click.stop="emit('new-branch')"
          >
            <Icon name="plus" class="size-3" />
          </Button>
        </div>

        <template v-if="sectionOpenWithSearch.branches">
          <!-- Pinned branches (floated to top) -->
          <template v-if="pinnedBranches.length">
            <!-- Nhãn nhóm con "Đã ghim" trong Branches, thụt như một mục con. -->
            <div class="pt-1.5 pr-2 pb-0.5 pl-5.5 text-xs text-faint">
              {{ t('git.sidebar.pinned') }}
            </div>
            <div
              v-for="b in pinnedBranches"
              :key="`pin:${b.name}`"
              :class="[ITEM, 'group/branch pl-5.5', { [ON]: isBranchActive(b.name) }]"
              @click="emit('update:section', { kind: 'branch', name: b.name })"
              @contextmenu.prevent="emit('context-branch', $event, b)"
            >
              <Icon name="branch" class="size-3" :class="{ 'text-primary': b.current }" />
              <span
                class="min-w-0 flex-1 truncate"
                :class="{ 'font-semibold text-primary': b.current }"
              >
                {{ b.name }}
              </span>
              <span v-if="branchHint(b)" :class="[HINT, { 'text-primary': b.current }]">
                {{ branchHint(b) }}
              </span>
              <Button
                variant="ghost"
                size="iconSm"
                :class="[PIN, PIN_ON]"
                :title="t('git.ctx.unpin')"
                :aria-label="t('git.ctx.unpin')"
                @click.stop="emit('toggle-pin', b.name)"
              >
                <Icon name="pin" class="size-3" />
              </Button>
            </div>
          </template>

          <div v-if="!branchRows.length && !pinnedBranches.length" :class="EMPTY">
            {{ search ? t('git.sidebar.noMatch') : t('git.sidebar.empty') }}
          </div>
          <template v-for="row in branchRows" :key="row.key">
            <div
              v-if="row.kind === 'folder'"
              :class="[ITEM, 'hover:bg-accent hover:text-muted-foreground']"
              :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
              @click="emit('toggle-branch-folder', row.name)"
            >
              <Icon name="chev" :class="[CHEV, { '-rotate-90': row.collapsed }]" />
              <Icon name="folder" class="size-3" />
              <span class="flex-1">{{ row.label }}/</span>
              <span :class="HINT">{{ row.count }}</span>
            </div>
            <div
              v-else
              :class="[ITEM, 'group/branch', { [ON]: isBranchActive(row.branch.name) }]"
              :style="{ paddingLeft: `${8 + (row.depth + 1) * 14}px` }"
              @click="emit('update:section', { kind: 'branch', name: row.branch.name })"
              @contextmenu.prevent="emit('context-branch', $event, row.branch)"
            >
              <Icon name="branch" class="size-3" :class="{ 'text-primary': row.branch.current }" />
              <span
                class="min-w-0 flex-1 truncate"
                :class="{ 'font-semibold text-primary': row.branch.current }"
              >
                {{ row.label }}
              </span>
              <span
                v-if="branchHint(row.branch)"
                :class="[HINT, { 'text-primary': row.branch.current }]"
              >
                {{ branchHint(row.branch) }}
              </span>
              <Button
                variant="ghost"
                size="iconSm"
                :class="[PIN, { [PIN_ON]: isPinned(row.branch.name) }]"
                :title="isPinned(row.branch.name) ? t('git.ctx.unpin') : t('git.ctx.pin')"
                :aria-label="isPinned(row.branch.name) ? t('git.ctx.unpin') : t('git.ctx.pin')"
                @click.stop="emit('toggle-pin', row.branch.name)"
              >
                <Icon name="pin" class="size-3" />
              </Button>
            </div>
          </template>
        </template>

        <!-- Remotes -->
        <div :class="SEC" @click="emit('toggle-section', 'remotes')">
          <Icon name="chev" :class="[CHEV, { '-rotate-90': !sectionOpenWithSearch.remotes }]" />
          <Icon name="conn" class="size-3" />
          <span class="flex-1">{{ t('git.sidebar.remotes') }}</span>
          <span :class="ZONE_COUNT">{{ remoteCount }}</span>
          <Button
            variant="ghost"
            size="iconSm"
            :class="SEC_ADD"
            :title="t('git.remote.add')"
            :aria-label="t('git.remote.add')"
            @click.stop="emit('add-remote')"
          >
            <Icon name="plus" class="size-3" />
          </Button>
        </div>
        <template v-if="sectionOpenWithSearch.remotes">
          <div v-if="!visibleRemotes.length" :class="EMPTY">
            {{ search ? t('git.sidebar.noMatch') : t('git.sidebar.empty') }}
          </div>
          <template v-for="r in visibleRemotes" :key="r.name">
            <div
              :class="[ITEM, 'pl-5.5', { [ON]: isActive({ kind: 'remote', name: r.name }) }]"
              @click="emit('update:section', { kind: 'remote', name: r.name })"
              @contextmenu.prevent="emit('context-remote', $event, r.name)"
            >
              <Icon name="conn" class="size-3" />
              <span class="min-w-0 flex-1 truncate">{{ r.name }}</span>
            </div>
            <div
              v-for="rb in remoteBranchesFor(r.name)"
              :key="rb.name"
              :class="[ITEM, 'pl-10', { [ON]: isBranchActive(rb.name) }]"
              @click="emit('update:section', { kind: 'branch', name: rb.name })"
              @contextmenu.prevent="emit('context-branch', $event, rb)"
            >
              <Icon name="branch" class="size-3" />
              <span class="min-w-0 flex-1 truncate">
                {{ stripRemotePrefix(rb.name, r.name) }}
              </span>
            </div>
          </template>
        </template>

        <!-- Tags -->
        <div :class="SEC" @click="emit('toggle-section', 'tags')">
          <Icon name="chev" :class="[CHEV, { '-rotate-90': !secOpen.tags }]" />
          <Icon name="git" class="size-3" />
          <span class="flex-1">{{ t('git.sidebar.tags') }}</span>
          <span :class="ZONE_COUNT">{{ tags.length }}</span>
          <Button
            variant="ghost"
            size="iconSm"
            :class="SEC_ADD"
            :title="t('git.sidebar.newTag')"
            :aria-label="t('git.sidebar.newTag')"
            @click.stop="emit('new-tag')"
          >
            <Icon name="plus" class="size-3" />
          </Button>
        </div>
        <template v-if="secOpen.tags">
          <div v-if="!tags.length" :class="EMPTY">{{ t('git.sidebar.empty') }}</div>
          <div
            v-for="tag in tags"
            :key="tag"
            :class="[ITEM, 'pl-5.5', { [ON]: isTagActive(tag) }]"
            @click="emit('update:section', { kind: 'tag', name: tag })"
            @contextmenu.prevent="emit('context-tag', $event, tag)"
          >
            <Icon name="git" class="size-3" />
            <span class="min-w-0 flex-1 truncate">{{ tag }}</span>
          </div>
        </template>

        <!-- Stashes -->
        <div :class="SEC" @click="emit('toggle-section', 'stashes')">
          <Icon name="chev" :class="[CHEV, { '-rotate-90': !secOpen.stashes }]" />
          <Icon name="clip" class="size-3" />
          <span class="flex-1">{{ t('git.sidebar.stashes') }}</span>
          <span :class="ZONE_COUNT">{{ stashes.length }}</span>
          <Button
            variant="ghost"
            size="iconSm"
            :class="SEC_ADD"
            :title="t('git.stash.save')"
            :aria-label="t('git.stash.save')"
            @click.stop="emit('save-stash')"
          >
            <Icon name="plus" class="size-3" />
          </Button>
        </div>
        <template v-if="secOpen.stashes">
          <div v-if="!stashes.length" :class="EMPTY">{{ t('git.sidebar.empty') }}</div>
          <div
            v-for="s in stashes"
            :key="s.index"
            :class="[ITEM, 'pl-5.5', { [ON]: isActive({ kind: 'stash', index: s.index }) }]"
            @click="emit('update:section', { kind: 'stash', index: s.index })"
            @contextmenu.prevent="emit('context-stash', $event, s.index)"
          >
            <Icon name="clip" class="size-3" />
            <span class="min-w-0 flex-1 truncate">{{ s.m }}</span>
            <span :class="HINT">{{ s.w }}</span>
          </div>
        </template>

        <!-- Submodules -->
        <div :class="SEC" @click="emit('toggle-section', 'submodules')">
          <Icon name="chev" :class="[CHEV, { '-rotate-90': !secOpen.submodules }]" />
          <Icon name="projects" class="size-3" />
          <span class="flex-1">{{ t('git.sidebar.submodules') }}</span>
          <span :class="ZONE_COUNT">0</span>
        </div>
        <template v-if="secOpen.submodules">
          <div :class="EMPTY">{{ t('git.sidebar.empty') }}</div>
        </template>
      </div>
    </template>
  </div>
  <!-- Grip kéo đổi bề rộng sidebar (pointer capture), không phải control. -->
  <div
    v-if="!collapsed"
    ref="resize"
    role="separator"
    aria-orientation="vertical"
    class="relative w-1.5 flex-none cursor-col-resize self-stretch after:absolute after:inset-y-0 after:left-0.5 after:w-px after:bg-border hover:after:w-0.5 hover:after:bg-primary"
    :class="{ 'after:w-0.5 after:bg-primary': dragging }"
    @pointerdown="onPointerDown"
  />
</template>

<script setup lang="ts">
// Git left sidebar — full Sublime-Merge sections, matching the production layout
// (apps/desktop/ui/components/git/GitSidebar.vue): search + Local Changes / All
// Commits + collapsible Branches (folder tree + context menu) / Remotes (with
// nested remote branches) / Tags / Stashes / Submodules + collapse toggle + resize.
import type { BranchInfo, GitSection, RemoteInfo, SectionOpen, Stash } from './git-types'
import { sectionKey } from './git-types'
import { CHEV, ZONE_COUNT } from './git-ui'
import Badge from '~/components/ui/badge/Badge.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

// Mục sidebar (Local Changes, nhánh, remote, tag, stash): đang chọn = sidebar-accent
// như SidebarMenuButton của shadcn.
const ITEM =
  'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
const ON = 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
// Nút của rail khi sidebar thu gọn (30px).
const RAIL = 'size-7.5 text-muted-foreground'
// Header section thu gọn được (chevron + nhãn + số đếm + nút thêm).
const SEC =
  'flex cursor-pointer items-center gap-1.5 rounded-sm px-2 pt-3 pb-1 text-xs font-semibold text-muted-foreground'
const SEC_ADD = 'ml-auto size-4.5 rounded-sm text-muted-foreground hover:text-foreground'
const EMPTY = 'py-1.5 pr-2.5 pl-7 text-sm text-muted-foreground italic'
// Số phụ cuối hàng (ahead/behind, số nhánh trong folder, thời gian stash).
const HINT = 'ml-auto text-xs text-faint tabular-nums'
// Nút ghim nhánh: ẩn tới khi hover hàng, luôn hiện (màu primary) khi đã ghim.
const PIN =
  'size-4.5 flex-none rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover/branch:opacity-75 hover:bg-accent hover:text-foreground hover:opacity-100 motion-reduce:transition-none'
const PIN_ON = 'text-primary opacity-100 group-hover/branch:opacity-100 hover:text-primary'

const props = defineProps<{
  section: GitSection
  dirtyCount: number
  branches: BranchInfo[]
  remotes: RemoteInfo[]
  tags: string[]
  stashes: Stash[]
  secOpen: SectionOpen
  collapsed: boolean
  search: string
  branchCollapsed: Record<string, boolean>
  // Pinned local-branch names (per project) — floated into a "Pinned" group at
  // the top of the Branches section and excluded from the folder tree below.
  pinned: string[]
  sideW: number
}>()

const { t } = useI18n()

const emit = defineEmits<{
  (e: 'update:section', section: GitSection): void
  (e: 'toggle-section', key: keyof SectionOpen): void
  (e: 'toggle-collapse'): void
  (e: 'update:search', value: string): void
  (e: 'new-branch'): void
  (e: 'new-tag'): void
  (e: 'save-stash'): void
  (e: 'add-remote'): void
  (e: 'context-branch', event: MouseEvent, branch: BranchInfo): void
  (e: 'context-stash', event: MouseEvent, index: number): void
  (e: 'context-tag', event: MouseEvent, name: string): void
  (e: 'context-remote', event: MouseEvent, name: string): void
  (e: 'toggle-branch-folder', folder: string): void
  (e: 'toggle-pin', name: string): void
  (e: 'resize', width: number): void
}>()

const isActive = (s: GitSection) => sectionKey(props.section) === sectionKey(s)
const isTagActive = (name: string) => isActive({ kind: 'tag', name })
const isBranchActive = (name: string) =>
  props.section.kind === 'branch' && props.section.name === name

// ── Branch search (local + remote) ──
const hasSearch = computed(() => props.search.trim().length > 0)
const matchBranch = (name: string) => name.toLowerCase().includes(props.search.trim().toLowerCase())

// While searching, force Branches + Remotes open so matches are visible.
const sectionOpenWithSearch = computed(() => ({
  branches: props.secOpen.branches || hasSearch.value,
  remotes: props.secOpen.remotes || hasSearch.value,
}))

// ── Local branches → collapsible folder tree (group by `/` prefix) ──
const localBranches = computed(() => props.branches.filter((b) => !b.remote))

// Recency (committer date) as a sortable epoch; unknown/invalid dates sink to the
// bottom. Drives the "most recently used branches float to the top" ordering — and
// a folder inherits the max recency of its branches, so it floats up with them.
const branchTs = (b: BranchInfo): number => {
  const ms = b.lastCommitAt ? Date.parse(b.lastCommitAt) : Number.NaN
  return Number.isNaN(ms) ? 0 : ms
}

// ── Pinned local branches (floated to the top) ──
const pinnedSet = computed(() => new Set(props.pinned))
const isPinned = (name: string) => pinnedSet.value.has(name)
// Only branches that still exist, honoring the active search filter — most
// recently used first.
const pinnedBranches = computed(() =>
  localBranches.value
    .filter((b) => isPinned(b.name) && (!hasSearch.value || matchBranch(b.name)))
    .sort((a, b) => branchTs(b) - branchTs(a)),
)

// Pinned branches are lifted into their own group, so exclude them from the tree.
const filteredLocal = computed(() => {
  const base = hasSearch.value
    ? localBranches.value.filter((b) => matchBranch(b.name))
    : localBranches.value
  return base.filter((b) => !isPinned(b.name))
})

type BranchRow =
  | { kind: 'branch'; key: string; branch: BranchInfo; label: string; depth: number }
  | {
      kind: 'folder'
      key: string
      name: string
      label: string
      count: number
      collapsed: boolean
      depth: number
    }

type BranchEntry =
  | { kind: 'branch'; ts: number; branch: BranchInfo }
  | { kind: 'folder'; ts: number; name: string; children: BranchInfo[] }

const branchRows = computed<BranchRow[]>(() => {
  const roots: BranchInfo[] = []
  const folders = new Map<string, BranchInfo[]>()
  for (const b of filteredLocal.value) {
    const i = b.name.indexOf('/')
    if (i < 0) roots.push(b)
    else {
      const f = b.name.slice(0, i)
      const arr = folders.get(f)
      if (arr) arr.push(b)
      else folders.set(f, [b])
    }
  }

  // Top-level entries (a root branch or a folder). Each folder's recency = the
  // most recent committer date among its branches, and its children are sorted by
  // recency too — so a recently-used branch pulls its folder up with it.
  const entries: BranchEntry[] = roots.map((b) => ({
    kind: 'branch',
    ts: branchTs(b),
    branch: b,
  }))
  for (const [name, children] of folders) {
    const sorted = [...children].sort((a, b) => branchTs(b) - branchTs(a))
    const ts = sorted.reduce((max, b) => Math.max(max, branchTs(b)), 0)
    entries.push({ kind: 'folder', ts, name, children: sorted })
  }
  // Recency desc; break ties by name so equal-recency rows stay stable.
  entries.sort((a, b) => {
    if (b.ts !== a.ts) return b.ts - a.ts
    const an = a.kind === 'branch' ? a.branch.name : a.name
    const bn = b.kind === 'branch' ? b.branch.name : b.name
    return an.localeCompare(bn)
  })

  const rows: BranchRow[] = []
  for (const e of entries) {
    if (e.kind === 'branch') {
      rows.push({
        kind: 'branch',
        key: e.branch.name,
        branch: e.branch,
        label: e.branch.name,
        depth: 0,
      })
      continue
    }
    // While searching, every folder is forced open.
    const collapsed = hasSearch.value ? false : !!props.branchCollapsed[e.name]
    rows.push({
      kind: 'folder',
      key: `f:${e.name}`,
      name: e.name,
      label: e.name,
      count: e.children.length,
      collapsed,
      depth: 0,
    })
    if (!collapsed) {
      for (const b of e.children) {
        rows.push({
          kind: 'branch',
          key: b.name,
          branch: b,
          label: b.name.slice(b.name.indexOf('/') + 1),
          depth: 1,
        })
      }
    }
  }
  return rows
})

// ── Remotes + nested remote branches ──
const remoteBranches = computed(() => props.branches.filter((b) => b.remote))
const remoteCount = computed(() => props.remotes.length + remoteBranches.value.length)

const remoteBranchesFor = (remoteName: string) =>
  remoteBranches.value.filter(
    (b) => b.name.startsWith(`${remoteName}/`) && (!hasSearch.value || matchBranch(b.name)),
  )

const visibleRemotes = computed(() =>
  hasSearch.value
    ? props.remotes.filter((r) => remoteBranchesFor(r.name).length > 0)
    : props.remotes,
)

const stripRemotePrefix = (full: string, remoteName: string) =>
  full.startsWith(`${remoteName}/`) ? full.slice(remoteName.length + 1) : full

const branchHint = (b: BranchInfo): string | null => {
  if (b.current) return t('git.sidebar.current')
  const parts: string[] = []
  if (b.ahead && b.ahead > 0) parts.push(`↑${b.ahead}`)
  if (b.behind && b.behind > 0) parts.push(`↓${b.behind}`)
  return parts.length ? parts.join(' ') : null
}

// ── Resize handle ──
const resize = useTemplateRef('resize')
const dragging = ref(false)

function onPointerDown(ev: PointerEvent) {
  const handle = resize.value
  if (!handle) return
  ev.preventDefault()
  handle.setPointerCapture(ev.pointerId)
  dragging.value = true
  const startX = ev.clientX
  const startW = props.sideW
  const move = (e: PointerEvent) => {
    emit('resize', Math.max(200, Math.min(420, startW + (e.clientX - startX))))
  }
  const up = () => {
    dragging.value = false
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
}
</script>
