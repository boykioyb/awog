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
          :conflicted-count="store.conflicted.length"
          :not-a-repo="store.notARepo"
          :sync-op="store.syncOp"
          :gh-account="store.activeGhAccount"
          @select-project="(id) => store.setProject(id)"
          @select-repo="(r) => store.setRepo(r)"
          @switch-branch="switchBranch"
          @fetch="() => store.fetchRemote()"
          @pull="() => store.pull()"
          @push="openPush"
          @cancel="(op) => store.cancel(op)"
          @complete-merge="() => store.completeMerge()"
          @abort-merge="onAbortMerge"
          @open-identity="() => (identityOpen = true)"
          @open-account="openAccountSetting"
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
              :conflicted="store.conflicted"
              :ch-tree="chTree"
              :sel="selectedFile"
              :sel-unstaged="selUnstaged"
              :sel-staged="selStaged"
              :width="midW"
              @toggle-tree="chTree = !chTree"
              @select="onSelect"
              @select-conflict="(f) => selectConflict(f)"
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
              <!-- Conflicted file → 2-way resolver (replaces the diff viewer). A
                   normal file row keeps the diff viewer + commit panel below. -->
              <GitConflictResolver
                v-if="selectedFile?.kind === 'conflict'"
                :key="selectedFile.path"
                :path="selectedFile.path"
                @resolved="onConflictResolved"
              />
              <template v-else>
                <GitDiffViewer
                  :file="selectedFile?.kind === 'file' ? selectedFile.path : null"
                  :diff="diffLines"
                  :diff-mode="diffMode"
                  :is-image="selectedIsImage"
                  :image-src="imageSrc"
                  :image-loading="imageLoading"
                  :staged="selectedFile?.kind === 'file' ? selectedFile.staged : false"
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
              </template>
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
            @context-file="(e, f) => openMenu(e, { kind: 'commit-file', file: f })"
          />

          <!-- Remote detail -->
          <GitRemoteDetailPane
            v-else-if="section.kind === 'remote'"
            :name="section.name"
            :remotes="store.remotes"
            :sync-op="store.syncOp"
            :auto-edit="remoteEditName === section.name"
            @fetch="() => store.fetchRemote()"
            @pull="() => store.pull()"
            @push="openPush"
            @cancel="(op) => store.cancel(op)"
            @set-url="(p) => store.setRemoteUrl(p.name, p)"
            @edit-consumed="remoteEditName = null"
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
  GitRightPaneSel,
  GitSection,
  MenuItem,
  SectionOpen,
  SelMods,
} from '~/components/git/git-types'
import { isImagePath } from '~/components/git/git-types'
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
// The selected right-pane target: a working-tree file (diff, keyed by staged side)
// or a conflicted file (resolver). A partially staged file is in both sections, so
// the side determines which diff/actions apply. `null` = nothing selected.
const commitSel = ref<string | null>(null)

// ── Working-tree multi-selection ──────────────────────────────────────────
// A pure selection for bulk operations — it highlights rows and never stages.
// Scoped to ONE zone at a time (`selZone`: true=staged, false=unstaged) so a bulk
// action always maps to a single verb; selecting in the other zone resets it. The
// diff-focused row (`selectedFile`) is separate: plain-click both single-selects
// and opens the diff; ⌘/Ctrl-click toggles membership without losing the others.
const selectedFile = ref<GitRightPaneSel>(null)
const selZone = ref<boolean | null>(null)
const selPaths = ref<Set<string>>(new Set())
const NO_SEL: Set<string> = new Set()

// Per-zone view of the selection (empty for the inactive zone).
const selUnstaged = computed(() => (selZone.value === false ? selPaths.value : NO_SEL))
const selStaged = computed(() => (selZone.value === true ? selPaths.value : NO_SEL))

// A ⌘/Ctrl-guarded multi-selection over the clicked file's zone — the target for
// bulk Stage/Unstage/Discard, or null when the click is a plain single selection.
function selectionFor(file: string, staged: boolean): string[] | null {
  if (selZone.value !== staged || selPaths.value.size <= 1 || !selPaths.value.has(file)) return null
  return [...selPaths.value]
}

function onSelect(file: string, staged: boolean, mods: SelMods) {
  if (mods.meta) {
    // ⌘/Ctrl-click → toggle membership; a different zone starts a fresh selection.
    const next = new Set(selZone.value === staged ? selPaths.value : [])
    if (next.has(file)) next.delete(file)
    else next.add(file)
    selPaths.value = next
    selZone.value = next.size ? staged : null
  } else {
    // Plain click → single selection.
    selPaths.value = new Set([file])
    selZone.value = staged
  }
  // Focus (diff pane) always follows the clicked file.
  selectedFile.value = { kind: 'file', path: file, staged }
}

// A conflicted row opens the resolver — clear any working-tree multi-selection.
function selectConflict(file: string) {
  clearSelection()
  selectedFile.value = { kind: 'conflict', path: file }
}

// Select all / Deselect all — pure selection, no staging (restores the menu items
// under their true meaning: the old "Select all" secretly staged everything).
function selectAllInZone(staged: boolean) {
  const files = staged ? store.staged : store.unstaged
  selPaths.value = new Set(files.map((f) => f.f))
  selZone.value = files.length ? staged : null
}
function clearSelection() {
  if (selPaths.value.size) selPaths.value = new Set()
  selZone.value = null
}
// A file left its zone (staged/unstaged/discarded) → drop it from the selection so
// no stale highlight lingers.
function dropFromSelection(file: string) {
  if (!selPaths.value.has(file)) return
  const next = new Set(selPaths.value)
  next.delete(file)
  selPaths.value = next
  if (!next.size) selZone.value = null
}
const identityOpen = ref(false)
const remoteAddOpen = ref(false)
// Remote whose detail pane should open straight into URL-edit mode (set by the
// "Edit URLs…" context-menu action; consumed + cleared by the pane on open).
const remoteEditName = ref<string | null>(null)
const branchCreateOpen = ref(false)
const pushOpen = ref(false)
// The PR summary modal is app-wide (GitPrSummaryHost in the layout) so ⌘I can open
// it too; the branch context menu just drives it via this shared store.
const prSummary = usePrSummaryModal()

// Single push entry point — header / remote pane / branch+remote context menus
// all open the options dialog (target remote/branch, force, tags, set-upstream)
// rather than firing a bare `git push`.
function openPush() {
  pushOpen.value = true
}

// The header's gh-account chip → open the current project's quick-view (Overview)
// where the GitHub-account setting lives, so it can be changed without leaving Git.
function openAccountSetting() {
  if (store.currentProjectId) useProjectModal().open(store.currentProjectId)
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
// Image preview: an image row has a binary git diff (no hunks) → render its
// on-disk bytes as an <img> instead of empty diff text.
const selectedIsImage = computed(
  () => selectedFile.value?.kind === 'file' && isImagePath(selectedFile.value.path),
)
const imageSrc = ref<string | null>(null)
const imageLoading = ref(false)
watch(
  selectedFile,
  async (f) => {
    // Only a `file` selection has a diff; a `conflict` selection renders the
    // resolver (which loads its own content) and needs no working-tree diff.
    if (f?.kind !== 'file') {
      diffLines.value = []
      imageSrc.value = null
      imageLoading.value = false
      return
    }
    if (isImagePath(f.path)) {
      diffLines.value = []
      imageSrc.value = null
      imageLoading.value = true
      const src = await store.loadImageDataUrl(f.path)
      // Guard against a stale resolve: a newer selection may have superseded this
      // one while the file read was in flight.
      if (selectedFile.value === f) {
        imageSrc.value = src
        imageLoading.value = false
      }
      return
    }
    imageSrc.value = null
    imageLoading.value = false
    diffLines.value = await store.loadDiff(f.path, f.staged)
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
  if (f?.kind !== 'file') {
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
  const f = selectedFile.value
  if (f?.kind === 'file' && f.path === file) selectedFile.value = null
  // The file also left its zone, so drop it from any multi-selection.
  dropFromSelection(file)
}

// A conflicted file was resolved (staged) → close the resolver; the store already
// ran loadStatus, so the file has left the Conflicted section. When the last
// conflict clears, the header banner/Complete button re-enable reactively.
function onConflictResolved() {
  selectedFile.value = null
}

// Abort the whole merge/rebase — confirm first (destructive: in-progress resolver
// picks are lost, working tree reverts). On abort the resolver is closed so the
// right pane returns to an empty diff.
async function onAbortMerge() {
  const ok = await confirm({
    title: t('git.header.' + (store.isRebasing ? 'abortRebase' : 'abortMerge')),
    description: t('git.conflict.abortConfirm'),
    kind: 'danger',
  })
  if (!ok) return
  if (selectedFile.value?.kind === 'conflict') selectedFile.value = null
  await store.abortMerge()
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
  // One batched API call + one status reload (vs. N per-file discards).
  await store.discardPaths(files)
  const sel = selectedFile.value
  if (sel?.kind === 'file' && files.includes(sel.path)) selectedFile.value = null
  clearSelection()
  reloadDiff()
}

// Bulk stage / unstage a multi-selection (⌘-click set or Select-all). Discarding a
// selection reuses onDiscardAll (confirm + batched discardPaths + clear).
async function onStageSelected(files: string[]) {
  await store.stagePaths(files)
  clearSelection()
  reloadDiff()
}
async function onUnstageSelected(files: string[]) {
  await store.unstagePaths(files)
  clearSelection()
  reloadDiff()
}

// Context-menu "Discard all" — list-wide counterpart to Select all / Deselect
// all: revert every working-tree change across both sections. A partially staged
// file appears in both, so de-dup the union before confirming/discarding.
function onDiscardAllChanges() {
  const all = [...new Set([...store.staged, ...store.unstaged].map((x) => x.f))]
  void onDiscardAll(all)
}

async function onStageAll() {
  await store.stageAll()
  clearSelection()
  reloadDiff()
}

async function onUnstageAll() {
  await store.unstageAll()
  clearSelection()
  reloadDiff()
}

// Stage a single hunk — only meaningful from the unstaged side (the staged side
// hides the per-hunk affordance). Selection stays put so the reload shows the
// remaining unstaged hunks.
async function onStageHunk(hunkIndex: number) {
  const f = selectedFile.value
  if (f?.kind !== 'file' || f.staged) return
  await store.stageHunk(f.path, hunkIndex)
  reloadDiff()
}

// Unstage a single hunk — only from the staged side. Selection stays put so the
// reload shows the remaining staged hunks.
async function onUnstageHunk(hunkIndex: number) {
  const f = selectedFile.value
  if (f?.kind !== 'file' || !f.staged) return
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
  | { kind: 'commit-file'; file: string }
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
      { id: 'open', label: t('git.ctx.open') },
      { label: t('git.ctx.openWith'), children: openWith },
      { id: 'external-diff', label: t('git.ctx.externalDiff') },
      { id: 'finder', label: t('git.ctx.showInFinder') },
      sep,
      { id: 'blame', label: t('git.ctx.blame') },
      { id: 'history', label: t('git.ctx.history') },
      sep,
    ]
    // Staging acts on the ⌘-click multi-selection when the clicked file is part of
    // one (labelled with a count); otherwise on the clicked file alone. Selection
    // itself — Select all / Deselect all — is PURE: it highlights rows for a
    // following action and NEVER stages. Stage all / Unstage all always act on the
    // whole zone, independent of the selection.
    const bulk = selectionFor(tgt.file, tgt.staged)
    const n = bulk?.length ?? 0
    if (tgt.staged) {
      items.push({
        id: 'unstage',
        label: bulk ? t('git.ctx.unstageN', { n }) : t('git.ctx.unstage'),
      })
    } else {
      items.push(
        { id: 'stage', label: bulk ? t('git.ctx.stageN', { n }) : t('git.ctx.stage') },
        {
          id: 'discard',
          label: bulk ? t('git.ctx.discardN', { n }) : t('git.ctx.discard'),
          danger: true,
        },
      )
    }
    items.push(sep)
    if ((tgt.staged ? store.staged.length : store.unstaged.length) > 1) {
      items.push({ id: 'select-all', label: t('git.ctx.selectAll') })
    }
    if (selZone.value === tgt.staged && selPaths.value.size) {
      items.push({ id: 'deselect-all', label: t('git.ctx.deselectAll') })
    }
    if (store.unstaged.length) items.push({ id: 'stage-all', label: t('git.changes.stageAll') })
    if (store.staged.length) items.push({ id: 'unstage-all', label: t('git.changes.unstageAll') })
    // List-wide discard: the destructive counterpart to Stage all / Unstage all —
    // reverts EVERY working-tree change (staged + unstaged) after one confirm.
    // Shown whenever there is any change on either side.
    if (count) items.push({ id: 'discard-all', label: t('git.ctx.discardAll'), danger: true })
    items.push(
      sep,
      { label: t('git.ctx.ignore'), children: ignore },
      sep,
      { id: 'stash', label: t('git.ctx.stashFile', { n: count }) },
      { id: 'save-patch', label: t('git.ctx.savePatch') },
      sep,
      { id: 'copy', label: t('git.ctx.copyPath') },
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
    items.push(sep, { id: 'copy', label: t('git.ctx.copyPath') })
    return items
  }

  // Committed file (history detail: CHANGES / FILE TREE tabs). No staging/discard —
  // those act on the working tree, not a past commit's snapshot. Actions open/reveal
  // the file's current on-disk copy.
  if (tgt.kind === 'commit-file') {
    return [
      { id: 'open', label: t('git.ctx.open') },
      { id: 'open:code', label: t('git.ctx.openInVscode') },
      { id: 'finder', label: t('git.ctx.showInFinder') },
      sep,
      { id: 'copy', label: t('git.ctx.copyPath') },
    ]
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
      { id: 'copy-sha', label: t('git.ctx.copySha') },
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
        { id: 'pr-summary', label: t('git.ctx.prSummary'), icon: 'sparkles' },
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
      { id: 'pr-summary', label: t('git.ctx.prSummary'), icon: 'sparkles' },
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
    { id: 'edit-url', label: t('git.ctx.editUrl'), icon: 'edit' },
    { id: 'copy-url', label: t('git.ctx.copyUrl'), icon: 'copy' },
    sep,
    { id: 'remove', label: t('git.ctx.removeRemote'), icon: 'trash', danger: true },
  ]
})

function onMenuSelect(id: string) {
  const tgt = menu.value?.target
  menu.value = null
  if (!tgt) return
  if (tgt.kind === 'file') dispatchFile(id, tgt.file, tgt.staged)
  else if (tgt.kind === 'commit-file') dispatchCommitFile(id, tgt.file)
  else if (tgt.kind === 'folder') void dispatchFolder(id, tgt.path, tgt.staged)
  else if (tgt.kind === 'branch') dispatchBranch(id, tgt.branch)
  else if (tgt.kind === 'stash') dispatchStash(id, tgt.index)
  else if (tgt.kind === 'tag') dispatchTag(id, tgt.name)
  else if (tgt.kind === 'remote') dispatchRemote(id, tgt.name)
  else if (tgt.kind === 'commit') void dispatchCommit(id, tgt.commit)
}

const copy = (s: string) => void navigator.clipboard?.writeText(s).catch(() => {})

function dispatchFile(id: string, file: string, staged: boolean) {
  // Bulk when the clicked file is part of a ⌘-click multi-selection; else single.
  const bulk = selectionFor(file, staged)
  if (id === 'stage') void (bulk ? onStageSelected(bulk) : onStageFile(file))
  else if (id === 'unstage') void (bulk ? onUnstageSelected(bulk) : onToggleStage(file, true))
  else if (id === 'discard') void (bulk ? onDiscardAll(bulk) : onDiscard(file))
  else if (id === 'select-all') selectAllInZone(staged)
  else if (id === 'deselect-all') clearSelection()
  else if (id === 'stage-all') void onStageAll()
  else if (id === 'unstage-all') void onUnstageAll()
  else if (id === 'discard-all') void onDiscardAllChanges()
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

// Committed file (history detail) — open/reveal the current on-disk copy or copy
// its path. No staging: a past commit's snapshot isn't a working-tree change.
function dispatchCommitFile(id: string, file: string) {
  if (id === 'open') void store.openFile(file)
  else if (id === 'open:code') void store.openInVscode(file)
  else if (id === 'finder') void store.revealFile(file)
  else if (id === 'copy') copy(file)
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
    const sel = selectedFile.value
    if (sel?.kind === 'file' && files.includes(sel.path)) selectedFile.value = null
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
  else if (id === 'pr-summary') prSummary.open(store.currentProjectId, b.name)
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
  else if (id === 'edit-url') {
    // Jump to the remote's detail pane and open its inline URL editor (reuses the
    // fetch/push field editor rather than duplicating it in a modal).
    section.value = { kind: 'remote', name }
    remoteEditName.value = name
  } else if (id === 'remove') void onRemoveRemote(name)
}

// Confirm, then drop the remote. Local branches/commits are kept — only the
// tracking config is removed. Errors surface via store.lastError → toast.
async function onRemoveRemote(name: string) {
  const ok = await confirm({
    title: t('git.confirm.removeRemoteTitle'),
    description: t('git.confirm.removeRemote', { name }),
    confirmLabel: t('git.ctx.removeRemote'),
  })
  if (!ok) return
  const removed = await store.removeRemote(name)
  if (!removed) return
  // Leaving the pane of a now-gone remote → fall back to Local Changes.
  if (section.value.kind === 'remote' && section.value.name === name) {
    section.value = { kind: 'local-changes' }
  }
  pushToast(t('git.remote.removed', { name }), 'success')
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
