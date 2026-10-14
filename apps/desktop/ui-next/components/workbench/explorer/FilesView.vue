<template>
  <!-- View "Explorer" — toolbar VS Code (tìm file + new file/folder + refresh +
       reveal + collapse), rồi cây project lazy. Ô tìm focus ⇒ giãn hết bề ngang,
       các nút trượt ẩn; có chữ ⇒ cây được thay bằng danh sách file khớp của CẢ
       project (useFileFinder), không chỉ làm mờ node trong thư mục đã mở. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex h-11 flex-none items-center px-2 shadow-[inset_0_-1px_0_var(--border)]">
      <span
        class="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[var(--r-xs)] border bg-[color:var(--bgInput)] px-2.5 text-[color:var(--textFaint)] transition-colors"
        :class="searching ? 'border-[color:var(--accentBorder)]' : 'border-[color:var(--border)]'"
      >
        <Icon name="search" class="size-4 flex-none" />
        <Input
          ref="inputEl"
          v-model="query"
          unstyled
          class="min-h-0 min-w-0 flex-1 border-none text-sm text-[color:var(--text)] placeholder:text-[color:var(--textFaint)]"
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
        <button
          v-if="query"
          type="button"
          class="flex flex-none text-[color:var(--textFaint)] hover:text-[color:var(--text)]"
          title="Xoá chữ tìm"
          @mousedown.prevent
          @click="query = ''"
        >
          <X :size="14" />
        </button>
      </span>
      <!-- Nhóm nút trượt ẩn khi đang tìm: max-width + opacity để ô tìm giãn mượt,
           không nhảy layout. `inert` khi ẩn ⇒ Tab không rơi vào nút vô hình. -->
      <div class="fv-actions" :class="{ 'is-hidden': searching }" :inert="searching || undefined">
        <Button
          variant="ghost"
          size="iconSm"
          class="size-6 text-[color:var(--textDim)] hover:text-[color:var(--text)]"
          title="New file"
          @click="exp.startCreate(false)"
        >
          <FilePlus :size="16" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="size-6 text-[color:var(--textDim)] hover:text-[color:var(--text)]"
          title="New folder"
          @click="exp.startCreate(true)"
        >
          <FolderPlus :size="16" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="size-6 text-[color:var(--textDim)] hover:text-[color:var(--text)]"
          title="Refresh explorer"
          @click="exp.refreshAll"
        >
          <RotateCw :size="16" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="size-6 text-[color:var(--textDim)] hover:text-[color:var(--text)]"
          title="Reveal active file in tree"
          @click="exp.revealActiveDoc"
        >
          <Crosshair :size="16" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="size-6 text-[color:var(--textDim)] hover:text-[color:var(--text)]"
          title="Collapse all folders"
          @click="collapse"
        >
          <FoldVertical :size="16" />
        </Button>
      </div>
    </div>

    <!-- Kết quả tìm (thay cây khi có chữ). -->
    <div v-if="query.trim()" class="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 text-sm">
      <div v-if="loading" class="px-3 py-2 text-[color:var(--textFaint)]">
        Đang lập chỉ mục file…
      </div>
      <div v-else-if="failed && !results.length" class="px-3 py-2 text-[color:var(--textFaint)]">
        Không đọc được danh sách file của project
      </div>
      <div v-else-if="!results.length" class="px-3 py-2 text-[color:var(--textFaint)]">
        Không có file nào khớp
      </div>
      <div
        v-for="(h, i) in results"
        :key="h.path"
        class="fv-hit"
        :class="{ on: i === activeIdx }"
        :title="h.path"
        :data-fv-hit="i"
        @mousedown.prevent
        @mouseenter="activeIdx = i"
        @click="open(h.path)"
      >
        <FileText :size="14" class="flex-none text-[color:var(--textDim)]" />
        <span class="fv-name">
          <template v-for="(seg, si) in nameSegs(h)" :key="si">
            <b v-if="seg.match">{{ seg.text }}</b>
            <template v-else>{{ seg.text }}</template>
          </template>
        </span>
        <span v-if="h.dir" class="fv-dir">{{ h.dir }}</span>
      </div>
      <div v-if="truncated" class="px-3 py-1.5 text-xs text-[color:var(--textFaint)]">
        Project lớn — chỉ tìm trong 20.000 file đầu.
      </div>
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col overflow-y-auto pb-7 pt-1 text-sm">
      <div
        class="flex h-[22px] flex-none cursor-default select-none items-center gap-[5px] px-2 text-xs font-[640] text-[color:var(--textDim)]"
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

<style scoped>
.fv-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  max-width: 160px;
  margin-left: 4px;
  overflow: hidden;
  transition:
    max-width 0.18s ease,
    opacity 0.14s ease,
    margin-left 0.18s ease;
}
.fv-actions.is-hidden {
  max-width: 0;
  margin-left: 0;
  opacity: 0;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .fv-actions {
    transition: none;
  }
}
.fv-hit {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  cursor: pointer;
  color: var(--textMuted);
  white-space: nowrap;
}
.fv-hit.on {
  background: var(--accentDim);
  color: var(--text);
  box-shadow: inset 2px 0 0 var(--accent);
}
.fv-name {
  flex: none;
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fv-name b {
  color: var(--accent);
  font-weight: 600;
}
.fv-dir {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
</style>
