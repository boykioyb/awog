<template>
  <!-- View "Explorer" — toolbar VS Code (tìm file + new file/folder + refresh +
       reveal + collapse), rồi cây project lazy. Ô tìm focus ⇒ giãn hết bề ngang,
       các nút trượt ẩn; có chữ ⇒ cây được thay bằng danh sách file khớp của CẢ
       project (useFileFinder), không chỉ làm mờ node trong thư mục đã mở. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex h-11 flex-none items-center px-2 shadow-[inset_0_-1px_0_var(--border)]">
      <span
        class="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-sm border bg-muted px-2.5 text-faint transition-colors"
        :class="searching ? 'border-selected-border' : 'border-border'"
      >
        <Icon name="search" class="size-4 flex-none" />
        <Input
          ref="inputEl"
          v-model="query"
          unstyled
          class="min-h-0 min-w-0 flex-1 border-none text-sm text-foreground placeholder:text-faint"
          placeholder="Tìm file…"
          autocomplete="off"
          spellcheck="false"
          @focus="focused = true"
          @blur="focused = false"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="openActive"
          @keydown.esc.stop.prevent="onEsc"
        />
        <Button
          v-if="query"
          variant="ghost"
          size="iconSm"
          class="size-auto flex-none p-0 text-faint hover:bg-transparent hover:text-foreground"
          title="Xoá chữ tìm"
          @mousedown.prevent
          @click="query = ''"
        >
          <X :size="14" />
        </Button>
      </span>
      <!-- Nhóm nút trượt ẩn khi đang tìm: max-width + opacity để ô tìm giãn mượt,
           không nhảy layout. `inert` khi ẩn ⇒ Tab không rơi vào nút vô hình. -->
      <div
        class="flex flex-none items-center gap-1 overflow-hidden transition-[max-width,opacity,margin-left] duration-200 motion-reduce:transition-none"
        :class="searching ? 'pointer-events-none ml-0 max-w-0 opacity-0' : 'ml-1 max-w-40'"
        :inert="searching || undefined"
      >
        <Button
          variant="ghost"
          size="iconSm"
          class="size-6 text-dim hover:text-foreground"
          title="New file"
          @click="exp.startCreate(false)"
        >
          <FilePlus :size="16" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="size-6 text-dim hover:text-foreground"
          title="New folder"
          @click="exp.startCreate(true)"
        >
          <FolderPlus :size="16" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="size-6 text-dim hover:text-foreground"
          title="Refresh explorer"
          @click="exp.refreshAll"
        >
          <RotateCw :size="16" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="size-6 text-dim hover:text-foreground"
          title="Reveal active file in tree"
          @click="exp.revealActiveDoc"
        >
          <Crosshair :size="16" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="size-6 text-dim hover:text-foreground"
          title="Collapse all folders"
          @click="collapse"
        >
          <FoldVertical :size="16" />
        </Button>
      </div>
    </div>

    <!-- Kết quả tìm (thay cây khi có chữ). -->
    <div v-if="query.trim()" class="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 text-sm">
      <div v-if="loading" class="px-3 py-2 text-faint">Đang lập chỉ mục file…</div>
      <div v-else-if="failed && !results.length" class="px-3 py-2 text-faint">
        Không đọc được danh sách file của project
      </div>
      <div v-else-if="!results.length" class="px-3 py-2 text-faint">Không có file nào khớp</div>
      <div
        v-for="(h, i) in results"
        :key="h.path"
        class="flex h-6 cursor-pointer items-center gap-1.5 whitespace-nowrap px-2.5"
        :class="
          i === activeIdx
            ? 'bg-selected text-foreground shadow-[inset_2px_0_0_var(--color-primary)]'
            : 'text-muted-foreground'
        "
        :title="h.path"
        :data-fv-hit="i"
        @mousedown.prevent
        @mouseenter="activeIdx = i"
        @click="open(h.path)"
      >
        <FileText :size="14" class="flex-none text-dim" />
        <span class="max-w-[70%] flex-none truncate">
          <template v-for="(seg, si) in nameSegs(h)" :key="si">
            <b v-if="seg.match" class="font-semibold text-primary">{{ seg.text }}</b>
            <template v-else>{{ seg.text }}</template>
          </template>
        </span>
        <span v-if="h.dir" class="min-w-0 truncate text-xs text-faint">{{ h.dir }}</span>
      </div>
      <div v-if="truncated" class="px-3 py-1.5 text-xs text-faint">
        Project lớn — chỉ tìm trong 20.000 file đầu.
      </div>
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col overflow-y-auto pb-7 pt-1 text-sm">
      <div
        class="flex h-5.5 flex-none cursor-default select-none items-center gap-1 px-2 text-xs font-semibold text-dim"
      >
        <ChevronDown :size="10" />
        {{ projectName }}
      </div>
      <ExplorerTree />
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ChevronDown,
  Crosshair,
  FilePlus,
  FileText,
  FoldVertical,
  FolderPlus,
  RotateCw,
  X,
} from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import { useWorkbenchExplorer } from '~/composables/useWorkbenchExplorer'
import { useFileFinder, type FileHit } from '~/composables/useFileFinder'
import { highlightSegments, type LabelSegment } from '~/utils/fuzzy'
import ExplorerTree from './ExplorerTree.vue'

const exp = useWorkbenchExplorer()

const projectName = computed(() => exp.project.value?.name ?? 'project')
const collapse = (): void => exp.collapseAll()

const query = ref('')
const focused = ref(false)
// Giãn ô tìm khi đang gõ HOẶC còn chữ (blur mà còn kết quả thì vẫn giữ để bấm chọn).
const searching = computed(() => focused.value || query.value.trim() !== '')
const inputEl = ref<{ focus: () => void; blur: () => void } | null>(null)

const { results, loading, failed, truncated } = useFileFinder(exp.root, query)

const activeIdx = ref(0)
watch(results, () => {
  activeIdx.value = 0
})

// Tên file tô sáng theo vị trí khớp (positions là chỉ số trong tên file).
function nameSegs(h: FileHit): LabelSegment[] {
  return highlightSegments(h.name, h.positions)
}

function move(step: number): void {
  const n = results.value.length
  if (!n) return
  activeIdx.value = (activeIdx.value + step + n) % n
  void nextTick(() =>
    document
      .querySelector(`[data-fv-hit="${activeIdx.value}"]`)
      ?.scrollIntoView({ block: 'nearest' }),
  )
}

// Mở file: doc đổi ⇒ explorer tự bung cây tới file đó (revealActive theo activeDoc).
// Xoá chữ + rời ô tìm để cây hiện lại với file vừa mở được chọn.
function open(path: string): void {
  exp.openFileDoc(path)
  query.value = ''
  inputEl.value?.blur()
}

function openActive(): void {
  const h = results.value[activeIdx.value]
  if (h) open(h.path)
}

function onEsc(): void {
  if (query.value) query.value = ''
  else inputEl.value?.blur()
}
</script>
