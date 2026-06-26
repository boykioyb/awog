<template>
  <div class="wsdiff">
    <!-- Git link header — real current branch + ahead / session-changed counts,
         plus a quick action to open the full Git Manager over the session. -->
    <div v-if="ready && !noRepo" class="gitlink">
      <div class="gl1">
        <Icon name="branch" />
        <span class="brn">{{ branch || '—' }}</span>
        <span style="font-family: var(--code); font-size: 0.8462rem; color: var(--textDim)">
          {{ t('sessions.workspace.changed', { ahead, changed: changedCount }) }}
        </span>
        <span style="margin-left: auto; display: inline-flex; gap: 2px">
          <button class="wsdiff-refresh" :title="t('sessions.workspace.openGit')" @click="openGit">
            <Icon name="git" style="width: 12px; height: 12px" />
          </button>
          <button class="wsdiff-refresh" :title="t('sessions.workspace.refresh')" @click="load">
            <Icon name="refresh" :class="{ spin: loading }" style="width: 12px; height: 12px" />
          </button>
        </span>
      </div>
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
      <div class="wsdiff-files">
        <button v-for="f in files" :key="f.path" class="frow file" @click="openFile(f)">
          <span class="fst" :class="statusClass(f.changeType)">
            {{ statusLetter(f.changeType) }}
          </span>
          <span class="fn" style="flex: 1; overflow: hidden; text-overflow: ellipsis">
            {{ f.path }}
          </span>
          <span v-if="f.additions || f.deletions" class="wsdiff-counts">
            <span v-if="f.additions" style="color: var(--add)">+{{ f.additions }}</span>
            <span v-if="f.deletions" style="color: var(--del)">−{{ f.deletions }}</span>
          </span>
        </button>
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
import type { Session } from '~/composables/useSessionsMock'
import {
  SidecarError,
  SidecarUnavailableError,
  useSidecar,
  type UnlistenFn,
} from '~/composables/useSidecar'
import { useWorkspaceData } from '~/composables/useWorkspaceData'
import { useGitModal } from '~/composables/useGitModal'
import { usePreview, type PreviewRef } from '~/composables/usePreview'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const sc = useSidecar()
const gitModal = useGitModal()
const preview = usePreview()
const { root, ready } = useWorkspaceData(() => props.session.project)

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

// Raw working-tree status from git.status (whole repo); `files` narrows it to the
// paths THIS session touched (see touchedPaths) so the Diff tab shows the
// session's changes, not the repo's.
const rawFiles = ref<SidecarGitFileStatus[]>([])
const loading = ref(false)
const noRepo = ref(false)
// Real current branch + ahead count for the gitlink header (replaces mock meta).
const branch = ref('')
const ahead = ref(0)

// ── Session-scoped change filter ─────────────────────────────────────────────
// A session "touched" a file when one of its file-writing tool steps (Write /
// Edit / MultiEdit / NotebookEdit — incl. subagent steps) named it. These labels
// are emitted verbatim by the sidecar step-mapper (humanLabel), so matching on the
// label is stable; Read/search/terminal don't reliably name an edited path.
const WRITE_LABELS = new Set(['Write', 'Edit', 'Edit (multi)', 'Edit notebook'])

// Normalise a step target (absolute or workspace-relative, possibly anchored to an
// ancestor cwd — see memory session-file-link-path-base) toward a repo-relative
// path comparable to git.status output.
function normalizeTouched(target: string): string {
  let p = target.trim().replace(/\\/g, '/')
  const r = root.value
  if (p.startsWith('/') && r && p.startsWith(r)) p = p.slice(r.length)
  return p.replace(/^\.\//, '').replace(/^\/+/, '')
}

const touchedPaths = computed<string[]>(() => {
  const out = new Set<string>()
  const add = (tool: string, target: string): void => {
    if (target && WRITE_LABELS.has(tool)) {
      const n = normalizeTouched(target)
      if (n) out.add(n)
    }
  }
  for (const m of props.session.msgs) {
    if (m.role !== 'assistant') continue
    for (const b of m.blocks) {
      if (b.kind !== 'step') continue
      add(b.tool, b.target)
      if (b.sub) for (const s of b.sub.steps) add(s.tool, s.target)
    }
  }
  return [...out]
})

// Bidirectional suffix match tolerates a base-path mismatch in either direction
// (the step path carrying an extra ancestor prefix, or a multi-repo subfolder
// prefix on the git.status path).
function isTouched(statusPath: string): boolean {
  const sp = statusPath.replace(/\\/g, '/')
  return touchedPaths.value.some(
    (tp) => sp === tp || tp.endsWith('/' + sp) || sp.endsWith('/' + tp),
  )
}

const files = computed<SidecarGitFileStatus[]>(() =>
  // Skip ignored entries — they aren't "changes" — then keep only session-touched.
  rawFiles.value.filter((f) => f.changeType !== 'ignored' && isTouched(f.path)),
)

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
const statusClass = (c: GitFileChangeType): Record<string, boolean> => ({
  a: c === 'added' || c === 'untracked',
  m: c !== 'added' && c !== 'untracked' && c !== 'deleted',
})

const gitCodeOf = (err: unknown): string | null => {
  if (!(err instanceof SidecarError)) return null
  return (err.data as { gitCode?: string } | undefined)?.gitCode ?? null
}

// Preview kind from the file extension (the modal reads the real content itself).
function kindOf(path: string): PreviewRef['kind'] {
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(path)) return 'image'
  if (/\.pdf$/i.test(path)) return 'pdf'
  if (/\.(md|markdown)$/i.test(path)) return 'markdown'
  return 'text'
}

// Open a changed file in the shared full-window PreviewModal (workspaceRoot + path
// → fs.readFile). A binary file with no useful text view falls back to the modal's
// file placeholder.
function openFile(f: SidecarGitFileStatus): void {
  if (!root.value) return
  const kind = kindOf(f.path)
  preview.open({
    name: f.path.split('/').pop() || f.path,
    kind: f.isBinary && kind === 'text' ? 'file' : kind,
    workspaceRoot: root.value,
    path: f.path,
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

<style scoped>
.wsdiff {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.wsdiff-files {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  font-family: var(--code);
  font-size: 0.9231rem;
}
.wsdiff-files .frow.file {
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  cursor: pointer;
}
.wsdiff-counts {
  margin-left: auto;
  font-family: var(--code);
  font-size: 12px;
  display: inline-flex;
  gap: 6px;
  flex: 0 0 auto;
}
.wsdiff-refresh {
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
  padding: 2px;
  display: inline-flex;
}
.wsdiff-refresh:hover {
  color: var(--text);
}
.spin {
  animation: wsdiff-spin 1s linear infinite;
}
@keyframes wsdiff-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
