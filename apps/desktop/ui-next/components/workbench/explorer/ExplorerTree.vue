<template>
  <!-- Cây file của project — render phẳng theo `exp.rows` (DFS + expanded).
       Click: dir → expand/collapse + chọn; file → mở doc + chọn. Chuột phải →
       context menu VS Code. Mọi hàng cùng màu `--text` (≈ #fff ở dark, tự đảo ở
       light — KHÔNG ghim hex) + font-weight 400 (nhẹ hơn 500 cũ); hàng chọn chỉ
       khác ở nền + thanh accent; icon md/mmd giữ màu loại file. -->
  <div class="flex min-h-full flex-col" @contextmenu.self="exp.blankCtxMenu">
    <template v-for="r in exp.rows.value" :key="r.kind + ':' + r.path">
      <ExplorerInlineInput
        v-if="r.kind === 'input'"
        :depth="r.depth"
        :is-dir="r.isDir"
        :initial="r.initial"
        :error="exp.pendingError.value"
        @commit="exp.commitPending"
        @cancel="exp.cancelPending"
      />
      <div
        v-else
        class="flex h-[23px] cursor-pointer select-none items-center gap-1.5 whitespace-nowrap pr-2 font-normal text-[color:var(--text)]"
        :class="{
          'bg-[color:var(--accentDim)] shadow-[inset_2px_0_0_var(--accent)]': wb.selPath === r.path,
          'hover:bg-[color:var(--bgHover)]': wb.selPath !== r.path,
        }"
        :data-wb-tree-path="r.path"
        :style="{ paddingLeft: 12 + r.depth * 14 + 'px' }"
        @click="exp.selectNode(r.path, r.isDir)"
        @contextmenu.prevent="exp.fileCtxMenu(r.path, r.isDir, $event)"
      >
        <span class="flex w-3 flex-none">
          <ChevronDown v-if="r.isDir && r.expanded" :size="12" />
          <ChevronRight v-else-if="r.isDir" :size="12" />
        </span>
        <component :is="iconFor(r)" :size="14" class="flex-none" :class="iconCls(r)" />
        <span class="truncate">{{ r.name }}</span>
      </div>
    </template>
    <div v-if="!exp.rows.value.length" class="p-3.5 text-sm text-[color:var(--textFaint)]">
      {{ root ? 'Đang tải…' : 'Chưa có project' }}
    </div>
    <!-- đệm đáy để vùng trống còn nhận contextmenu -->
    <div class="min-h-[60px] flex-1" @contextmenu.prevent="exp.blankCtxMenu" />
  </div>
</template>

<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Folder,
  Image,
  Video,
  Workflow,
} from 'lucide-vue-next'
import { computed } from 'vue'
import type { TreeRow } from '~/composables/useWorkbenchExplorer'
import { docKindFor, useWorkbenchExplorer } from '~/composables/useWorkbenchExplorer'
import { useWorkbenchStore } from '~/stores/workbench'

const exp = useWorkbenchExplorer()
const wb = useWorkbenchStore()
const root = computed(() => exp.root.value)

function iconFor(r: TreeRow) {
  if (r.isDir) return Folder
  switch (docKindFor(r.name)) {
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
function iconCls(r: TreeRow): string {
  if (r.isDir) return ''
  switch (docKindFor(r.name)) {
    case 'md':
      return 'text-[color:var(--blue)]'
    case 'mmd':
      return 'text-[color:var(--violet)]'
    default:
      return ''
  }
}
</script>
