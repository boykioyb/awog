<template>
  <section class="page on" data-page="git" style="flex-direction: column">
    <div class="gcols">
      <GitSidebar
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
        :side-w="sideW"
        @update:section="onSelectSection"
        @toggle-section="(k) => (secOpen[k] = !secOpen[k])"
        @toggle-collapse="collapsed = !collapsed"
        @update:search="(v) => (search = v)"
        @new-branch="onNewBranch"
        @save-stash="() => store.stashSave()"
        @context-branch="(e, b) => openMenu(e, { kind: 'branch', branch: b })"
        @context-stash="(e, i) => openMenu(e, { kind: 'stash', index: i })"
        @context-tag="(e, n) => openMenu(e, { kind: 'tag', name: n })"
        @context-remote="(e, n) => openMenu(e, { kind: 'remote', name: n })"
        @toggle-branch-folder="(f) => (bcol[f] = !bcol[f])"
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
          @select-project="(id) => store.setProject(id)"
          @select-repo="(r) => store.setRepo(r)"
          @switch-branch="(n) => store.checkoutBranch(n)"
          @fetch="() => store.fetchRemote()"
          @pull="() => store.pull()"
          @push="() => store.push()"
          @complete-merge="() => store.completeMerge()"
          @abort-merge="() => store.abortMerge()"
        />

        <div v-if="store.isDetached" class="gbanner">
          <Icon name="alert" style="width: 14px; height: 14px" />
          <span>{{ t('git.banner.detached', { at: store.detachedAt ?? '' }) }}</span>
        </div>

        <div class="gbody">
          <!-- Local Changes -->
          <template v-if="section.kind === 'local-changes'">
            <GitChangesList
              :staged="store.staged"
              :unstaged="store.unstaged"
              :ch-tree="chTree"
              :sel="selectedFile"
              :width="midW"
              @toggle-tree="chTree = !chTree"
              @select="(f) => (selectedFile = f)"
              @discard="onDiscard"
              @toggle-stage="onToggleStage"
              @stage-all="onStageAll"
              @unstage-all="onUnstageAll"
              @context-file="(e, f, s) => openMenu(e, { kind: 'file', file: f, staged: s })"
            />
            <div class="grsz" :class="{ drag: midDragging }" @pointerdown="onMidResize" />
            <div class="detail">
              <GitDiffViewer
                :file="selectedFile"
                :diff="diffLines"
                :diff-mode="diffMode"
                @toggle-diff-mode="diffMode = diffMode === 'split' ? 'unified' : 'split'"
                @stage-file="onStageFile"
                @stage-hunk="onStageHunk"
              />
              <GitCommitPanel
                :msg="store.commitMessage"
                :staged-count="store.staged.length"
                :commits-count="store.commits.length"
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
            :detail-diff="detailDiff"
            @select-commit="(h) => (commitSel = `c:${h}`)"
            @set-tab="(t2) => (ctab = t2)"
          />

          <!-- Remote detail -->
          <GitRemoteDetailPane
            v-else-if="section.kind === 'remote'"
            :name="section.name"
            :remotes="store.remotes"
            @fetch="() => store.fetchRemote()"
            @pull="() => store.pull()"
            @push="() => store.push()"
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

    <GitContextMenu
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
  </section>
</template>

<script setup lang="ts">
// Git page — production Git Manager layout (ui-next prototype styling) wired to
// the git store (sidecar IPC, with a browser-dev mock fallback). The store owns
// all git DATA + actions; this page owns VIEW state (selection/collapse/etc.)
// and the working-tree diff for the selected file.
import type {
  BranchInfo,
  CommitTab,
  DiffLine,
  DiffMode,
  GitFile,
  GitSection,
  MenuItem,
  SectionOpen,
} from '~/components/git/git-types'
import { useGitStore } from '~/stores/git'

const { t } = useI18n()
const store = useGitStore()

// ── View state (page-local; not git data) ──
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
const selectedFile = ref<string | null>(null)
const commitSel = ref<string | null>(null)
const detailFiles = ref<GitFile[]>([])
const detailDiff = ref<DiffLine[]>([])

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

// Working-tree diff for the selected file (store.loadDiff handles real vs mock).
const diffLines = ref<DiffLine[]>([])
watch(
  selectedFile,
  async (f) => {
    diffLines.value = f ? await store.loadDiff(f) : []
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
      detailDiff.value = []
      return
    }
    const res = await store.loadCommitDiff(sha)
    detailFiles.value = res.files
    detailDiff.value = res.diff
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

// Reload the selected file's diff (staged vs unstaged is resolved inside the
// store) — called after any staging mutation since `selectedFile` is unchanged.
function reloadDiff() {
  const f = selectedFile.value
  if (!f) {
    diffLines.value = []
    return
  }
  void store.loadDiff(f).then((d) => {
    diffLines.value = d
  })
}

async function onToggleStage(file: string, staged: boolean) {
  if (staged) await store.unstageFile(file)
  else await store.stageFile(file)
  reloadDiff()
}

async function onStageFile(file: string) {
  await store.stageFile(file)
  reloadDiff()
}

async function onDiscard(file: string) {
  await store.discardFile(file)
  if (selectedFile.value === file) selectedFile.value = null
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

async function onStageHunk(hunkIndex: number) {
  if (!selectedFile.value) return
  await store.stageHunk(selectedFile.value, hunkIndex)
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
  openPrompt({
    title: t('git.prompt.newBranch'),
    placeholder: 'feature/…',
    submitLabel: t('git.sidebar.newBranch'),
    onSubmit: (name) => void store.createBranch(name),
  })
}

// ── Context menus (file / branch / stash / tag / remote) ──
type MenuTarget =
  | { kind: 'file'; file: string; staged: boolean }
  | { kind: 'branch'; branch: BranchInfo }
  | { kind: 'stash'; index: number }
  | { kind: 'tag'; name: string }
  | { kind: 'remote'; name: string }

const menu = ref<{ x: number; y: number; target: MenuTarget } | null>(null)

function openMenu(e: MouseEvent, target: MenuTarget) {
  menu.value = {
    x: Math.min(e.clientX, window.innerWidth - 220),
    y: Math.min(e.clientY, window.innerHeight - 320),
    target,
  }
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
  else if (tgt.kind === 'branch') dispatchBranch(id, tgt.branch)
  else if (tgt.kind === 'stash') dispatchStash(id, tgt.index)
  else if (tgt.kind === 'tag') dispatchTag(id, tgt.name)
  else if (tgt.kind === 'remote') dispatchRemote(id, tgt.name)
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

function dispatchBranch(id: string, b: BranchInfo) {
  if (id === 'checkout') store.checkoutBranch(b.name)
  else if (id === 'checkout-local') store.checkoutBranch(b.name.replace(/^origin\//, ''))
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
  else if (id === 'pull') store.pull()
  else if (id === 'push') store.push()
  else if (id === 'merge') store.merge(b.name)
  else if (id === 'rebase') store.rebase(b.name)
  else if (id === 'copy') copy(b.name)
  else if (id === 'delete') store.deleteBranch(b.name)
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
  else if (id === 'push') store.push()
  else if (id === 'copy-url') copy(store.remotes.find((r) => r.name === name)?.fetchUrl ?? name)
}

onMounted(() => {
  void store.init()
})
onUnmounted(() => {
  store.unsubscribe()
})
</script>
