<template>
  <!-- Branch popover — teleport ra body (sidebar overflow:hidden sẽ clip).
       Backdrop click đóng; Esc đóng. Panel: lọc · view list/tree · ghim ·
       pull/push/fetch · tạo nhánh · checkout / merge / rebase / xoá. -->
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[990]" @click="close()" />
    <div
      v-if="open"
      class="fixed z-[991] flex max-h-[70vh] w-[320px] flex-col overflow-hidden rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bgEl)] shadow-[var(--shadow-md)]"
      :style="{ top: `${pos.y}px`, left: `${pos.x}px` }"
      @keydown.esc="close()"
    >
      <!-- Toolbar: lọc + view toggle + ghim + pull/push/fetch nhanh -->
      <div class="flex items-center gap-1 px-2 py-1.5">
        <Input
          ref="filterEl"
          v-model="q"
          class="h-6 min-w-0 flex-1 px-2"
          placeholder="Lọc nhánh…"
        />
        <ScmIconBtn
          :active="view === 'tree'"
          title="Xem dạng cây (gom theo prefix /)"
          @click="view = view === 'tree' ? 'list' : 'tree'"
        >
          <ListTree :size="14" />
        </ScmIconBtn>
        <ScmIconBtn :active="pinOnly" title="Chỉ nhánh đã ghim" @click="pinOnly = !pinOnly">
          <Pin :size="14" />
        </ScmIconBtn>
        <span class="flex-1" />
        <ScmIconBtn :disabled="git.syncOp != null" title="Pull" @click="git.pull()">
          <ArrowDownToLine :size="14" />
        </ScmIconBtn>
        <ScmIconBtn :disabled="git.syncOp != null" title="Push" @click="git.push()">
          <ArrowUpToLine :size="14" />
        </ScmIconBtn>
        <ScmIconBtn :disabled="git.syncOp != null" title="Fetch" @click="git.fetchRemote">
          <RefreshCw :size="14" :class="{ 'animate-spin': git.syncOp?.op === 'fetch' }" />
        </ScmIconBtn>
      </div>

      <!-- Tạo nhánh mới (từ HEAD hiện tại, checkout ngay) -->
      <div class="flex items-center gap-1 border-t border-[var(--border)] px-2 py-1.5">
        <Input
          v-model="newName"
          class="h-6 min-w-0 flex-1 px-2"
          placeholder="Nhánh mới từ HEAD…"
          @keydown.enter.prevent="createBranch"
        />
        <ScmIconBtn
          :disabled="!newName.trim() || busy"
          title="Tạo & checkout"
          @click="createBranch"
        >
          <Plus :size="14" />
        </ScmIconBtn>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto border-t border-[var(--border)] py-1">
        <div v-if="!rows.length" class="px-2 py-2.5 text-sm text-[var(--textFaint)]">
          Không có nhánh phù hợp.
        </div>
        <template v-for="r in rows" :key="r.key">
          <!-- Folder row (tree view): gom nhánh theo prefix `foo/…`. -->
          <div
            v-if="r.kind === 'folder'"
            class="group/row flex h-[24px] cursor-pointer items-center gap-1.5 overflow-hidden whitespace-nowrap pr-2 text-sm text-[var(--textDim)] hover:bg-[var(--bgHover)] hover:text-[var(--text)]"
            :style="{ paddingLeft: `${8 + r.depth * 12}px` }"
            @click="togglePopDir(r.name)"
          >
            <ChevronRight v-if="r.collapsed" :size="10" class="flex-none" />
            <ChevronDown v-else :size="10" class="flex-none" />
            <Folder :size="14" class="flex-none text-[var(--textFaint)]" />
            <span class="min-w-0 flex-1 truncate">{{ r.label }}/</span>
            <span class="w-8 flex-none text-right text-xs tabular-nums text-[var(--textFaint)]">
              {{ r.count }}
            </span>
          </div>
          <!-- Remote-tracking row: checkout = tạo local tracking. -->
          <div
            v-else-if="r.kind === 'remote'"
            class="group/row flex h-[24px] cursor-pointer items-center gap-1.5 overflow-hidden whitespace-nowrap pr-2 text-sm text-[var(--textFaint)] hover:bg-[var(--bgHover)] hover:text-[var(--text)]"
            :style="{ paddingLeft: `${8 + r.depth * 12}px` }"
            :title="r.branch.name"
            @click="checkoutRemote(r.branch)"
          >
            <Globe :size="14" class="flex-none text-[var(--textFaint)]" />
            <span class="min-w-0 flex-1 truncate">{{ r.label }}</span>
            <span class="w-14 flex-none text-right text-xs tabular-nums text-[var(--textFaint)]">
              {{ bHint(r.branch) }}
            </span>
            <span
              class="hidden flex-none items-center gap-0.5 bg-[var(--bgEl)] pl-1 group-hover/row:flex"
            >
              <ScmIconBtn
                :size="18"
                hover="active"
                title="Checkout thành nhánh local"
                @click.stop="checkoutRemote(r.branch)"
              >
                <Check :size="14" />
              </ScmIconBtn>
            </span>
          </div>
          <!-- Local branch row: current accent · pinned giữ nút pin luôn hiện. -->
          <div
            v-else
            class="group/row relative flex h-[24px] cursor-pointer items-center gap-1.5 overflow-hidden whitespace-nowrap pr-2 text-sm text-[var(--textMuted)] hover:bg-[var(--bgHover)] hover:text-[var(--text)]"
            :class="{ 'font-semibold text-[var(--accent)]': r.branch.current }"
            :style="{ paddingLeft: `${8 + r.depth * 12}px` }"
            :title="r.branch.name"
            @click="checkoutBranch(r.branch)"
          >
            <GitBranch :size="14" class="flex-none text-[var(--textFaint)]" />
            <span class="min-w-0 flex-1 truncate">{{ r.label }}</span>
            <span class="w-14 flex-none text-right text-xs tabular-nums text-[var(--textFaint)]">
              {{ bHint(r.branch) }}
            </span>
            <span
              class="absolute inset-y-0 right-0 flex-none items-center gap-0.5 bg-[var(--bgHover)] pl-1 pr-1.5"
              :class="isPinned(r.branch.name) ? 'flex' : 'hidden group-hover/row:flex'"
            >
              <ScmIconBtn
                :size="18"
                hover="active"
                :title="isPinned(r.branch.name) ? 'Bỏ ghim' : 'Ghim'"
                @click.stop="pins.toggle(r.branch.name)"
              >
                <Pin :size="14" />
              </ScmIconBtn>
              <ScmIconBtn
                v-if="!r.branch.current"
                :size="18"
                hover="active"
                title="Merge vào nhánh hiện tại"
                @click.stop="mergeBranch(r.branch)"
              >
                <GitMerge :size="14" />
              </ScmIconBtn>
              <ScmIconBtn
                v-if="!r.branch.current"
                :size="18"
                hover="active"
                title="Rebase lên nhánh này"
                @click.stop="rebaseBranch(r.branch)"
              >
                <GitPullRequestArrow :size="14" />
              </ScmIconBtn>
              <ScmIconBtn
                v-if="!r.branch.current"
                :size="18"
                danger
                title="Xoá nhánh"
                @click.stop="deleteBranch(r.branch)"
              >
                <Trash2 :size="14" />
              </ScmIconBtn>
            </span>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  GitBranch,
  GitMerge,
  GitPullRequestArrow,
  Globe,
  ListTree,
  Pin,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import type { BranchInfo } from '~/components/git/git-types'
import { useConfirm } from '~/composables/useConfirm'
import { useToast } from '~/composables/useToast'
import { useGitBranchPins } from '~/composables/useGitBranchPins'
import { useGitStore } from '~/stores/git'
import ScmIconBtn from './ScmIconBtn.vue'

// Anchor = nút chevron trên header SCM; parent truyền element (tránh id/selector
// giữa hai component). Khi mở: anchor bên phải chevron, clamp trong viewport
// (sidebar hẹp ~300px), reset filter + nạp nhánh + focus ô lọc.
const props = defineProps<{
  open: boolean
  anchor: HTMLElement | null
}>()
const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const git = useGitStore()
const { confirm } = useConfirm()
const toast = useToast()
const pins = useGitBranchPins(() => git.currentProjectId)
const isPinned = (name: string) => pins.isPinned(name)

// Input component instance (forwards `focus()`/`el`) — chỉ cần focus khi mở.
const filterEl = ref<{ focus: () => void } | null>(null)
const pos = ref({ x: 0, y: 0 })
const q = ref('')
const view = ref<'list' | 'tree'>(
  (localStorage.getItem('awog.scm.branchView') as 'list' | 'tree') || 'list',
)
const pinOnly = ref(false)
const newName = ref('')
const busy = ref(false)

function close(): void {
  emit('update:open', false)
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    const r = props.anchor?.getBoundingClientRect()
    const w = 320
    pos.value = {
      x: Math.max(8, Math.min((r?.right ?? 0) - w, window.innerWidth - w - 8)),
      y: (r?.bottom ?? 0) + 6,
    }
    q.value = ''
    newName.value = ''
    void git.loadBranches()
    await nextTick()
    filterEl.value?.focus()
  },
)
watch(view, (v) => localStorage.setItem('awog.scm.branchView', String(v)))

// Nhánh local phẳng → rows (current → pinned → recency); remote gom dưới group
// ảo cuối. Tree mode gom theo prefix `foo/…` thành folder row.
type PopRow =
  | { kind: 'local'; key: string; label: string; branch: BranchInfo; depth: number }
  | { kind: 'remote'; key: string; label: string; branch: BranchInfo; depth: number }
  | {
      kind: 'folder'
      key: string
      name: string
      label: string
      count: number
      collapsed: boolean
      depth: number
    }

const popCollapsed = ref(new Set<string>())
function togglePopDir(name: string): void {
  const s = new Set(popCollapsed.value)
  if (s.has(name)) s.delete(name)
  else s.add(name)
  popCollapsed.value = s
}

const rows = computed<PopRow[]>(() => {
  const needle = q.value.trim().toLowerCase()
  const match = (n: string) => !needle || n.toLowerCase().includes(needle)
  const local = git.branches.filter(
    (b) => !b.remote && match(b.name) && (!pinOnly.value || isPinned(b.name)),
  )
  const remote = git.branches.filter((b) => b.remote && match(b.name))

  const ts = (b: BranchInfo): number => {
    const t = Date.parse(b.lastCommitAt ?? '')
    return Number.isNaN(t) ? 0 : t
  }

  const out: PopRow[] = []
  const pushLocal = (b: BranchInfo, depth: number, label?: string) =>
    out.push({ kind: 'local', key: `l:${b.name}`, label: label ?? b.name, branch: b, depth })

  if (view.value === 'list') {
    const cur = local.find((b) => b.current)
    const pinned = local.filter((b) => !b.current && isPinned(b.name))
    const rest = local.filter((b) => !b.current && !isPinned(b.name)).sort((a, b) => ts(b) - ts(a))
    if (cur) pushLocal(cur, 0)
    for (const b of pinned) pushLocal(b, 0)
    for (const b of rest) pushLocal(b, 0)
  } else {
    const folders = new Map<string, BranchInfo[]>()
    const roots: BranchInfo[] = []
    for (const b of local) {
      const i = b.name.indexOf('/')
      if (i < 0) roots.push(b)
      else {
        const f = b.name.slice(0, i)
        const arr = folders.get(f) ?? []
        arr.push(b)
        folders.set(f, arr)
      }
    }
    // Folder xếp theo branch gần nhất bên trong; root branch sort cùng pool.
    const entries: (
      | { kind: 'b'; b: BranchInfo }
      | { kind: 'f'; name: string; list: BranchInfo[] }
    )[] = roots.map((b) => ({ kind: 'b', b }))
    for (const [name, list] of folders) {
      list.sort((a, b) => ts(b) - ts(a))
      entries.push({ kind: 'f', name, list })
    }
    entries.sort((a, b) => {
      const ta = a.kind === 'b' ? ts(a.b) : Math.max(...a.list.map(ts), 0)
      const tb = b.kind === 'b' ? ts(b.b) : Math.max(...b.list.map(ts), 0)
      return tb - ta
    })
    for (const e of entries) {
      if (e.kind === 'b') {
        pushLocal(e.b, 0)
        continue
      }
      const collapsed = popCollapsed.value.has(e.name)
      out.push({
        kind: 'folder',
        key: `f:${e.name}`,
        name: e.name,
        label: e.name,
        count: e.list.length,
        collapsed,
        depth: 0,
      })
      if (!collapsed) for (const b of e.list) pushLocal(b, 1, b.name.slice(b.name.indexOf('/') + 1))
    }
  }

  // Remote — append sau, không ghim được (không checkout trực tiếp).
  for (const b of remote)
    out.push({ kind: 'remote', key: `r:${b.name}`, label: b.name, branch: b, depth: 0 })
  return out
})

const bHint = (b: BranchInfo): string => {
  if (b.current) return 'đang checkout'
  const p: string[] = []
  if (b.ahead && b.ahead > 0) p.push(`↑${b.ahead}`)
  if (b.behind && b.behind > 0) p.push(`↓${b.behind}`)
  return p.join(' ')
}

// Cùng luật checkout dirty-tree (stash → retry) như GitManager.
async function checkoutBranch(b: BranchInfo): Promise<void> {
  if (b.current) {
    close()
    return
  }
  const res = await git.checkoutBranch(b.name)
  if (res.ok) {
    close()
    return
  }
  // DIRTY_TREE → offer stash & retry (flow của GitManager).
  if (res.code === 'DIRTY_TREE') {
    const ok = await confirm({
      title: 'Có thay đổi chưa commit',
      description: `Stash thay đổi rồi chuyển sang "${b.name}"?`,
      confirmLabel: 'Stash & chuyển',
    })
    if (!ok) return
    if (!(await git.stashSave(undefined, { includeUntracked: true }))) return
    const retry = await git.checkoutBranch(b.name)
    if (retry.ok) {
      close()
      toast.add({ title: `Đã stash & chuyển sang "${b.name}"`, color: 'success' })
      return
    }
  }
  toast.add({ title: res.message || 'Checkout thất bại', color: 'error' })
}

async function checkoutRemote(b: BranchInfo): Promise<void> {
  // `origin/foo` → local `foo` tracking origin/foo. Nếu local đã có → chỉ checkout.
  const localName = b.name.slice(b.name.indexOf('/') + 1)
  const local = git.branches.find((x) => !x.remote && x.name === localName)
  if (local) return checkoutBranch(local)
  busy.value = true
  try {
    await git.createBranch(localName, b.name)
    await checkoutBranch({ ...b, name: localName, remote: false })
  } finally {
    busy.value = false
  }
}

async function mergeBranch(b: BranchInfo): Promise<void> {
  const ok = await confirm({
    title: 'Merge nhánh',
    description: `Merge "${b.name}" vào "${git.branch}"?`,
    confirmLabel: 'Merge',
  })
  if (!ok) return
  await git.merge(b.name)
  if (git.lastError) toast.add({ title: git.lastError.message, color: 'error' })
}

async function rebaseBranch(b: BranchInfo): Promise<void> {
  const ok = await confirm({
    title: 'Rebase nhánh hiện tại',
    description: `Rebase "${git.branch}" lên "${b.name}"?`,
    confirmLabel: 'Rebase',
    kind: 'danger',
  })
  if (!ok) return
  await git.rebase(b.name)
  if (git.lastError) toast.add({ title: git.lastError.message, color: 'error' })
}

async function deleteBranch(b: BranchInfo): Promise<void> {
  const ok = await confirm({
    title: 'Xoá nhánh',
    description: `Xoá "${b.name}"? Hành động này không hoàn tác được.`,
    confirmLabel: 'Xoá',
    kind: 'danger',
  })
  if (!ok) return
  const res = await git.deleteBranch(b.name)
  if (!res.ok && res.code === 'UNMERGED') {
    const force = await confirm({
      title: 'Nhánh chưa merge',
      description: `"${b.name}" có commit chưa merge — xoá luôn (force)?`,
      confirmLabel: 'Xoá force',
      kind: 'danger',
    })
    if (!force) return
    await git.deleteBranch(b.name, { force: true })
  } else if (!res.ok) {
    toast.add({ title: res.message || 'Xoá nhánh thất bại', color: 'error' })
    return
  }
  if (isPinned(b.name)) pins.toggle(b.name)
}

async function createBranch(): Promise<void> {
  const name = newName.value.trim()
  if (!name || busy.value) return
  busy.value = true
  try {
    await git.createBranch(name)
    await checkoutBranch({ name })
  } finally {
    busy.value = false
    newName.value = ''
  }
}
</script>
