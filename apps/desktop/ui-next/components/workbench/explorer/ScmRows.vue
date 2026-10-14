<template>
  <!-- Rows của một section SCM (staged/unstaged/conflicted): dir row có chevron
       + nút hover-actions, file row = icon · tên · dir suffix · hover-actions ·
       status badge. Click/handler luôn emit lên parent — component này thuần
       trình bày (flat mode = không có dir node). -->
  <template v-for="n in nodes" :key="n.path">
    <!-- Dir row: toggle collapse + context menu (nếu có handler) + ops theo dir. -->
    <div
      v-if="n.isDir"
      class="group/row flex h-[24px] cursor-pointer items-center gap-1.5 whitespace-nowrap pr-2.5 text-[var(--text)] hover:bg-[var(--bgHover)]"
      :style="{ paddingLeft: 8 + n.depth * 12 + 'px' }"
      :title="n.path"
      @click="emit('toggleDir', n)"
      @contextmenu.prevent="onDirCtx?.(n, $event)"
    >
      <ChevronRight v-if="collapsed.has(n.path)" :size="10" class="flex-none" />
      <ChevronDown v-else :size="10" class="flex-none" />
      <Folder :size="14" class="flex-none text-[var(--textFaint)]" />
      <span class="truncate font-[560]">{{ n.name }}</span>
      <span
        v-if="onUnstageDir || onStageDir || onDiscardDir"
        class="ml-auto flex gap-1 opacity-0 transition-opacity group-hover/row:opacity-100"
      >
        <ScmIconBtn
          v-if="onUnstageDir"
          :size="16"
          hover="active"
          title="Unstage cả thư mục"
          @click.stop="onUnstageDir?.(n)"
        >
          <Minus :size="14" />
        </ScmIconBtn>
        <ScmIconBtn
          v-if="onDiscardDir"
          :size="16"
          hover="active"
          title="Discard cả thư mục ↩"
          @click.stop="onDiscardDir?.(n)"
        >
          <Undo2 :size="14" />
        </ScmIconBtn>
        <ScmIconBtn
          v-if="onStageDir"
          :size="16"
          hover="active"
          title="Stage cả thư mục"
          @click.stop="onStageDir?.(n)"
        >
          <Plus :size="14" />
        </ScmIconBtn>
      </span>
    </div>
    <!-- File row: click → diff; actions hiện khi hover, đè lên dir suffix. -->
    <div
      v-else
      class="group/row relative flex h-[24px] cursor-pointer items-center gap-1.5 whitespace-nowrap pr-2.5 text-[var(--textMuted)] hover:bg-[var(--bgHover)]"
      :style="{ paddingLeft: 8 + n.depth * 12 + 'px' }"
      :title="n.file!.f"
      @click="emit('openDiff', n.file!.f)"
      @contextmenu.prevent="onFileCtx?.(n.file!, $event)"
    >
      <component :is="fileIcon(n.file!.f)" :size="14" class="flex-none text-[var(--textFaint)]" />
      <span class="truncate">{{ n.name }}</span>
      <span
        v-if="!treeMode"
        class="min-w-0 flex-1 truncate text-xs text-[var(--textFaint)] opacity-100 transition-opacity group-hover/row:opacity-0"
      >
        {{ scmDirOf(n.file!.f) }}
      </span>
      <span
        v-if="onOpenFile || onUnstageFile || onDiscardFile || onStageFile"
        class="absolute right-2.5 flex gap-1 bg-[var(--bgHover)] pl-1 opacity-0 transition-opacity group-hover/row:opacity-100"
      >
        <ScmIconBtn
          v-if="onOpenFile"
          :size="16"
          hover="active"
          title="Mở file"
          @click.stop="onOpenFile?.(n.file!.f)"
        >
          <File :size="14" />
        </ScmIconBtn>
        <ScmIconBtn
          v-if="onUnstageFile"
          :size="16"
          hover="active"
          title="Unstage −"
          @click.stop="onUnstageFile?.(n.file!.f)"
        >
          <Minus :size="14" />
        </ScmIconBtn>
        <ScmIconBtn
          v-if="onDiscardFile"
          :size="16"
          hover="active"
          title="Discard ↩"
          @click.stop="onDiscardFile?.(n.file!.f)"
        >
          <Undo2 :size="14" />
        </ScmIconBtn>
        <ScmIconBtn
          v-if="onStageFile"
          :size="16"
          hover="active"
          title="Stage +"
          @click.stop="onStageFile?.(n.file!.f)"
        >
          <Plus :size="14" />
        </ScmIconBtn>
      </span>
      <span
        v-if="conflict"
        class="ml-auto text-xs font-[650] tabular-nums text-[var(--del)] group-hover/row:ml-0"
        title="Unmerged — đang conflict"
      >
        U
      </span>
      <span
        v-else
        class="ml-auto text-xs font-[650] tabular-nums group-hover/row:ml-0"
        :class="stClass(n.file!.st)"
        :title="stTitle(n.file!.st)"
      >
        {{ stLabel(n.file!.st) }}
      </span>
    </div>
  </template>
</template>

<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Folder,
  Image,
  Minus,
  Plus,
  Undo2,
  Video,
  Workflow,
} from 'lucide-vue-next'
import type { GitFile } from '~/components/git/git-types'
import { docKindFor } from '~/composables/useWorkbenchExplorer'
import { scmDirOf, type ScmTreeNode } from './scm-tree'
import ScmIconBtn from './ScmIconBtn.vue'

defineProps<{
  nodes: ScmTreeNode[]
  /** render dạng tree → ẩn dir suffix của file row (thụt đã thể hiện cấp) */
  treeMode: boolean
  collapsed: ReadonlySet<string>
  /** row conflict: badge 'U' đỏ + không có actions */
  conflict?: boolean
  /** optional handler props — vắng = nút/menu tương ứng không render */
  onDirCtx?: (n: ScmTreeNode, e: MouseEvent) => void
  onFileCtx?: (f: GitFile, e: MouseEvent) => void
  onOpenFile?: (path: string) => void
  onUnstageDir?: (n: ScmTreeNode) => void
  onStageDir?: (n: ScmTreeNode) => void
  onDiscardDir?: (n: ScmTreeNode) => void
  onUnstageFile?: (path: string) => void
  onStageFile?: (path: string) => void
  onDiscardFile?: (path: string) => void
}>()

const emit = defineEmits<{
  toggleDir: [n: ScmTreeNode]
  /** click row → mở diff; payload = repo-relative path (staged biết ở parent) */
  openDiff: [path: string]
}>()

// Icon theo loại file — reuse `docKindFor` của explorer (dùng chung tree + flat).
function fileIcon(p: string) {
  const name = p.split('/').pop() ?? p
  switch (docKindFor(name)) {
    case 'md':
      return FileText
    case 'img':
      return Image
    case 'vid':
      return Video
    case 'mmd':
      return Workflow
    default:
      return File
  }
}

// Màu badge trạng thái (giống Files view): A/? xanh · M/C vàng · D đỏ.
// '?' là untracked của git status -uall → hiện 'U' cho rõ chữ.
function stLabel(st: string): string {
  return st === '?' ? 'U' : st
}
const ST_TITLE: Record<string, string> = {
  A: 'Added — file mới, đã stage',
  M: 'Modified — đổi nội dung',
  D: 'Deleted — đã xoá',
  R: 'Renamed — đổi tên',
  C: 'Copied',
  '?': 'Untracked — file mới chưa stage',
  U: 'Untracked — file mới chưa stage',
}
function stTitle(st: string): string {
  return ST_TITLE[st] ?? st
}
function stClass(st: string): string {
  if (st === 'A' || st === '?' || st === 'U') return 'text-[var(--green)]'
  if (st === 'D') return 'text-[var(--del)]'
  return 'text-[var(--mod)]'
}
</script>
