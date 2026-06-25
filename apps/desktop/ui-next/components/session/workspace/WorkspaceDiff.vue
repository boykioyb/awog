<template>
  <div class="wsdiff">
    <!-- Git link header — branch + ahead/changed counts, plus PR/issue refs
         carried by the session's mock git meta (kept from the original panel). -->
    <div v-if="session.git" class="gitlink">
      <div class="gl1">
        <Icon name="branch" />
        <span class="brn">{{ session.git.branch }}</span>
        <span style="font-family: var(--code); font-size: 0.8462rem; color: var(--textDim)">
          {{ t('sessions.workspace.changed', { ahead: session.git.ahead, changed: changedCount }) }}
        </span>
        <button class="wsdiff-refresh" :title="t('sessions.workspace.refresh')" @click="load">
          <Icon name="refresh" :class="{ spin: loading }" style="width: 12px; height: 12px" />
        </button>
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
      <!-- Changed-file list -->
      <div class="wsdiff-files">
        <button
          v-for="f in files"
          :key="f.path"
          class="frow file"
          :style="f.path === selectedPath ? { background: 'var(--bgActive)' } : undefined"
          @click="selectFile(f.path)"
        >
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

      <!-- Diff body for the selected file -->
      <div class="wsdiff-body">
        <div v-if="currentBinary" class="empty" style="padding: 20px">
          <div class="et">{{ t('sessions.workspace.diff.binary') }}</div>
        </div>
        <SessionCodeView
          v-else-if="selectedPath"
          mode="diff"
          :fname="selectedPath"
          :lines="currentLines"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Diff tab (§5/§10) — real working-tree changes via git.status + git.diff for the
// session's resolved workspace root. Renders the changed-file list + a +/- colored
// diff (reusing SessionCodeView's prototype styling). Degrades to an empty/disabled
// state when the engine bridge is absent or the root can't be resolved (browser-dev).
import type { Session, DiffLine } from '~/composables/useSessionsMock'
import {
  SidecarError,
  SidecarUnavailableError,
  useSidecar,
  type UnlistenFn,
} from '~/composables/useSidecar'
import { useWorkspaceData } from '~/composables/useWorkspaceData'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const sc = useSidecar()
const { root, ready } = useWorkspaceData(() => props.session.project)

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
type SidecarGitStatus = { files: SidecarGitFileStatus[] }
type GitDiffLineKind = 'context' | 'add' | 'del' | 'noeol'
type SidecarGitDiffLine = {
  kind: GitDiffLineKind
  oldLineNum?: number
  newLineNum?: number
  content: string
}
type SidecarGitDiffHunk = { header: string; lines: SidecarGitDiffLine[] }
type SidecarGitFileDiff = { path: string; isBinary: boolean; hunks: SidecarGitDiffHunk[] }
type SidecarGitDiff = { files: SidecarGitFileDiff[] }

const files = ref<SidecarGitFileStatus[]>([])
const selectedPath = ref<string | null>(null)
const currentLines = ref<DiffLine[]>([])
const currentBinary = ref(false)
const loading = ref(false)
const noRepo = ref(false)

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

// Map sidecar diff hunks → the prototype DiffLine shape SessionCodeView renders.
function toDiffLines(diff: SidecarGitFileDiff): DiffLine[] {
  const out: DiffLine[] = []
  for (const h of diff.hunks) {
    out.push({ t: '@', s: h.header })
    for (const ln of h.lines) {
      if (ln.kind === 'add') out.push({ t: '+', n: ln.newLineNum, s: ln.content })
      else if (ln.kind === 'del') out.push({ t: '-', n: ln.oldLineNum, s: ln.content })
      else out.push({ t: ' ', n: ln.newLineNum ?? ln.oldLineNum, s: ln.content })
    }
  }
  return out
}

const gitCodeOf = (err: unknown): string | null => {
  if (!(err instanceof SidecarError)) return null
  return (err.data as { gitCode?: string } | undefined)?.gitCode ?? null
}

async function loadDiff(path: string): Promise<void> {
  if (!root.value) return
  const file = files.value.find((f) => f.path === path)
  const kind =
    file?.stageState === 'untracked'
      ? 'untracked'
      : file?.stageState === 'staged'
        ? 'staged'
        : 'workingTree'
  try {
    const res = await sc.request<SidecarGitDiff>('git.diff', {
      kind,
      workspaceRoot: root.value,
      path,
    })
    const first = res.files[0]
    currentBinary.value = first?.isBinary ?? false
    currentLines.value = first ? toDiffLines(first) : []
  } catch (err) {
    if (err instanceof SidecarUnavailableError) return
    currentBinary.value = false
    currentLines.value = []
  }
}

function selectFile(path: string): void {
  selectedPath.value = path
  void loadDiff(path)
}

async function load(): Promise<void> {
  if (!root.value || loading.value) return
  loading.value = true
  try {
    const res = await sc.request<SidecarGitStatus>('git.status', { workspaceRoot: root.value })
    noRepo.value = false
    // Skip ignored entries — they aren't "changes".
    files.value = res.files.filter((f) => f.changeType !== 'ignored')
  } catch (err) {
    if (err instanceof SidecarUnavailableError) return
    if (gitCodeOf(err) === 'NO_REPO') {
      noRepo.value = true
      files.value = []
      return
    }
    // Other failures → treat as empty rather than crash the tab.
    files.value = []
  } finally {
    loading.value = false
  }
}

// Keep the selection valid as the file list changes; auto-select the first file.
watch(
  files,
  (list) => {
    const stillThere = selectedPath.value && list.some((f) => f.path === selectedPath.value)
    if (!stillThere) {
      selectedPath.value = list[0]?.path ?? null
      currentLines.value = []
      currentBinary.value = false
      if (selectedPath.value) void loadDiff(selectedPath.value)
    }
  },
  { immediate: true },
)

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
  flex: 0 0 auto;
  max-height: 40%;
  overflow-y: auto;
  font-family: var(--code);
  font-size: 0.9231rem;
}
.wsdiff-files .frow.file {
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
}
.wsdiff-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border-top: 1px solid var(--border);
  margin-top: 6px;
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
  margin-left: auto;
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
