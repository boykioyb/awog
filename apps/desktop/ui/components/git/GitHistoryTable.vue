<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div
      class="flex items-center justify-between px-3 py-2 flex-shrink-0"
      :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <div class="text-[1em] uppercase tracking-wider" :style="{ color: t.textDim }">History</div>
      <div class="text-[1em]" :style="{ color: t.textFaint }">
        {{ tr('git.history.commits_count', { count: commits.length }) }}
      </div>
    </div>

    <div
      v-if="commits.length === 0"
      class="flex-1 flex items-center justify-center text-[1em]"
      :style="{ color: t.textDim }"
    >
      {{ tr('git.history.no_commits') }}
    </div>

    <div v-else class="flex-1 overflow-y-auto">
      <div class="relative" :style="{ minWidth: '720px' }">
        <!-- DAG column pinned to the left, aligned by rowHeight. Width tracks
             actual lane count from computeDagLayout so dots/edges never clip
             into invisibility — wide histories scroll horizontally instead. -->
        <div
          class="absolute top-0 left-0 z-0"
          :style="{ width: `${graphPadding}px`, paddingLeft: '8px' }"
        >
          <GitHistoryGraph
            :commits="commits"
            :selected-hash="selectedHash"
            :row-height="ROW_HEIGHT"
            :lane-width="LANE_WIDTH"
            :layout="dagLayout"
            @select="(h: string) => emit('select', h)"
          />
        </div>
        <!-- Commit rows. Left padding leaves room for the graph SVG. -->
        <div :style="{ paddingLeft: `${graphPadding}px` }">
          <div
            v-for="c in commits"
            :key="c.hash"
            class="flex items-center gap-2 px-3 cursor-pointer transition select-none"
            :style="{
              height: `${ROW_HEIGHT}px`,
              background:
                selectedHash === c.hash
                  ? t.bgActive
                  : hovered === c.hash
                    ? t.bgHover
                    : 'transparent',
              borderLeft:
                selectedHash === c.hash ? `2px solid ${t.accent}` : '2px solid transparent',
            }"
            @mouseenter="hovered = c.hash"
            @mouseleave="hovered = null"
            @click="emit('select', c.hash)"
            @contextmenu.prevent="onRowContext($event, c)"
          >
            <!-- Subject + refs -->
            <div class="flex-1 flex items-center gap-1.5 min-w-0">
              <GitRefBadge v-for="r in visibleRefs(c)" :key="`${c.hash}-${r.name}`" :ref-item="r" />
              <span
                v-if="overflowCount(c) > 0"
                class="text-[1em] px-1 py-0.5 rounded"
                :style="{
                  color: t.textDim,
                  background: t.bgInput,
                  border: `1px solid ${t.border}`,
                }"
                :title="overflowTitle(c)"
              >
                {{ tr('git.history.overflow_more', { count: overflowCount(c) }) }}
              </span>
              <span
                v-if="c.phaseId"
                class="text-[1em] px-1 py-0.5 rounded font-mono"
                :style="{
                  background: t.infoBg,
                  color: t.info,
                  border: `1px solid ${t.infoBorder}`,
                }"
                :title="tr('git.history.linked_phase_tip', { phase: c.phaseId })"
              >
                <Link :size="9" class="inline-block mr-0.5" />
                {{ c.phaseId }}
              </span>
              <span class="text-[1em] truncate" :style="{ color: t.text }">{{ c.subject }}</span>
            </div>

            <!-- Author -->
            <div class="flex items-center gap-1.5 flex-shrink-0 w-[140px]">
              <GitAuthorAvatar :name="c.authorName" :email="c.authorEmail" :size="18" />
              <span class="text-[1em] truncate flex-1 min-w-0" :style="{ color: t.textMuted }">
                {{ c.authorName }}
              </span>
            </div>

            <!-- Hash -->
            <button
              type="button"
              class="font-mono text-[1em] flex-shrink-0 w-[70px] text-left transition"
              :style="{ color: t.accent }"
              :title="tr('git.header.copy_hash', { hash: c.hash })"
              @click.stop="onCopyHash(c.hash)"
            >
              {{ c.shortHash }}
            </button>

            <!-- Date -->
            <span
              class="text-[1em] flex-shrink-0 w-[140px] text-right"
              :style="{ color: t.textDim }"
              :title="new Date(c.date).toLocaleString()"
            >
              {{ formatRelative(c.date) }}
            </span>
          </div>
        </div>
      </div>

      <div
        v-if="hasMore"
        class="px-3 py-2 flex justify-center"
        :style="{ borderTop: `1px solid ${t.border}` }"
      >
        <button
          type="button"
          class="px-3 py-1 text-[1em] rounded transition"
          :style="{
            background: t.bgInput,
            color: t.textMuted,
            border: `1px solid ${t.border}`,
            opacity: loading ? 0.6 : 1,
          }"
          :disabled="loading"
          @click="emit('load-more')"
        >
          {{ loading ? tr('common.loading') : tr('common.load_more') }}
        </button>
      </div>
    </div>

    <ContextMenu
      v-if="contextMenu"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenuItems"
      @close="contextMenu = null"
    />

    <GitBranchNameModal
      :open="branchModalOpen"
      :title="tr('git.menu.new_branch')"
      :submit-label="tr('git.branches.create_submit')"
      placeholder="branch-name"
      :from-label="contextMenu ? contextMenu.commit.shortHash : ''"
      :model-value="newBranchName"
      @update:model-value="newBranchName = $event"
      @close="branchModalOpen = false"
      @submit="onCreateBranchSubmit"
    />

    <GitTagCreateModal
      :open="tagModalOpen"
      :target-sha="actionSha"
      :target-short-hash="actionSha7"
      @close="tagModalOpen = false"
      @submit="onTagSubmit"
    />

    <GitResetConfirmModal
      :open="resetModalOpen"
      :target-sha7="actionSha7"
      :current-branch="store.currentBranch"
      @close="resetModalOpen = false"
      @submit="onResetSubmit"
    />

    <ConfirmDeleteModal
      v-if="checkoutCommitConfirm"
      :title="tr('git.checkout_commit.title')"
      :description="tr('git.checkout_commit.description', { sha: actionSha7 })"
      kind="primary"
      :confirm-label="tr('git.checkout_commit.confirm')"
      @confirm="onCheckoutCommitConfirm"
      @cancel="checkoutCommitConfirm = false"
    />

    <ConfirmDeleteModal
      v-if="cherryPickConfirm"
      :title="tr('git.cherry_pick.title')"
      :description="
        tr('git.cherry_pick.description', { sha: actionSha7, branch: store.currentBranch })
      "
      kind="primary"
      :confirm-label="tr('git.cherry_pick.confirm')"
      @confirm="onCherryPickConfirm"
      @cancel="cherryPickConfirm = false"
    />

    <ConfirmDeleteModal
      v-if="revertConfirm"
      :title="tr('git.revert.title')"
      :description="tr('git.revert.description', { sha: actionSha7, branch: store.currentBranch })"
      kind="primary"
      :confirm-label="tr('git.revert.confirm')"
      @confirm="onRevertConfirm"
      @cancel="revertConfirm = false"
    />

    <ConfirmDeleteModal
      v-if="savePatchConfirm"
      :title="tr('git.save_patch.title')"
      :description="tr('git.save_patch.description', { sha: actionSha7 })"
      kind="primary"
      :confirm-label="tr('git.save_patch.confirm')"
      @confirm="onSavePatchConfirm"
      @cancel="savePatchConfirm = false"
    />

    <GitCompareCommitModal
      :open="compareOpen"
      :target-short-hash="actionSha7"
      :files="compareFiles"
      :loading="compareLoading"
      @close="compareOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import {
  Copy,
  Edit3,
  FileDown,
  GitBranchPlus,
  GitCompare,
  GitFork,
  Link,
  Pencil,
  RotateCcw,
  Scissors,
  SquareStack,
  Tag,
  Trash2,
  Undo2,
} from 'lucide-vue-next'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'
import type { GitCommit, GitFileDiff, GitRefDecoration } from '~/types'
import { computeDagLayout } from '~/utils/dag-layout'

type Props = {
  commits: GitCommit[]
  selectedHash: string | null
  hasMore: boolean
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), { loading: false })
const emit = defineEmits<{ select: [hash: string]; 'load-more': [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()
const hovered = ref<string | null>(null)

const ROW_HEIGHT = 28
const LANE_WIDTH = 16
const MAX_VISIBLE_REFS = 3
const GRAPH_LEFT_PAD = 8
const GRAPH_RIGHT_PAD = 12

// Compute the DAG layout once here and pass it down to GitHistoryGraph so both
// sides agree on lane count. Padding grows with the actual lane count — wide
// histories scroll horizontally rather than clipping dots/edges (which made
// edges look detached when one endpoint was hidden).
const dagLayout = computed(() => computeDagLayout(props.commits))
const graphPadding = computed(() => {
  const lanes = Math.max(2, dagLayout.value.laneCount)
  return lanes * LANE_WIDTH + GRAPH_LEFT_PAD + GRAPH_RIGHT_PAD
})

const visibleRefs = (c: GitCommit): GitRefDecoration[] => c.refs.slice(0, MAX_VISIBLE_REFS)
const overflowCount = (c: GitCommit) => Math.max(0, c.refs.length - MAX_VISIBLE_REFS)
const overflowTitle = (c: GitCommit) =>
  c.refs
    .slice(MAX_VISIBLE_REFS)
    .map((r) => r.name)
    .join(', ')

// Sublime/GitKraken-style relative format. "Today at HH:MM", "Yesterday at
// HH:MM", "DayOfWeek at HH:MM" within a week, else "MMM DD" / "MMM DD, YYYY".
const formatRelative = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const now = new Date()
  const isSameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (isSameDay) return `Today at ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays >= 0 && diffDays < 7) {
    const day = d.toLocaleDateString(undefined, { weekday: 'short' })
    return `${day} at ${time}`
  }
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

const onCopyHash = (hash: string) => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  // Best-effort: ignore rejection (permissions, insecure context).
  navigator.clipboard.writeText(hash).catch(() => undefined)
}

// ─── Right-click context menu ────────────────────────────────────────────
const store = useGitStore()

const contextMenu = ref<{ x: number; y: number; commit: GitCommit } | null>(null)
const onRowContext = (e: MouseEvent, commit: GitCommit) => {
  contextMenu.value = { x: e.clientX, y: e.clientY, commit }
}

// Modal state — keyed off the commit that was right-clicked. Captured into
// `actionSha`/`actionSha7` when an action opens so the user can dismiss the
// menu without losing the target.
const actionSha = ref<string>('')
const actionSha7 = ref<string>('')

const branchModalOpen = ref(false)
const newBranchName = ref('')
const tagModalOpen = ref(false)
const resetModalOpen = ref(false)
const checkoutCommitConfirm = ref(false)
const cherryPickConfirm = ref(false)
const revertConfirm = ref(false)
const savePatchConfirm = ref(false)
const compareOpen = ref(false)
const compareFiles = ref<GitFileDiff[]>([])
const compareLoading = ref(false)

const captureTarget = (commit: GitCommit) => {
  actionSha.value = commit.hash
  actionSha7.value = commit.shortHash
}

// Interactive Rebase submenu — entirely placeholder, every child disabled
// with a tooltip explaining the deferral. UI plumbing for nesting still ships
// so we can light these up in v2 without changing the menu layout.
const rebaseChildren = computed<ContextMenuItem[]>(() => [
  {
    label: tr('git.menu.rebase_to_here', { branch: 'HEAD' }),
    disabled: true,
    tooltip: tr('common.coming_v2'),
  },
  { separator: true },
  {
    label: tr('git.menu.reword'),
    icon: Pencil,
    disabled: true,
    tooltip: tr('common.coming_v2'),
  },
  {
    label: tr('git.menu.edit'),
    icon: Edit3,
    disabled: true,
    tooltip: tr('common.coming_v2'),
  },
  {
    label: tr('git.menu.squash'),
    icon: SquareStack,
    disabled: true,
    tooltip: tr('common.coming_v2'),
  },
  {
    label: tr('git.menu.fixup'),
    icon: Scissors,
    disabled: true,
    tooltip: tr('common.coming_v2'),
  },
  {
    label: tr('git.menu.drop'),
    icon: Trash2,
    danger: true,
    disabled: true,
    tooltip: tr('common.coming_v2'),
  },
])

const contextMenuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const c = ctx.commit
  return [
    {
      label: tr('git.menu.new_branch'),
      icon: GitBranchPlus,
      action: () => {
        captureTarget(c)
        newBranchName.value = ''
        branchModalOpen.value = true
      },
    },
    {
      label: tr('git.menu.new_tag'),
      icon: Tag,
      action: () => {
        captureTarget(c)
        tagModalOpen.value = true
      },
    },
    {
      label: tr('git.menu.interactive_rebase'),
      icon: GitFork,
      children: rebaseChildren.value,
    },
    {
      label: tr('git.menu.reset_to_here', { branch: store.currentBranch }),
      icon: RotateCcw,
      action: () => {
        captureTarget(c)
        resetModalOpen.value = true
      },
    },
    { separator: true },
    {
      label: tr('git.menu.checkout_commit'),
      icon: GitBranchPlus,
      action: () => {
        captureTarget(c)
        checkoutCommitConfirm.value = true
      },
    },
    {
      label: tr('git.menu.cherry_pick'),
      icon: Copy,
      action: () => {
        captureTarget(c)
        cherryPickConfirm.value = true
      },
    },
    {
      label: tr('git.menu.revert'),
      icon: Undo2,
      action: () => {
        captureTarget(c)
        revertConfirm.value = true
      },
    },
    {
      label: tr('git.menu.save_patch'),
      icon: FileDown,
      action: () => {
        captureTarget(c)
        savePatchConfirm.value = true
      },
    },
    { separator: true },
    {
      label: tr('git.menu.compare_to_local'),
      icon: GitCompare,
      action: async () => {
        captureTarget(c)
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        await openCompare(c.hash)
      },
    },
    { separator: true },
    {
      label: tr('git.menu.copy_sha'),
      icon: Copy,
      shortcut: '⌘C',
      action: () => onCopyHash(c.hash),
    },
  ]
})

// ─── Action handlers ─────────────────────────────────────────────────────
const onCreateBranchSubmit = async (value: string) => {
  const name = value.trim()
  if (!name) return
  branchModalOpen.value = false
  await store.createBranch(name, actionSha.value)
}

const onTagSubmit = async (payload: { name: string; message: string; annotated: boolean }) => {
  tagModalOpen.value = false
  const opts: { message?: string; annotated?: boolean } = {}
  if (payload.message) opts.message = payload.message
  if (payload.annotated) opts.annotated = true
  await store.createTag(payload.name, actionSha.value, opts)
}

const onResetSubmit = async (mode: 'soft' | 'mixed' | 'hard') => {
  resetModalOpen.value = false
  await store.resetTo(actionSha.value, mode)
}

const onCheckoutCommitConfirm = async () => {
  checkoutCommitConfirm.value = false
  await store.checkoutCommit(actionSha.value)
}

const onCherryPickConfirm = async () => {
  cherryPickConfirm.value = false
  await store.cherryPick(actionSha.value)
}

const onRevertConfirm = async () => {
  revertConfirm.value = false
  await store.revertCommit(actionSha.value)
}

const onSavePatchConfirm = async () => {
  savePatchConfirm.value = false
  const sha = actionSha.value
  const sha7 = actionSha7.value
  const defaultName = `${sha7}.patch`
  const api = typeof window !== 'undefined' ? window.awog : undefined
  let savePath: string | null = null
  if (api) {
    savePath = await api.savePath({
      title: 'Save commit as patch',
      defaultPath: defaultName,
      filters: [{ name: 'Patch', extensions: ['patch'] }],
    })
  } else {
    // Browser fallback — no native dialog, so prompt for an absolute path so
    // the user can still smoke-test the feature. Dev-only path; the Electron
    // build always takes the native dialog branch above.
    // eslint-disable-next-line no-alert
    const fallback = window.prompt('Save patch to (absolute path):', `/tmp/${defaultName}`)
    savePath = fallback?.trim() || null
  }
  if (!savePath) return
  await store.savePatch(sha, savePath)
}

async function openCompare(sha: string) {
  compareOpen.value = true
  compareLoading.value = true
  compareFiles.value = []
  try {
    compareFiles.value = await store.loadDiffCommitVsWorkingTree(sha)
  } finally {
    compareLoading.value = false
  }
}
</script>
