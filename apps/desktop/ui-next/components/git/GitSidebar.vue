<template>
  <div
    class="gside"
    :style="{
      flex: `0 0 ${collapsed ? 44 : sideW}px`,
      width: `${collapsed ? 44 : sideW}px`,
      padding: '0',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }"
  >
    <!-- Header: title + collapse toggle -->
    <div class="gsidehd">
      <span v-if="!collapsed" class="gsidetitle">{{ t('git.sidebar.title') }}</span>
      <span
        class="gsidecol"
        :title="collapsed ? t('git.sidebar.expand') : t('git.sidebar.collapse')"
        @click="emit('toggle-collapse')"
      >
        <Icon name="panel" style="width: 14px; height: 14px" />
      </span>
    </div>

    <!-- Collapsed quick rail -->
    <template v-if="collapsed">
      <div class="gsiderail">
        <span
          class="gqi"
          :class="{ on: section.kind === 'local-changes' }"
          :title="t('git.sidebar.localChanges')"
          @click="emit('update:section', { kind: 'local-changes' })"
        >
          <Icon name="edit" style="width: 14px; height: 14px" />
        </span>
        <span
          class="gqi"
          :class="{ on: section.kind === 'all-commits' }"
          :title="t('git.sidebar.allCommits')"
          @click="emit('update:section', { kind: 'all-commits' })"
        >
          <Icon name="clock" style="width: 14px; height: 14px" />
        </span>
      </div>
    </template>

    <template v-else>
      <!-- Branch search -->
      <div class="gsearch">
        <Icon name="search" style="width: 13px; height: 13px; color: var(--textDim)" />
        <input
          :value="search"
          :placeholder="t('git.sidebar.searchBranches')"
          @input="emit('update:search', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <!-- Scroll body -->
      <div class="gsidebody">
        <!-- Local Changes -->
        <div
          class="gsi"
          :class="{ on: section.kind === 'local-changes' }"
          @click="emit('update:section', { kind: 'local-changes' })"
        >
          <Icon name="edit" style="width: 13px; height: 13px" />
          <span style="flex: 1">{{ t('git.sidebar.localChanges') }}</span>
          <span
            v-if="dirtyCount > 0"
            class="gbadge"
            :style="{
              color: 'var(--amber)',
              background: 'var(--amberDim)',
              borderColor: 'var(--amberBorder)',
            }"
          >
            {{ dirtyCount }}
          </span>
        </div>

        <!-- All Commits -->
        <div
          class="gsi"
          :class="{ on: section.kind === 'all-commits' }"
          @click="emit('update:section', { kind: 'all-commits' })"
        >
          <Icon name="clock" style="width: 13px; height: 13px" />
          <span style="flex: 1">{{ t('git.sidebar.allCommits') }}</span>
        </div>

        <!-- Branches -->
        <div class="gsec gseccol" @click="emit('toggle-section', 'branches')">
          <svg class="icn gchv" :class="{ col: !sectionOpenWithSearch.branches }">
            <use href="#i-chev" />
          </svg>
          <Icon name="branch" style="width: 12px; height: 12px" />
          <span style="flex: 1">{{ t('git.sidebar.branches') }}</span>
          <span class="gsecct">{{ localBranches.length }}</span>
          <span
            class="gsecadd"
            :title="t('git.sidebar.newBranch')"
            @click.stop="emit('new-branch')"
          >
            <Icon name="plus" style="width: 12px; height: 12px" />
          </span>
        </div>
        <template v-if="sectionOpenWithSearch.branches">
          <!-- Pinned branches (floated to top) -->
          <template v-if="pinnedBranches.length">
            <div class="gbpinhd">{{ t('git.sidebar.pinned') }}</div>
            <div
              v-for="b in pinnedBranches"
              :key="`pin:${b.name}`"
              class="gsi gbranch"
              :class="{ on: isBranchActive(b.name) }"
              :style="{ paddingLeft: '22px' }"
              @click="emit('update:section', { kind: 'branch', name: b.name })"
              @contextmenu.prevent="emit('context-branch', $event, b)"
            >
              <Icon
                name="branch"
                style="width: 12px; height: 12px"
                :style="b.current ? { color: 'var(--accent)' } : undefined"
              />
              <span
                class="gtrunc"
                :style="
                  b.current
                    ? 'flex:1;min-width:0;color:var(--accent);font-weight:600'
                    : 'flex:1;min-width:0'
                "
              >
                {{ b.name }}
              </span>
              <span
                v-if="branchHint(b)"
                class="gc"
                :style="b.current ? { color: 'var(--accent)' } : undefined"
              >
                {{ branchHint(b) }}
              </span>
              <span
                class="gpinbtn on"
                :title="t('git.ctx.unpin')"
                @click.stop="emit('toggle-pin', b.name)"
              >
                <Icon name="pin" style="width: 12px; height: 12px" />
              </span>
            </div>
          </template>

          <div v-if="!branchRows.length && !pinnedBranches.length" class="gsecempty">
            {{ search ? t('git.sidebar.noMatch') : t('git.sidebar.empty') }}
          </div>
          <template v-for="row in branchRows" :key="row.key">
            <div
              v-if="row.kind === 'folder'"
              class="gbfolder"
              :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
              @click="emit('toggle-branch-folder', row.name)"
            >
              <svg class="icn fchv" :class="{ col: row.collapsed }"><use href="#i-chev" /></svg>
              <Icon name="folder" style="width: 12px; height: 12px" />
              <span style="flex: 1">{{ row.label }}/</span>
              <span class="gc">{{ row.count }}</span>
            </div>
            <div
              v-else
              class="gsi gbranch"
              :class="{ on: isBranchActive(row.branch.name) }"
              :style="{ paddingLeft: `${8 + (row.depth + 1) * 14}px` }"
              @click="emit('update:section', { kind: 'branch', name: row.branch.name })"
              @contextmenu.prevent="emit('context-branch', $event, row.branch)"
            >
              <Icon
                name="branch"
                style="width: 12px; height: 12px"
                :style="row.branch.current ? { color: 'var(--accent)' } : undefined"
              />
              <span
                class="gtrunc"
                :style="
                  row.branch.current
                    ? 'flex:1;min-width:0;color:var(--accent);font-weight:600'
                    : 'flex:1;min-width:0'
                "
              >
                {{ row.label }}
              </span>
              <span
                v-if="branchHint(row.branch)"
                class="gc"
                :style="row.branch.current ? { color: 'var(--accent)' } : undefined"
              >
                {{ branchHint(row.branch) }}
              </span>
              <span
                class="gpinbtn"
                :class="{ on: isPinned(row.branch.name) }"
                :title="isPinned(row.branch.name) ? t('git.ctx.unpin') : t('git.ctx.pin')"
                @click.stop="emit('toggle-pin', row.branch.name)"
              >
                <Icon name="pin" style="width: 12px; height: 12px" />
              </span>
            </div>
          </template>
        </template>

        <!-- Remotes -->
        <div class="gsec gseccol" @click="emit('toggle-section', 'remotes')">
          <svg class="icn gchv" :class="{ col: !sectionOpenWithSearch.remotes }">
            <use href="#i-chev" />
          </svg>
          <Icon name="conn" style="width: 12px; height: 12px" />
          <span style="flex: 1">{{ t('git.sidebar.remotes') }}</span>
          <span class="gsecct">{{ remoteCount }}</span>
          <span class="gsecadd" :title="t('git.remote.add')" @click.stop="emit('add-remote')">
            <Icon name="plus" style="width: 12px; height: 12px" />
          </span>
        </div>
        <template v-if="sectionOpenWithSearch.remotes">
          <div v-if="!visibleRemotes.length" class="gsecempty">
            {{ search ? t('git.sidebar.noMatch') : t('git.sidebar.empty') }}
          </div>
          <template v-for="r in visibleRemotes" :key="r.name">
            <div
              class="gsi"
              :class="{ on: isActive({ kind: 'remote', name: r.name }) }"
              :style="{ paddingLeft: '22px' }"
              @click="emit('update:section', { kind: 'remote', name: r.name })"
              @contextmenu.prevent="emit('context-remote', $event, r.name)"
            >
              <Icon name="conn" style="width: 12px; height: 12px" />
              <span class="gtrunc" style="flex: 1; min-width: 0">{{ r.name }}</span>
            </div>
            <div
              v-for="rb in remoteBranchesFor(r.name)"
              :key="rb.name"
              class="gsi gbranch"
              :class="{ on: isBranchActive(rb.name) }"
              :style="{ paddingLeft: '40px' }"
              @click="emit('update:section', { kind: 'branch', name: rb.name })"
              @contextmenu.prevent="emit('context-branch', $event, rb)"
            >
              <Icon name="branch" style="width: 12px; height: 12px" />
              <span class="gtrunc" style="flex: 1; min-width: 0">
                {{ stripRemotePrefix(rb.name, r.name) }}
              </span>
            </div>
          </template>
        </template>

        <!-- Tags -->
        <div class="gsec gseccol" @click="emit('toggle-section', 'tags')">
          <svg class="icn gchv" :class="{ col: !secOpen.tags }"><use href="#i-chev" /></svg>
          <Icon name="git" style="width: 12px; height: 12px" />
          <span style="flex: 1">{{ t('git.sidebar.tags') }}</span>
          <span class="gsecct">{{ tags.length }}</span>
          <span class="gsecadd" :title="t('git.sidebar.newTag')" @click.stop="emit('new-tag')">
            <Icon name="plus" style="width: 12px; height: 12px" />
          </span>
        </div>
        <template v-if="secOpen.tags">
          <div v-if="!tags.length" class="gsecempty">{{ t('git.sidebar.empty') }}</div>
          <div
            v-for="tag in tags"
            :key="tag"
            class="gsi"
            :class="{ on: isActive({ kind: 'tag', name: tag }) }"
            :style="{ paddingLeft: '22px' }"
            @click="emit('update:section', { kind: 'tag', name: tag })"
            @contextmenu.prevent="emit('context-tag', $event, tag)"
          >
            <Icon name="git" style="width: 12px; height: 12px" />
            <span class="gtrunc" style="flex: 1; min-width: 0">{{ tag }}</span>
          </div>
        </template>

        <!-- Stashes -->
        <div class="gsec gseccol" @click="emit('toggle-section', 'stashes')">
          <svg class="icn gchv" :class="{ col: !secOpen.stashes }"><use href="#i-chev" /></svg>
          <Icon name="clip" style="width: 12px; height: 12px" />
          <span style="flex: 1">{{ t('git.sidebar.stashes') }}</span>
          <span class="gsecct">{{ stashes.length }}</span>
          <span class="gsecadd" :title="t('git.stash.save')" @click.stop="emit('save-stash')">
            <Icon name="plus" style="width: 12px; height: 12px" />
          </span>
        </div>
        <template v-if="secOpen.stashes">
          <div v-if="!stashes.length" class="gsecempty">{{ t('git.sidebar.empty') }}</div>
          <div
            v-for="s in stashes"
            :key="s.index"
            class="gsi"
            :class="{ on: isActive({ kind: 'stash', index: s.index }) }"
            :style="{ paddingLeft: '22px' }"
            @click="emit('update:section', { kind: 'stash', index: s.index })"
            @contextmenu.prevent="emit('context-stash', $event, s.index)"
          >
            <Icon name="clip" style="width: 12px; height: 12px" />
            <span class="gtrunc" style="flex: 1; min-width: 0">{{ s.m }}</span>
            <span class="gc">{{ s.w }}</span>
          </div>
        </template>

        <!-- Submodules -->
        <div class="gsec gseccol" @click="emit('toggle-section', 'submodules')">
          <svg class="icn gchv" :class="{ col: !secOpen.submodules }"><use href="#i-chev" /></svg>
          <Icon name="projects" style="width: 12px; height: 12px" />
          <span style="flex: 1">{{ t('git.sidebar.submodules') }}</span>
          <span class="gsecct">0</span>
        </div>
        <template v-if="secOpen.submodules">
          <div class="gsecempty">{{ t('git.sidebar.empty') }}</div>
        </template>
      </div>
    </template>
  </div>
  <div
    v-if="!collapsed"
    ref="resize"
    class="grsz"
    :class="{ drag: dragging }"
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

<style scoped>
/* "Pinned" subgroup label inside the Branches section — mirrors the .gsec
   section-header idiom (mono, uppercase, faint) but indented as a child. */
.gbpinhd {
  padding: 6px 8px 2px 22px;
  font-size: var(--fs-xs);
  color: var(--textFaint);
}

/* Pin toggle on a branch row — hidden until row hover, always shown (accent)
   when the branch is pinned. flex:0 0 auto so it never squeezes the name. */
.gpinbtn {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  padding: 2px;
  border-radius: var(--r-xs);
  color: var(--textDim);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.12s,
    color 0.12s,
    background 0.12s;
}
.gbranch:hover .gpinbtn {
  opacity: 0.75;
}
.gpinbtn:hover {
  opacity: 1;
  color: var(--text);
  background: var(--bgHover);
}
.gpinbtn.on {
  opacity: 1;
  color: var(--accent);
}
@media (prefers-reduced-motion: reduce) {
  .gpinbtn {
    transition: none;
  }
}
</style>
