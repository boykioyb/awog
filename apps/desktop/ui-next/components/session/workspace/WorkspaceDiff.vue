<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Git link header — real current branch + ahead / session-changed counts,
         plus a quick action to open the full Git Manager over the session. -->
    <div
      v-if="ready && !noRepo"
      class="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3"
    >
      <GitBranch class="size-3.5 text-muted-foreground" />
      <span class="truncate text-xs font-medium text-foreground">{{ branch || '—' }}</span>
      <span class="text-xs text-muted-foreground tabular-nums">
        {{ t('sessions.workspace.changed', { ahead, changed: changedCount }) }}
      </span>
      <span class="ml-auto flex items-center gap-0.5">
        <Button
          variant="ghost"
          class="h-auto p-0 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          :title="t('sessions.workspace.openGit')"
          :aria-label="t('sessions.workspace.openGit')"
          @click="openGit"
        >
          <SquareArrowOutUpRight class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          class="h-auto p-0 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          :title="t('sessions.workspace.refresh')"
          :aria-label="t('sessions.workspace.refresh')"
          @click="load"
        >
          <RotateCw class="size-3.5" :class="{ 'animate-spin': loading }" />
        </Button>
      </span>
    </div>

    <!-- Unavailable / no-repo / empty states -->
    <div v-if="!ready" class="empty" style="padding: 30px">
      <div class="et">{{ unavailableMsg }}</div>
    </div>
    <div v-else-if="noRepo" class="empty" style="padding: 30px">
      <div class="et">{{ t('sessions.workspace.diff.noRepo') }}</div>
    </div>
    <div v-else-if="!files.length" class="empty" style="padding: 30px">
      <div class="et">{{ t('sessions.workspace.diff.none') }}</div>
    </div>

    <template v-else>
      <!-- Changed-file list — click a file to open it in the shared full-window
           PreviewModal (workspaceRoot + path → fs.readFile). The full +/- diff
           stays one click away via the "Open Git" button above. -->
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Button
          v-for="f in files"
          :key="f.path"
          variant="ghost"
          class="h-auto p-0 flex h-7 w-full items-center gap-2 px-3 text-left font-mono text-xs text-muted-foreground transition-colors hover:bg-accent"
          @click="openFile(f)"
        >
          <!-- status letter — M amber / A green / D red -->
          <span class="w-3 shrink-0 text-center font-semibold" :class="statusClass(f.changeType)">
            {{ statusLetter(f.changeType) }}
          </span>
          <span class="min-w-0 flex-1 truncate text-foreground">{{ f.path }}</span>
          <span
            v-if="f.additions || f.deletions"
            class="ml-auto flex shrink-0 items-center gap-1.5 text-xs tabular-nums"
          >
            <span v-if="f.additions" class="text-success">+{{ f.additions }}</span>
            <span v-if="f.deletions" class="text-destructive">−{{ f.deletions }}</span>
          </span>
        </Button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Diff tab (§5/§10) — real working-tree changes via git.status for the session's
// resolved workspace root. Renders the changed-file list; clicking a file opens it
// in the shared full-window PreviewModal (usePreview) rather than an inline diff
// pane. Degrades to an empty/disabled state when the engine bridge is absent or the
// root can't be resolved (browser-dev).
import { GitBranch, RotateCw, SquareArrowOutUpRight } from 'lucide-vue-next'
import type { Session } from '~/composables/useSessionsData'
import {
  SidecarError,
  SidecarUnavailableError,
  useSidecar,
  type UnlistenFn,
} from '~/composables/useSidecar'
import { useWorkspaceData } from '~/composables/useWorkspaceData'
import { useGitModal } from '~/composables/useGitModal'
import { usePreview, previewKindFromPath } from '~/composables/usePreview'
import { absFileScope } from '~/composables/useFilePreview'
import { useSessionTouchedPaths } from '~/composables/useSessionTouchedPaths'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const sc = useSidecar()
const gitModal = useGitModal()
const preview = usePreview()
const { root, ready } = useWorkspaceData(() => props.session.project)
// Workspace-relative paths this session wrote/edited (shared with the Preview tab).
const { touchedPaths } = useSessionTouchedPaths(
  () => props.session,
  () => root.value,
)

function openGit(): void {
  gitModal.open(props.session.project)
}

// ── Sidecar git shapes (mirror sidecar/src/git/types.ts) ─────────────────────
type GitFileChangeType =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'conflicted'
  | 'type_changed'
type GitFileStageState = 'staged' | 'unstaged' | 'untracked' | 'conflicted'
type SidecarGitFileStatus = {
  path: string
  oldPath?: string
  changeType: GitFileChangeType
  stageState: GitFileStageState
  isBinary: boolean
  additions?: number
  deletions?: number
}
type SidecarGitStatus = {
  files: SidecarGitFileStatus[]
  branch: string
  ahead: number
  behind: number
}

// Raw working-tree status from git.status (whole repo). It is NOT the source of the
// file list — `files` is driven by the paths THIS session touched (see touchedPaths);
// rawFiles only enriches a still-uncommitted entry with its live change type + counts.
const rawFiles = ref<SidecarGitFileStatus[]>([])
const loading = ref(false)
const noRepo = ref(false)
// Real current branch + ahead count for the header (replaces the old static meta).
const branch = ref('')
const ahead = ref(0)

// ── Session-scoped file list ─────────────────────────────────────────────────
// Bidirectional suffix match tolerates a base-path mismatch in either direction
// (a step path carrying an extra ancestor prefix, or a multi-repo subfolder prefix
// on the git.status path).
function pathsMatch(a: string, b: string): boolean {
  const x = a.replace(/\\/g, '/')
  const y = b.replace(/\\/g, '/')
  return x === y || x.endsWith('/' + y) || y.endsWith('/' + x)
}

// Source of truth = the paths this session wrote/edited (transcript-derived), so a
// file stays listed after the session commits it — the tab reflects the session's
// work, not the git working tree. git.status only enriches a still-uncommitted entry
// with its live change type + `+/-` counts; a touched file no longer in the working
// tree (already committed, or the edit was later reverted) is listed as a plain
// modification (clicking opens its current on-disk content).
const files = computed<SidecarGitFileStatus[]>(() => {
  const live = rawFiles.value.filter((f) => f.changeType !== 'ignored')
  return touchedPaths.value.map<SidecarGitFileStatus>((tp) => {
    const match = live.find((f) => pathsMatch(f.path, tp))
    return match ?? { path: tp, changeType: 'modified', stageState: 'staged', isBinary: false }
  })
})

const changedCount = computed(() => files.value.length)
const unavailableMsg = computed(() =>
  sc.available ? t('sessions.workspace.noProject') : t('sessions.workspace.unavailable'),
)

const STATUS_LETTER: Record<GitFileChangeType, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
  conflicted: '!',
  type_changed: 'T',
  ignored: 'I',
}
const statusLetter = (c: GitFileChangeType): string => STATUS_LETTER[c] ?? 'M'
// M → warning, A/U → success, D/! → destructive (proto diff-list convention).
const statusClass = (c: GitFileChangeType): string => {
  if (c === 'added' || c === 'untracked') return 'text-success'
  if (c === 'deleted' || c === 'conflicted') return 'text-destructive'
  return 'text-warning'
}

const gitCodeOf = (err: unknown): string | null => {
  if (!(err instanceof SidecarError)) return null
  return (err.data as { gitCode?: string } | undefined)?.gitCode ?? null
}

// Open a changed file in the shared full-window PreviewModal (workspaceRoot + path
// → fs.readFile). A binary file with no useful text view falls back to the modal's
// file placeholder.
function openFile(f: SidecarGitFileStatus): void {
  const r = root.value
  if (!r) return
  let ws = r
  let p = f.path
  if (p.startsWith('/')) {
    // Touched path tuyệt đối: trong root → cắt prefix; ngoài root (file của
    // session worktree) → scope về thư mục cha, KHÔNG ghép vào root của phiên.
    if (p.startsWith(r + '/')) p = p.slice(r.length + 1)
    else {
      const s = absFileScope(p)
      if (s) {
        ws = s.root
        p = s.rel
      }
    }
  }
  const kind = previewKindFromPath(p)
  preview.open({
    name: p.split('/').pop() || p,
    kind: f.isBinary && kind === 'text' ? 'file' : kind,
    workspaceRoot: ws,
    path: p,
  })
}

async function load(): Promise<void> {
  if (!root.value || loading.value) return
  loading.value = true
  try {
    const res = await sc.request<SidecarGitStatus>('git.status', { workspaceRoot: root.value })
    noRepo.value = false
    rawFiles.value = res.files
    branch.value = res.branch
    ahead.value = res.ahead
  } catch (err) {
    if (err instanceof SidecarUnavailableError) return
    if (gitCodeOf(err) === 'NO_REPO') {
      noRepo.value = true
      rawFiles.value = []
      return
    }
    // Other failures → treat as empty rather than crash the tab.
    rawFiles.value = []
  } finally {
    loading.value = false
  }
}

// Re-load when the root resolves (projects may hydrate after mount).
watch(root, () => void load())

// Debounced refresh on git status changes from the watcher.
let unlisten: UnlistenFn | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
async function subscribe(): Promise<void> {
  if (!sc.available) return
  try {
    unlisten = await sc.onEvent((evt) => {
      if (evt.type !== 'git:status:changed') return
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void load()
      }, 200)
    })
  } catch {
    unlisten = null
  }
}

onMounted(() => {
  void load()
  void subscribe()
})
onBeforeUnmount(() => {
  if (refreshTimer) clearTimeout(refreshTimer)
  if (unlisten) unlisten()
})
</script>
