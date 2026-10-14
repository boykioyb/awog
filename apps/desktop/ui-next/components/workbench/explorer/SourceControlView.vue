<template>
  <!-- View "Source Control" — reuse git store thật: staged/unstaged rows,
       commit box (✓ commit · ✨ AI gen = git.generateCommitMessage), section
       Commits gần nhất mở URL GitHub khi repo có remote. Click row → mở diff
       doc tab. Rows dùng chung ScmRows; branch popover = BranchPopover. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex h-[30px] flex-none items-center gap-1.5 px-2.5 text-sm text-[var(--textMuted)] shadow-[inset_0_-1px_0_var(--border)]"
    >
      <GitBranch :size="14" class="text-[var(--textDim)]" />
      <b class="min-w-0 flex-1 truncate font-[590]" :title="git.branch">{{ git.branch || '—' }}</b>
      <span class="text-xs tabular-nums text-[var(--textFaint)]">
        <span class="font-[620] text-[var(--add)]" title="Ahead — commit chưa push">
          ↑{{ git.ahead }}
        </span>
        <span class="font-[620] text-[var(--del)]" title="Behind — commit chưa pull">
          ↓{{ git.behind }}
        </span>
      </span>
      <!-- Sync nhanh: pull/push/fetch + chevron mở branch popover -->
      <span class="ml-auto inline-flex items-center gap-0.5">
        <ScmIconBtn :disabled="git.syncOp != null" title="Pull" @click="git.pull()">
          <ArrowDownToLine :size="14" />
        </ScmIconBtn>
        <ScmIconBtn :disabled="git.syncOp != null" title="Push" @click="git.push()">
          <ArrowUpToLine :size="14" />
        </ScmIconBtn>
        <ScmIconBtn :disabled="git.syncOp != null" title="Fetch" @click="git.fetchRemote">
          <RefreshCw :size="14" :class="{ 'animate-spin': git.syncOp?.op === 'fetch' }" />
        </ScmIconBtn>
        <ScmIconBtn
          ref="branchBtn"
          :active="branchOpen"
          title="Nhánh — chọn / ghim / merge / rebase"
          @click.stop="branchOpen = !branchOpen"
        >
          <ChevronDown :size="14" />
        </ScmIconBtn>
      </span>
    </div>

    <div class="flex flex-col gap-1.5 border-b border-[var(--border)] p-2">
      <!-- Textarea một hàng riêng — message dài gõ được nhiều dòng (⌘Enter vẫn
           commit), các nút bên dưới. -->
      <Textarea
        v-model="git.commitMessage"
        class="min-h-[44px] resize-y px-2 py-[5px] font-sans"
        placeholder="Message (⌘Enter to commit)"
        spellcheck="false"
        rows="2"
        @keydown="onCommitKey"
      />
      <div class="flex items-center gap-[5px]">
        <Button
          type="button"
          variant="outline"
          size="iconSm"
          class="size-6 text-[var(--accent)] hover:text-[var(--text)]"
          :disabled="git.isGeneratingCommit"
          title="Generate commit message with AI"
          @click="genMsg"
        >
          <Sparkles :size="14" />
        </Button>
        <Button
          type="button"
          size="iconSm"
          class="size-6"
          title="Commit ✓"
          :disabled="!git.commitMessage.trim() || git.isCommitting"
          @click="doCommit"
        >
          <Check :size="14" />
        </Button>
        <span class="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          class="size-6"
          :class="
            treeMode
              ? 'bg-[var(--accentDim)] text-[var(--accent)] hover:text-[var(--accent)]'
              : 'text-[var(--textDim)] hover:text-[var(--text)]'
          "
          :title="treeMode ? 'Xem dạng phẳng' : 'Xem dạng tree'"
          @click="treeMode = !treeMode"
        >
          <ListTree :size="14" />
        </Button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-2.5 pt-1 text-sm">
      <template v-if="git.notARepo">
        <div class="p-3.5 text-sm text-[var(--textFaint)]">Thư mục không phải git repository.</div>
      </template>
      <template v-else>
        <template v-if="git.staged.length">
          <div
            class="group/sec flex h-[22px] cursor-pointer select-none items-center gap-[5px] px-2 text-xs font-[640] text-[var(--textDim)]"
          >
            Staged Changes
            <span class="hidden gap-0.5 group-hover/sec:flex">
              <ScmIconBtn
                :size="16"
                hover="active"
                title="Unstage tất cả −"
                @click="git.unstageAll"
              >
                <Minus :size="14" />
              </ScmIconBtn>
            </span>
            <span
              class="ml-auto rounded-[var(--r-sm)] bg-[var(--bgEl)] px-1.5 text-xs tabular-nums text-[var(--textFaint)]"
            >
              {{ git.staged.length }}
            </span>
          </div>
          <ScmRows
            :nodes="stagedNodes"
            :tree-mode="treeMode"
            :collapsed="collapsed"
            :on-file-ctx="(f, e) => rowCtx(f, true, e)"
            :on-open-file="openFile"
            :on-unstage-dir="unstageDir"
            :on-unstage-file="git.unstageFile"
            @toggle-dir="toggleDir"
            @open-diff="(p) => openDiff(p, true)"
          />
        </template>

        <template v-if="git.unstaged.length">
          <div
            class="group/sec flex h-[22px] cursor-pointer select-none items-center gap-[5px] px-2 text-xs font-[640] text-[var(--textDim)]"
          >
            Changes
            <span class="hidden gap-0.5 group-hover/sec:flex">
              <ScmIconBtn :size="16" hover="active" title="Stage tất cả ✓" @click="git.stageAll">
                <Check :size="14" />
              </ScmIconBtn>
              <ScmIconBtn :size="16" hover="active" title="Discard tất cả ↩" @click="discardAll">
                <Undo2 :size="14" />
              </ScmIconBtn>
            </span>
            <span
              class="ml-auto rounded-[var(--r-sm)] bg-[var(--bgEl)] px-1.5 text-xs tabular-nums text-[var(--textFaint)]"
            >
              {{ git.unstaged.length }}
            </span>
          </div>
          <ScmRows
            :nodes="unstagedNodes"
            :tree-mode="treeMode"
            :collapsed="collapsed"
            :on-dir-ctx="dirCtx"
            :on-file-ctx="(f, e) => rowCtx(f, false, e)"
            :on-open-file="openFile"
            :on-stage-dir="stageDir"
            :on-discard-dir="discardDir"
            :on-stage-file="git.stageFile"
            :on-discard-file="discardFile"
            @toggle-dir="toggleDir"
            @open-diff="(p) => openDiff(p)"
          />
        </template>

        <template v-if="git.conflicted.length">
          <div
            class="flex h-[22px] cursor-pointer select-none items-center gap-[5px] px-2 text-xs font-[640] text-[var(--textDim)]"
          >
            Conflicts
            <span
              class="ml-auto rounded-[var(--r-sm)] bg-[var(--bgEl)] px-1.5 text-xs tabular-nums text-[var(--textFaint)]"
            >
              {{ git.conflicted.length }}
            </span>
          </div>
          <ScmRows
            :nodes="conflictedNodes"
            :tree-mode="treeMode"
            :collapsed="collapsed"
            conflict
            @toggle-dir="toggleDir"
            @open-diff="(p) => openDiff(p)"
          />
        </template>

        <div
          v-if="!git.staged.length && !git.unstaged.length && !git.conflicted.length"
          class="p-3.5 text-sm text-[var(--textFaint)]"
        >
          Không có thay đổi.
        </div>

        <div
          class="flex h-[22px] cursor-pointer select-none items-center gap-[5px] px-2 text-xs font-[640] text-[var(--textDim)]"
          @click="commitsOpen = !commitsOpen"
        >
          <ChevronRight v-if="!commitsOpen" :size="10" class="flex-none" />
          <ChevronDown v-else :size="10" class="flex-none" />
          Commits
          <span
            class="ml-auto rounded-[var(--r-sm)] bg-[var(--bgEl)] px-1.5 text-xs tabular-nums text-[var(--textFaint)]"
          >
            {{ git.commits.length }}
          </span>
        </div>
        <template v-if="commitsOpen">
          <div
            v-for="c in git.commits.slice(0, 5)"
            :key="c.sha || c.h"
            class="flex h-[24px] cursor-pointer items-center gap-2 whitespace-nowrap pl-3 pr-2.5 text-[var(--textMuted)] hover:bg-[var(--bgHover)]"
            :title="`${c.h} — ${c.m}`"
            @click="openCommit(c)"
          >
            <!-- mono-ok: commit SHA — chuỗi kỹ thuật -->
            <span class="flex-none font-mono text-xs text-[var(--textFaint)]">{{ c.h }}</span>
            <span class="truncate">{{ c.m }}</span>
            <span class="ml-auto flex-none text-xs text-[var(--textFaint)]">
              {{ c.a }} · {{ c.w }}
            </span>
          </div>
        </template>
      </template>
    </div>

    <BranchPopover v-model:open="branchOpen" :anchor="branchBtnEl" />
  </div>
</template>

<script setup lang="ts">
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  ListTree,
  Minus,
  RefreshCw,
  Sparkles,
  Undo2,
} from 'lucide-vue-next'
import { computed, ref, useTemplateRef } from 'vue'
import type { GitFile, Commit } from '~/components/git/git-types'
import {
  openWebDoc,
  useWorkbenchExplorer,
  type WbCtxItem,
} from '~/composables/useWorkbenchExplorer'
import { useConfirm } from '~/composables/useConfirm'
import { useToast } from '~/composables/useToast'
import { useGitStore } from '~/stores/git'
import { useWorkbenchDocs } from '~/composables/useWorkbenchDocs'
import { useWorkbenchStore } from '~/stores/workbench'
import { copyText } from '~/utils/clipboard'
import BranchPopover from './BranchPopover.vue'
import ScmIconBtn from './ScmIconBtn.vue'
import ScmRows from './ScmRows.vue'
import {
  buildScmTree,
  collectScmFiles,
  flattenScmTree,
  scmFlatNodes,
  scmNameOf,
  type ScmTreeNode,
} from './scm-tree'

const exp = useWorkbenchExplorer()
const git = useGitStore()
const wb = useWorkbenchStore()
const wbDocs = useWorkbenchDocs()
const { confirm } = useConfirm()
const toast = useToast()

const commitsOpen = ref(true)

// ── Tree view ──────────────────────────────────────────────────────────────
// Một cây per section (staged/unstaged/conflicted), compact dir đơn-con —
// builder phẳng/đệ quy sống ở `./scm-tree.ts` (pure). Toggle stage/unstage ở
// dir = chạy trên mọi file con (collectScmFiles).
const treeMode = ref(true)
const collapsed = ref(new Set<string>())

const stagedNodes = computed(() =>
  treeMode.value
    ? flattenScmTree(buildScmTree(git.staged), collapsed.value)
    : scmFlatNodes(git.staged),
)
const unstagedNodes = computed(() =>
  treeMode.value
    ? flattenScmTree(buildScmTree(git.unstaged), collapsed.value)
    : scmFlatNodes(git.unstaged),
)
const conflictedNodes = computed(() =>
  treeMode.value
    ? flattenScmTree(buildScmTree(git.conflicted), collapsed.value)
    : scmFlatNodes(git.conflicted),
)

function toggleDir(n: ScmTreeNode): void {
  if (!n.isDir) return
  const s = new Set(collapsed.value)
  if (s.has(n.path)) s.delete(n.path)
  else s.add(n.path)
  collapsed.value = s
}
async function stageDir(n: ScmTreeNode): Promise<void> {
  await git.stagePaths(collectScmFiles(n))
}
async function unstageDir(n: ScmTreeNode): Promise<void> {
  await git.unstagePaths(collectScmFiles(n))
}

function openFile(repoPath: string): void {
  exp.openFileDoc(exp.projectPath(repoPath))
}

// Click row → mở diff file đó thành doc tab (dock 'Diff' đã gỡ). `staged` giữ
// staged-vs-workingTree diff theo section.
function openDiff(repoPath: string, staged = false): void {
  wb.selPath = exp.projectPath(repoPath)
  wbDocs.openDiff(exp.project.value?.id ?? '', exp.projectPath(repoPath), staged)
}

function onCommitKey(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    void doCommit()
  }
}

async function doCommit(): Promise<void> {
  const msg = git.commitMessage.trim()
  if (!msg || git.isCommitting) return
  await git.commit(msg)
  if (git.lastError) toast.add({ title: git.lastError.message, color: 'error' })
}

async function genMsg(): Promise<void> {
  await git.generateCommitMessage()
  if (git.lastError) toast.add({ title: git.lastError.message, color: 'error' })
}

async function discardFile(path: string): Promise<void> {
  const ok = await confirm({
    title: 'Discard thay đổi',
    description: `Bỏ mọi thay đổi chưa commit của ${scmNameOf(path)}?`,
    confirmLabel: 'Discard',
    kind: 'danger',
  })
  if (!ok) return
  await git.discardFile(path)
  if (git.lastError) toast.add({ title: git.lastError.message, color: 'error' })
}

async function discardAll(): Promise<void> {
  const ok = await confirm({
    title: 'Discard tất cả',
    description: `Bỏ ${git.unstaged.length} thay đổi chưa stage?`,
    confirmLabel: 'Discard',
    kind: 'danger',
  })
  if (!ok) return
  await git.discardPaths(git.unstaged.map((f) => f.f))
  if (git.lastError) toast.add({ title: git.lastError.message, color: 'error' })
}

// Discard theo THƯ MỤC (tree mode) — cùng confirm nguy hiểm như discardAll
// nhưng giới hạn trong các file con của node. Untracked cũng mất (sidecar unlink).
async function discardDir(n: ScmTreeNode): Promise<void> {
  const files = collectScmFiles(n)
  const ok = await confirm({
    title: 'Discard cả thư mục',
    description: `Bỏ ${files.length} thay đổi chưa commit trong ${n.path}?`,
    confirmLabel: 'Discard',
    kind: 'danger',
  })
  if (!ok) return
  await git.discardPaths(files)
  if (git.lastError) toast.add({ title: git.lastError.message, color: 'error' })
}

function dirCtx(n: ScmTreeNode, e: MouseEvent): void {
  exp.openWbMenu(
    [
      { label: 'Stage cả thư mục (+)', action: () => void stageDir(n) },
      { label: 'Discard cả thư mục ↩', danger: true, action: () => void discardDir(n) },
    ],
    e,
  )
}

function rowCtx(f: GitFile, staged: boolean, e: MouseEvent): void {
  const items: WbCtxItem[] = [
    { label: 'Mở file', action: () => openFile(f.f) },
    { label: 'Mở diff', action: () => openDiff(f.f) },
    { separator: true },
    staged
      ? { label: 'Unstage (−)', action: () => git.unstageFile(f.f) }
      : { label: 'Stage (+)', action: () => git.stageFile(f.f) },
    { label: 'Discard thay đổi ↩', danger: true, action: () => discardFile(f.f) },
    { separator: true },
    { label: 'Chép đường dẫn', action: () => exp.copyAbsPath(exp.projectPath(f.f)) },
    { label: 'Chép đường dẫn tương đối', action: () => copyText(exp.projectPath(f.f)) },
  ]
  exp.openWbMenu(items, e)
}

// ── Branch popover ──────────────────────────────────────────────────────────
// Panel (lọc · list/tree · ghim · pull/push/fetch · tạo · checkout/merge/
// rebase/xoá) sống ở BranchPopover.vue; ở đây chỉ giữ open state + anchor ref.
const branchBtn = useTemplateRef<{ $el: HTMLElement } | null>('branchBtn')
const branchBtnEl = computed(() => branchBtn.value?.$el ?? null)
const branchOpen = ref(false)

// Commit row → mở trang commit trên GitHub (chỉ khi repo có remote github).
function openCommit(c: Commit): void {
  const base = exp.ghBase.value
  const sha = c.sha || c.h
  if (!base || !sha) {
    toast.add({ title: 'Repo chưa có remote GitHub', color: 'neutral' })
    return
  }
  void openWebDoc(`${base}/commit/${sha}`, `${c.h} — ${c.m}`)
}
</script>
