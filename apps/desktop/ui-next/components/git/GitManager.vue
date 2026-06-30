<template>
  <div class="gitmgr">
    <div class="gcols">
      <GitSidebar
        v-if="!store.notARepo"
        :section="section"
        :dirty-count="store.unstaged.length + store.staged.length"
        :branches="store.branches"
        :remotes="store.remotes"
        :tags="store.tags"
        :stashes="store.stashes"
        :sec-open="secOpen"
        :collapsed="collapsed"
        :search="search"
        :branch-collapsed="bcol"
        :pinned="pinnedBranches"
        :side-w="sideW"
        @update:section="onSelectSection"
        @toggle-section="(k) => (secOpen[k] = !secOpen[k])"
        @toggle-collapse="collapsed = !collapsed"
        @update:search="(v) => (search = v)"
        @new-branch="onNewBranch"
        @new-tag="onNewTag"
        @save-stash="() => store.stashSave()"
        @add-remote="remoteAddOpen = true"
        @context-branch="(e, b) => openMenu(e, { kind: 'branch', branch: b })"
        @context-stash="(e, i) => openMenu(e, { kind: 'stash', index: i })"
        @context-tag="(e, n) => openMenu(e, { kind: 'tag', name: n })"
        @context-remote="(e, n) => openMenu(e, { kind: 'remote', name: n })"
        @toggle-branch-folder="(f) => (bcol[f] = !bcol[f])"
        @toggle-pin="(name) => pins.toggle(name)"
        @resize="(w) => (sideW = w)"
      />

      <div class="gmain">
        <GitPageHeader
          :projects="store.projects"
          :current-project-id="store.currentProjectId"
          :repos="store.repos"
          :repo="store.repo"
          :branch="store.branch"
          :branches="store.branches"
          :ahead="store.ahead"
          :behind="store.behind"
          :is-merging="store.isMerging"
          :is-rebasing="store.isRebasing"
          :has-conflict="store.hasConflict"
          :not-a-repo="store.notARepo"
          :sync-op="store.syncOp"
          @select-project="(id) => store.setProject(id)"
          @select-repo="(r) => store.setRepo(r)"
          @switch-branch="switchBranch"
          @fetch="() => store.fetchRemote()"
          @pull="() => store.pull()"
          @push="openPush"
          @complete-merge="() => store.completeMerge()"
          @abort-merge="() => store.abortMerge()"
          @open-identity="() => (identityOpen = true)"
        />

        <div v-if="store.isDetached" class="gbanner">
          <Icon name="alert" style="width: 14px; height: 14px" />
          <span>{{ t('git.banner.detached', { at: store.detachedAt ?? '' }) }}</span>
        </div>

        <div class="gbody">
          <!-- Not a git repository → offer `git init` + identity setup -->
          <GitInitEmptyState v-if="store.notARepo" />

          <!-- Local Changes -->
          <template v-else-if="section.kind === 'local-changes'">
            <GitChangesList
              :staged="store.staged"
              :unstaged="store.unstaged"
              :ch-tree="chTree"
              :sel="selectedFile"
              :width="midW"
              @toggle-tree="chTree = !chTree"
              @select="(f, s) => (selectedFile = { path: f, staged: s })"
              @discard="onDiscard"
              @discard-all="onDiscardAll"
              @toggle-stage="onToggleStage"
              @stage-all="onStageAll"
              @unstage-all="onUnstageAll"
              @context-file="(e, f, s) => openMenu(e, { kind: 'file', file: f, staged: s })"
              @context-folder="(e, p, s) => openMenu(e, { kind: 'folder', path: p, staged: s })"
            />
            <div class="grsz" :class="{ drag: midDragging }" @pointerdown="onMidResize" />
            <div class="detail">
              <GitDiffViewer
                :file="selectedFile?.path ?? null"
                :diff="diffLines"
                :diff-mode="diffMode"
                :staged="selectedFile?.staged ?? false"
                @toggle-diff-mode="diffMode = diffMode === 'split' ? 'unified' : 'split'"
                @stage-file="onStageFile"
                @unstage-file="onUnstageFile"
                @stage-hunk="onStageHunk"
                @unstage-hunk="onUnstageHunk"
              />
              <GitCommitPanel
                :msg="store.commitMessage"
                :staged-count="store.staged.length"
                :commits-count="store.commits.length"
                :generating="store.isGeneratingCommit"
                :committing="store.isCommitting"
                @update-msg="(v) => (store.commitMessage = v)"
                @commit="() => store.commit(store.commitMessage)"
                @amend="() => store.amend(store.commitMessage)"
                @generate="() => store.generateCommitMessage()"
              />
            </div>
          </template>

          <!-- Commit history (All Commits / branch / tag) -->
          <GitHistory
            v-else-if="isHistory"
            :commits="store.commits"
            :sel="commitSel"
            :ctab="ctab"
            :detail-files="detailFiles"
            :detail-diff-by-path="detailDiffByPath"
            @select-commit="(h) => (commitSel = `c:${h}`)"
            @set-tab="(t2) => (ctab = t2)"
            @context-commit="(e, cm) => openMenu(e, { kind: 'commit', commit: cm })"
          />

          <!-- Remote detail -->
          <GitRemoteDetailPane
            v-else-if="section.kind === 'remote'"
            :name="section.name"
            :remotes="store.remotes"
            :sync-op="store.syncOp"
            @fetch="() => store.fetchRemote()"
            @pull="() => store.pull()"
            @push="openPush"
            @set-url="(p) => store.setRemoteUrl(p.name, p)"
          />

          <!-- Stash detail -->
          <GitStashDetailPane
            v-else-if="section.kind === 'stash'"
            :index="section.index"
            :stashes="store.stashes"
            @pop="(i) => store.stashPop(i)"
            @apply="(i) => store.stashApply(i)"
            @drop="(i) => store.stashDrop(i)"
          />

          <!-- Fallback (submodule / unknown) -->
          <div v-else class="gsecempty" style="padding: 40px">{{ t('git.sidebar.empty') }}</div>
        </div>
      </div>
    </div>

    <ContextMenu
      :open="menu !== null"
      :position="menu ?? { x: 0, y: 0 }"
      :items="menuItems"
      @close="menu = null"
      @select="onMenuSelect"
    />

    <GitPromptModal
      :open="prompt !== null"
      :title="prompt?.title ?? ''"
      :model-value="promptValue"
      :placeholder="prompt?.placeholder"
      :submit-label="prompt?.submitLabel"
      @update:model-value="(v) => (promptValue = v)"
      @submit="onPromptSubmit"
      @close="prompt = null"
    />

    <GitIdentityModal :open="identityOpen" @close="identityOpen = false" />

    <GitAuthErrorModal :error="store.pendingAuthError" @close="() => store.clearAuthError()" />

    <GitBranchDeleteModal
      :open="pendingDelete !== null"
      :branch-name="pendingDelete?.name ?? ''"
      :remote-name="pendingDelete ? remoteForBranch(pendingDelete) : null"
      @submit="onConfirmDelete"
      @close="pendingDelete = null"
    />

    <GitRemoteAddModal :open="remoteAddOpen" @submit="onAddRemote" @close="remoteAddOpen = false" />

    <GitBranchCreateModal
      :open="branchCreateOpen"
      :branches="store.branches"
      :current-branch="store.branch"
      @submit="onCreateBranch"
      @close="branchCreateOpen = false"
    />

    <GitPushModal
      :open="pushOpen"
      :current-branch="store.branch"
      :branches="store.branches"
      :remotes="store.remotes"
      :ahead="store.ahead"
      :busy="store.syncOp !== null"
      @submit="onPush"
      @close="pushOpen = false"
    />

    <div
      v-for="tt in toasts"
      :key="tt.id"
      class="toast"
      :style="{ borderColor: toastColor(tt.kind) }"
    >
      {{ tt.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
// Git Manager — the production Git Manager UI (ui-next prototype styling) wired to
// the git store (sidecar IPC, with a browser-dev mock fallback). The store owns
// all git DATA + actions; this component owns VIEW state (selection/collapse/etc.)
// and the working-tree diff for the selected file.
//
// Rendered both as the full /git page (pages/git.vue) and inside the session Git
// modal (SessionGitModal.vue). When `projectId` is provided the store is scoped to
// that project on mount so the modal opens on the session's repo.
import type {
  BranchInfo,
  Commit,
  CommitTab,
  DiffLine,
  DiffMode,
  GitFile,
  GitSection,
  GitSelection,
  MenuItem,
  SectionOpen,
} from '~/components/git/git-types'
import type { PushParams } from '~/composables/useGitApi'
import { type DeleteBranchResult, useGitStore } from '~/stores/git'

const props = defineProps<{ projectId?: string }>()

const { t } = useI18n()
const store = useGitStore()
const { confirm } = useConfirm()
const { toasts, pushToast, toastColor } = useToasts()

// Pinned branches (persisted per project) — floated to the top of the sidebar.
const pins = useGitBranchPins(() => store.currentProjectId)
const pinnedBranches = computed(() => [...pins.pinned.value])

// Map a sidecar gitCode (DIRTY_TREE / AUTH_FAILED / …) to a human message; fall
// back to the raw (already-sanitized) error text when the code isn't translated.
function gitErrorMessage(code: string | null, fallback: string): string {
  if (code) {
    const key = `git.error.${code}`
    const msg = t(key)
    if (msg !== key) return msg
  }
  return fallback || t('git.error.UNKNOWN')
}

// Any mutating op that fails surfaces via store.lastError (instead of a silent
// console.warn) → toast it so the user sees what happened.
watch(
  () => store.lastError,
  (e) => {
    if (e) pushToast(gitErrorMessage(e.code, e.message), 'error')
  },
)

// Success notices for fetch/pull/push (incl. the "Already up to date" case) so the
// ops give visible confirmation instead of silently doing nothing.
watch(
  () => store.lastNotice,
  (n) => {
    if (n) pushToast(t(n.key, n.params ?? {}), 'success')
  },
)

// Switch branch. `git checkout` refuses to clobber uncommitted changes
// (DIRTY_TREE) — offer to stash them first, then retry. Other failures toast.
async function switchBranch(name: string) {
  const res = await store.checkoutBranch(name)
  if (res.ok) return
  if (res.code === 'DIRTY_TREE') {
    const ok = await confirm({
      title: t('git.checkoutDirty.title'),
      description: t('git.checkoutDirty.desc', { name }),
      kind: 'primary',
      confirmLabel: t('git.checkoutDirty.stashSwitch'),
    })
    if (!ok) return
    // Stash failed (e.g. nothing to stash) → its error already surfaced via
    // store.lastError; don't retry the checkout onto a still-dirty tree.
    // includeUntracked: the blocker may be untracked files, which a plain stash
    // leaves behind ("No local changes to save") → checkout stays refused.
    if (!(await store.stashSave(undefined, { includeUntracked: true }))) return
    const retry = await store.checkoutBranch(name)
    if (retry.ok) pushToast(t('git.checkoutDirty.stashed', { name }), 'success')
    else pushToast(gitErrorMessage(retry.code, retry.message), 'error')
    return
  }
  pushToast(gitErrorMessage(res.code, res.message), 'error')
}

// Delete a local branch via a confirm modal that also offers deleting the
// matching remote branch. UNMERGED (`branch -d` refused) → a second danger
// confirm offering a force delete (`-D`), carrying the same remote choice.
const pendingDelete = ref<BranchInfo | null>(null)

// The remote that holds this branch (for the "also delete remote" option):
// prefer the tracked upstream's remote, else any remote with a same-named branch.
function remoteForBranch(b: BranchInfo): string | null {
  const remotes = store.remotes.map((r) => r.name)
  const upstream = b.upstream
  if (upstream) {
    const tracked = remotes.find((n) => upstream === n || upstream.startsWith(`${n}/`))
    if (tracked) return tracked
  }
  return (
    remotes.find((r) => store.branches.some((rb) => rb.remote && rb.name === `${r}/${b.name}`)) ??
    null
  )
}

function onConfirmDelete(payload: { deleteRemote: boolean }) {
  const b = pendingDelete.value
  pendingDelete.value = null
  if (b) void runDelete(b, payload.deleteRemote)
}

async function runDelete(b: BranchInfo, deleteRemote: boolean) {
  const remote = remoteForBranch(b) ?? undefined
  const res = await store.deleteBranch(b.name, { deleteRemote, remote })
  if (!res.ok && res.code === 'UNMERGED') {
    const force = await confirm({
      title: t('git.deleteBranch.unmergedTitle'),
      description: t('git.deleteBranch.unmerged', { name: b.name }),
      kind: 'danger',
      confirmLabel: t('git.deleteBranch.forceConfirm'),
    })
    if (!force) return
    finishDelete(b.name, await store.deleteBranch(b.name, { force: true, deleteRemote, remote }))
    return
  }
  finishDelete(b.name, res)
}

// Toast the outcome + drop a stale pin so a future same-named branch isn't
// silently re-pinned. A failed opt-in remote delete is warned separately (the
// local delete still succeeded).
function finishDelete(name: string, res: DeleteBranchResult) {
  if (!res.ok) {
    pushToast(gitErrorMessage(res.code, res.message), 'error')
    return
  }
  if (pins.isPinned(name)) pins.toggle(name)
  if (res.remoteError) pushToast(t('git.deleteBranch.remoteFailed', { name }), 'error')
  else pushToast(t('git.deleteBranch.deleted', { name }), 'success')
}

// ── View state (component-local; not git data) ──
const section = ref<GitSection>({ kind: 'local-changes' })
const collapsed = ref(false)
const secOpen = reactive<SectionOpen>({
  branches: true,
  remotes: true,
  tags: false,
  stashes: true,
  submodules: false,
})
const search = ref('')
const sideW = ref(240)
const bcol = reactive<Record<string, boolean>>({})
const chTree = ref(true)
const diffMode = ref<DiffMode>('unified')
const ctab = ref<CommitTab>('commit')
// The selected working-tree row + its section (staged vs unstaged). A partially
// staged file is in both sections, so the side determines which diff/actions apply.
const selectedFile = ref<GitSelection | null>(null)
const commitSel = ref<string | null>(null)
const identityOpen = ref(false)
const remoteAddOpen = ref(false)
const branchCreateOpen = ref(false)
const pushOpen = ref(false)

// Single push entry point — header / remote pane / branch+remote context menus
// all open the options dialog (target remote/branch, force, tags, set-upstream)
// rather than firing a bare `git push`.
function openPush() {
  pushOpen.value = true
}

// Dialog confirmed → close + push with the resolved options. Errors surface via
// store.lastError → toast (the store reports, doesn't swallow).
function onPush(params: PushParams) {
  pushOpen.value = false
  void store.push(params)
}

// Add a remote, then jump to it so the user can fetch/push straight away.
async function onAddRemote(payload: { name: string; url: string }) {
  remoteAddOpen.value = false
  const ok = await store.addRemote(payload.name, payload.url)
  if (ok) section.value = { kind: 'remote', name: payload.name }
}

// Create a branch off the chosen base (empty `from` → branch off HEAD).
function onCreateBranch(payload: { name: string; from: string }) {
  branchCreateOpen.value = false
  void store.createBranch(payload.name, payload.from || undefined)
}
const detailFiles = ref<GitFile[]>([])
const detailDiffByPath = ref<Record<string, DiffLine[]>>({})

const {
  width: midW,
  dragging: midDragging,
  onPointerDown: onMidResize,
} = useResizable(304, { min: 220, max: 560 })

const isHistory = computed(
  () =>
    section.value.kind === 'all-commits' ||
    section.value.kind === 'branch' ||
    section.value.kind === 'tag',
)

// Working-tree diff for the selected file. The selected side (staged vs unstaged)
// decides whether to load the index-vs-HEAD diff or the working-tree diff.
const diffLines = ref<DiffLine[]>([])
watch(
  selectedFile,
  async (f) => {
    diffLines.value = f ? await store.loadDiff(f.path, f.staged) : []
  },
  { immediate: true },
)

// Per-commit files + diff for the selected commit in the history view.
watch(
  commitSel,
  async (v) => {
    const sha = v?.startsWith('c:') ? v.slice(2) : null
    if (!sha) {
      detailFiles.value = []
      detailDiffByPath.value = {}
      return
    }
    const res = await store.loadCommitDiff(sha)
    detailFiles.value = res.files
    detailDiffByPath.value = res.diffByPath
  },
  { immediate: true },
)

function onSelectSection(next: GitSection) {
  section.value = next
  if (
    (next.kind === 'all-commits' || next.kind === 'branch' || next.kind === 'tag') &&
    !commitSel.value
  ) {
    const first = store.commits[0]
    if (first) commitSel.value = `c:${first.h}`
  }
}

// Reload the selected file's diff for its current side — called after a staging
// mutation that leaves `selectedFile` pointing at the same row (e.g. stage hunk).
function reloadDiff() {
  const f = selectedFile.value
  if (!f) {
    diffLines.value = []
    return
  }
  void store.loadDiff(f.path, f.staged).then((d) => {
    diffLines.value = d
  })
}

// A whole-file stage/unstage moves the file out of its current section; if it was
// selected there, drop the selection (the user re-picks the side they want).
function clearSelectionFor(file: string) {
  if (selectedFile.value?.path === file) selectedFile.value = null
}

async function onToggleStage(file: string, staged: boolean) {
  if (staged) await store.unstageFile(file)
  else await store.stageFile(file)
  clearSelectionFor(file)
  reloadDiff()
}

async function onStageFile(file: string) {
  await store.stageFile(file)
  clearSelectionFor(file)
  reloadDiff()
}

async function onUnstageFile(file: string) {
  await store.unstageFile(file)
  clearSelectionFor(file)
  reloadDiff()
}

async function onDiscard(file: string) {
  // Discard reverts the working tree irreversibly → gate behind a confirm.
  const ok = await confirm({
    title: t('git.discard.title'),
    description: t('git.discard.one', { file }),
    confirmLabel: t('git.discard.confirm'),
  })
  if (!ok) return
  await store.discardFile(file)
  clearSelectionFor(file)
  reloadDiff()
}

async function onDiscardAll(files: string[]) {
  if (!files.length) return
  const ok = await confirm({
    title: t('git.discard.allTitle'),
    description: t('git.discard.all', { n: files.length }),
    confirmLabel: t('git.discard.confirm'),
  })
  if (!ok) return
  for (const file of files) await store.discardFile(file)
  if (selectedFile.value && files.includes(selectedFile.value.path)) selectedFile.value = null
  reloadDiff()
}

async function onStageAll() {
  await store.stageAll()
  reloadDiff()
}

async function onUnstageAll() {
  await store.unstageAll()
  reloadDiff()
}

// Stage a single hunk — only meaningful from the unstaged side (the staged side
// hides the per-hunk affordance). Selection stays put so the reload shows the
// remaining unstaged hunks.
async function onStageHunk(hunkIndex: number) {
  const f = selectedFile.value
  if (!f || f.staged) return
  await store.stageHunk(f.path, hunkIndex)
  reloadDiff()
}

// Unstage a single hunk — only from the staged side. Selection stays put so the
// reload shows the remaining staged hunks.
async function onUnstageHunk(hunkIndex: number) {
  const f = selectedFile.value
  if (!f || !f.staged) return
  await store.unstageHunk(f.path, hunkIndex)
  reloadDiff()
}

// ── Prompt modal (new branch / rename / tag name) ──
const prompt = ref<{
  title: string
  placeholder?: string
  submitLabel?: string
  onSubmit: (value: string) => void
} | null>(null)
const promptValue = ref('')

function openPrompt(opts: {
  title: string
  value?: string
  placeholder?: string
  submitLabel?: string
  onSubmit: (value: string) => void
}) {
  promptValue.value = opts.value ?? ''
  prompt.value = {
    title: opts.title,
    placeholder: opts.placeholder,
    submitLabel: opts.submitLabel,
    onSubmit: opts.onSubmit,
  }
}

function onPromptSubmit(value: string) {
  const cb = prompt.value?.onSubmit
  prompt.value = null
  const v = value.trim()
  if (cb && v) cb(v)
}

function onNewBranch() {
  branchCreateOpen.value = true
}

// Create a tag at the current HEAD (tagging a specific commit is in the commit menu).
function onNewTag() {
  openPrompt({
    title: t('git.prompt.newTag'),
    placeholder: 'v1.0.0',
    submitLabel: t('git.sidebar.newTag'),
    onSubmit: (name) => void store.tagCreate(name),
  })
}

// ── Context menus (file / branch / stash / tag / remote) ──
type MenuTarget =
  | { kind: 'file'; file: string; staged: boolean }
  | { kind: 'folder'; path: string; staged: boolean }
  | { kind: 'branch'; branch: BranchInfo }
  | { kind: 'stash'; index: number }
  | { kind: 'tag'; name: string }
  | { kind: 'remote'; name: string }
  | { kind: 'commit'; commit: Commit }

const menu = ref<{ x: number; y: number; target: MenuTarget } | null>(null)

function openMenu(e: MouseEvent, target: MenuTarget) {
  // Pass the raw click point — ContextMenu measures its own size and clamps to the
  // viewport (flips/shifts so a tall menu never overflows off-screen).
  menu.value = { x: e.clientX, y: e.clientY, target }
}

const sep: MenuItem = { separator: true }

const menuItems = computed<MenuItem[]>(() => {
  const tgt = menu.value?.target
  if (!tgt) return []

  if (tgt.kind === 'file') {
    const count = store.staged.length + store.unstaged.length
    const openWith: MenuItem[] = [
      { id: 'open:code', label: 'Visual Studio Code' },
      { id: 'open:cursor', label: 'Cursor' },
      { id: 'open:warp', label: 'Warp' },
      { id: 'open:textedit', label: 'TextEdit' },
      { id: 'open:xcode', label: 'Xcode' },
    ]
    const ignore: MenuItem[] = [
      { id: 'ignore:file', label: t('git.ctx.ignoreFile') },
      { id: 'ignore:ext', label: t('git.ctx.ignoreExt') },
      { id: 'ignore:folder', label: t('git.ctx.ignoreFolder') },
    ]
    const items: MenuItem[] = [
      { id: 'open', label: t('git.ctx.open'), hint: '⌥⇧⌘O' },
      { label: t('git.ctx.openWith'), children: openWith },
      { id: 'external-diff', label: t('git.ctx.externalDiff'), hint: '⌘D' },
      { id: 'finder', label: t('git.ctx.showInFinder') },
      sep,
      { id: 'blame', label: t('git.ctx.blame') },
      { id: 'history', label: t('git.ctx.history') },
      sep,
    ]
    if (tgt.staged) {
      items.push(
        { id: 'unstage', label: t('git.ctx.unstage'), hint: '⌘U' },
        { id: 'unstage-all', label: t('git.ctx.unstageAll'), hint: '⌥⇧⌘U' },
      )
    } else {
      items.push(
        { id: 'stage', label: t('git.ctx.stage'), hint: '⌘S' },
        { id: 'discard', label: t('git.ctx.discard'), danger: true, hint: '⇧⌘D' },
        { id: 'stage-all', label: t('git.ctx.stageAll'), hint: '⌥⇧⌘S' },
      )
    }
    items.push(
      sep,
      { label: t('git.ctx.ignore'), children: ignore },
      sep,
      { id: 'stash', label: t('git.ctx.stashFile', { n: count }) },
      { id: 'save-patch', label: t('git.ctx.savePatch') },
      sep,
      { id: 'copy', label: t('git.ctx.copyPath'), hint: '⌘C' },
    )
    return items
  }

  if (tgt.kind === 'folder') {
    const items: MenuItem[] = []
    if (tgt.staged) {
      items.push({ id: 'unstage', label: t('git.ctxFolder.unstage'), icon: 'rewind' })
    } else {
      items.push(
        { id: 'stage', label: t('git.ctxFolder.stage'), icon: 'plus' },
        { id: 'discard', label: t('git.ctxFolder.discard'), icon: 'revert', danger: true },
        { id: 'ignore', label: t('git.ctxFolder.ignore') },
      )
    }
    items.push(sep, { id: 'copy', label: t('git.ctx.copyPath'), hint: '⌘C' })
    return items
  }

  if (tgt.kind === 'commit') {
    return [
      { id: 'checkout', label: t('git.ctx.checkoutCommit'), icon: 'check' },
      { id: 'branch-here', label: t('git.ctx.newBranchHere'), icon: 'plus' },
      { id: 'tag-here', label: t('git.ctx.newTagHere'), icon: 'tag' },
      sep,
      { id: 'cherry-pick', label: t('git.ctx.cherryPick'), icon: 'copy' },
      { id: 'revert', label: t('git.ctx.revert'), icon: 'rewind' },
      {
        label: t('git.ctx.resetToHere'),
        icon: 'refresh',
        children: [
          { id: 'reset:soft', label: t('git.ctx.resetSoft') },
          { id: 'reset:mixed', label: t('git.ctx.resetMixed') },
          { id: 'reset:hard', label: t('git.ctx.resetHard'), danger: true },
        ],
      },
      { id: 'save-patch', label: t('git.ctx.savePatch') },
      sep,
      { id: 'copy-sha', label: t('git.ctx.copySha'), hint: '⌘C' },
      { id: 'copy-msg', label: t('git.ctx.copyMessage') },
    ]
  }

  if (tgt.kind === 'branch') {
    const b = tgt.branch
    const cur = store.branch
    if (b.remote) {
      return [
        { id: 'checkout-local', label: t('git.ctx.checkoutAsLocal'), icon: 'branch' },
        { id: 'fetch', label: t('git.ctx.fetch'), icon: 'refresh' },
        sep,
        { id: 'merge', label: t('git.ctx.merge', { name: cur }), icon: 'merge' },
        { id: 'create-pr', label: t('git.ctx.createPr'), icon: 'fork' },
        sep,
        { id: 'copy', label: t('git.ctx.copy'), icon: 'copy' },
      ]
    }
    const items: MenuItem[] = [
      { id: 'checkout', label: t('git.ctx.checkout'), icon: 'check', disabled: b.current },
      { id: 'create-from', label: t('git.ctx.newFrom'), icon: 'plus' },
      {
        id: 'pin',
        label: pins.isPinned(b.name) ? t('git.ctx.unpin') : t('git.ctx.pin'),
        icon: 'pin',
      },
      sep,
    ]
    if (b.current) {
      items.push(
        { id: 'pull', label: t('git.ctx.pull'), hint: b.behind ? `↓${b.behind}` : undefined },
        { id: 'push', label: t('git.ctx.push'), hint: b.ahead ? `↑${b.ahead}` : undefined },
      )
    } else {
      items.push(
        { id: 'merge', label: t('git.ctx.merge', { name: cur }), icon: 'merge' },
        { id: 'rebase', label: t('git.ctx.rebase'), icon: 'fork' },
      )
    }
    items.push(
      sep,
      { id: 'rename', label: t('git.ctx.rename'), icon: 'edit' },
      { id: 'create-tag', label: t('git.ctx.createTag'), icon: 'tag' },
      { id: 'create-pr', label: t('git.ctx.createPr'), icon: 'fork' },
      sep,
      { id: 'copy', label: t('git.ctx.copy'), icon: 'copy' },
    )
    if (!b.current) {
      items.push({ id: 'delete', label: t('git.ctx.delete'), icon: 'trash', danger: true })
    }
    return items
  }

  if (tgt.kind === 'stash') {
    return [
      { id: 'apply', label: t('git.stash.apply'), icon: 'check' },
      { id: 'pop', label: t('git.stash.pop'), icon: 'rewind' },
      sep,
      { id: 'drop', label: t('git.stash.drop'), icon: 'trash', danger: true },
    ]
  }

  if (tgt.kind === 'tag') {
    return [
      { id: 'checkout', label: t('git.ctx.checkout'), icon: 'check' },
      { id: 'copy', label: t('git.ctx.copy'), icon: 'copy' },
      sep,
      { id: 'delete', label: t('git.ctx.delete'), icon: 'trash', danger: true },
    ]
  }

  // remote
  return [
    { id: 'fetch', label: t('git.ctx.fetch'), icon: 'refresh' },
    { id: 'pull', label: t('git.ctx.pull'), icon: 'rewind' },
    { id: 'push', label: t('git.ctx.push'), icon: 'fork' },
    sep,
    { id: 'copy-url', label: t('git.ctx.copyUrl'), icon: 'copy' },
  ]
})

function onMenuSelect(id: string) {
  const tgt = menu.value?.target
  menu.value = null
  if (!tgt) return
  if (tgt.kind === 'file') dispatchFile(id, tgt.file)
  else if (tgt.kind === 'folder') void dispatchFolder(id, tgt.path, tgt.staged)
  else if (tgt.kind === 'branch') dispatchBranch(id, tgt.branch)
  else if (tgt.kind === 'stash') dispatchStash(id, tgt.index)
  else if (tgt.kind === 'tag') dispatchTag(id, tgt.name)
  else if (tgt.kind === 'remote') dispatchRemote(id, tgt.name)
  else if (tgt.kind === 'commit') void dispatchCommit(id, tgt.commit)
}

const copy = (s: string) => void navigator.clipboard?.writeText(s).catch(() => {})

function dispatchFile(id: string, file: string) {
  if (id === 'stage') void onStageFile(file)
  else if (id === 'unstage') void onToggleStage(file, true)
  else if (id === 'discard') void onDiscard(file)
  else if (id === 'stage-all') void onStageAll()
  else if (id === 'unstage-all') void onUnstageAll()
  else if (id === 'stash') store.stashSave()
  else if (id === 'copy') copy(file)
  else if (id === 'open') void store.openFile(file)
  else if (id === 'finder') void store.revealFile(file)
  else if (id === 'open:code') void store.openInVscode(file)
  else if (id.startsWith('open:')) void store.openFile(file)
  else if (id === 'save-patch') void store.savePatch(file)
  else if (id === 'ignore:file') void store.ignore([file])
  else if (id === 'ignore:ext') {
    const dot = file.lastIndexOf('.')
    if (dot > 0) void store.ignore(['*' + file.slice(dot)])
  } else if (id === 'ignore:folder') {
    const slash = file.lastIndexOf('/')
    void store.ignore([slash > 0 ? file.slice(0, slash + 1) : file])
  }
  // external-diff / blame / history: need a dedicated view (blame/timeline) — no-op.
}

// Files in the given section (staged ↔ unstaged) that live under `path`.
function filesUnderFolder(path: string, isStaged: boolean): string[] {
  const prefix = `${path}/`
  return (isStaged ? store.staged : store.unstaged)
    .map((x) => x.f)
    .filter((f) => f.startsWith(prefix))
}

async function dispatchFolder(id: string, path: string, isStaged: boolean) {
  const files = filesUnderFolder(path, isStaged)
  if (id === 'stage') {
    await store.stagePaths(files)
    reloadDiff()
  } else if (id === 'unstage') {
    await store.unstagePaths(files)
    reloadDiff()
  } else if (id === 'discard') {
    if (!files.length) return
    const ok = await confirm({
      title: t('git.discard.allTitle'),
      description: t('git.discard.folder', { folder: path, n: files.length }),
      confirmLabel: t('git.discard.confirm'),
    })
    if (!ok) return
    await store.discardPaths(files)
    if (selectedFile.value && files.includes(selectedFile.value.path)) selectedFile.value = null
    reloadDiff()
  } else if (id === 'ignore') {
    void store.ignore([`${path}/`])
  } else if (id === 'copy') {
    copy(path)
  }
}

async function dispatchCommit(id: string, c: Commit) {
  const sha = c.sha || c.h
  if (id === 'copy-sha') return copy(sha)
  if (id === 'copy-msg') return copy(c.m)
  if (id === 'save-patch') return void store.savePatch()
  if (id === 'branch-here')
    return openPrompt({
      title: t('git.prompt.newBranch'),
      placeholder: 'feature/…',
      submitLabel: t('git.sidebar.newBranch'),
      onSubmit: (name) => void store.createBranch(name, sha),
    })
  if (id === 'tag-here')
    return openPrompt({
      title: t('git.prompt.newTag'),
      placeholder: 'v1.0.0',
      submitLabel: t('git.ctx.createTag'),
      onSubmit: (name) => void store.tagCreate(name, sha),
    })
  // Destructive / history-rewriting ops gate behind a confirm.
  if (id === 'checkout') {
    if (
      await confirm({
        title: t('git.confirm.checkoutCommitTitle'),
        description: t('git.confirm.checkoutCommit', { sha: c.h }),
        kind: 'primary',
        confirmLabel: t('git.ctx.checkoutCommit'),
      })
    )
      await store.checkoutCommit(sha)
    return
  }
  if (id === 'cherry-pick') {
    if (
      await confirm({
        title: t('git.confirm.cherryPickTitle'),
        description: t('git.confirm.cherryPick', { sha: c.h }),
        kind: 'primary',
        confirmLabel: t('git.ctx.cherryPick'),
      })
    )
      await store.cherryPick(sha)
    return
  }
  if (id === 'revert') {
    if (
      await confirm({
        title: t('git.confirm.revertTitle'),
        description: t('git.confirm.revert', { sha: c.h }),
        kind: 'primary',
        confirmLabel: t('git.ctx.revert'),
      })
    )
      await store.revertCommit(sha)
    return
  }
  if (id === 'reset:soft' || id === 'reset:mixed' || id === 'reset:hard') {
    const mode = id.slice('reset:'.length) as 'soft' | 'mixed' | 'hard'
    if (
      await confirm({
        title: t('git.confirm.resetTitle'),
        description: t(`git.confirm.reset.${mode}`, { sha: c.h }),
        kind: mode === 'hard' ? 'danger' : 'primary',
      })
    )
      await store.resetTo(sha, mode)
  }
}

function dispatchBranch(id: string, b: BranchInfo) {
  if (id === 'checkout') void switchBranch(b.name)
  else if (id === 'checkout-local') void switchBranch(b.name.replace(/^origin\//, ''))
  else if (id === 'create-from')
    openPrompt({
      title: t('git.prompt.newBranch'),
      placeholder: 'feature/…',
      submitLabel: t('git.sidebar.newBranch'),
      onSubmit: (name) => void store.createBranch(name, b.name),
    })
  else if (id === 'rename')
    openPrompt({
      title: t('git.prompt.renameBranch'),
      value: b.name,
      submitLabel: t('git.ctx.rename'),
      onSubmit: (next) => {
        if (next !== b.name) void store.renameBranch(b.name, next)
      },
    })
  else if (id === 'create-tag')
    openPrompt({
      title: t('git.prompt.newTag'),
      placeholder: 'v1.0.0',
      submitLabel: t('git.ctx.createTag'),
      onSubmit: (name) => void store.tagCreate(name),
    })
  else if (id === 'create-pr') void store.openPrFor(b.name)
  else if (id === 'pin') pins.toggle(b.name)
  else if (id === 'pull') store.pull()
  else if (id === 'push') openPush()
  else if (id === 'merge') store.merge(b.name)
  else if (id === 'rebase') store.rebase(b.name)
  else if (id === 'copy') copy(b.name)
  else if (id === 'delete') pendingDelete.value = b
  else if (id === 'fetch') store.fetchRemote()
}

function dispatchStash(id: string, index: number) {
  if (id === 'apply') store.stashApply(index)
  else if (id === 'pop') store.stashPop(index)
  else if (id === 'drop') store.stashDrop(index)
}

function dispatchTag(id: string, name: string) {
  if (id === 'copy') copy(name)
  else if (id === 'checkout') store.checkoutTag(name)
  else if (id === 'delete') store.deleteTag(name)
}

function dispatchRemote(id: string, name: string) {
  if (id === 'fetch') store.fetchRemote()
  else if (id === 'pull') store.pull()
  else if (id === 'push') openPush()
  else if (id === 'copy-url') copy(store.remotes.find((r) => r.name === name)?.fetchUrl ?? name)
}

onMounted(async () => {
  await store.init()
  // Scope the store to the requested project (session Git modal). A session keys
  // its project by NAME (e.g. 'awog'), not id — match either against the loaded
  // roster, then drive the store by the real id. Skip when already current.
  if (props.projectId) {
    const match =
      store.projects.find((p) => p.id === props.projectId) ??
      store.projects.find((p) => p.name === props.projectId)
    if (match && match.id !== store.currentProjectId) await store.setProject(match.id)
  }
})
onUnmounted(() => {
  store.unsubscribe()
})
</script>

<style scoped>
/* Fills its host: the .page column (full /git route) or the modal body. .gcols
   already flexes to fill, so this just carries the height chain down. */
.gitmgr {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
