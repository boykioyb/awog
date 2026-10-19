<template>
  <div
    class="relative flex h-full flex-col overflow-hidden"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent.stop="onDrop"
  >
    <!-- OS drag-drop upload target: dropping files from the file manager uploads
         them into the current directory. -->
    <div
      v-if="isDragging"
      class="pointer-events-none absolute inset-0 z-6 flex flex-col items-center justify-center gap-2.5 rounded-md border-2 border-dashed border-primary bg-selected text-base font-semibold text-primary"
    >
      <Icon name="download" class="size-6 rotate-180" />
      <span>{{ t('ssh.sftp.dropHint') }}</span>
    </div>

    <div class="flex shrink-0 items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground">
      <Icon name="folder" class="size-3.5" />
      <span class="min-w-0 font-semibold">{{ t('ssh.section.sftp') }}</span>
      <div class="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="iconSm"
          class="text-muted-foreground"
          :title="t('ssh.sftp.newFile')"
          :aria-label="t('ssh.sftp.newFile')"
          @click="newFile"
        >
          <Icon name="file" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="text-muted-foreground"
          :title="t('ssh.sftp.mkdir')"
          :aria-label="t('ssh.sftp.mkdir')"
          @click="mkdir"
        >
          <Icon name="plus" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="text-muted-foreground"
          :title="t('ssh.sftp.upload')"
          :aria-label="t('ssh.sftp.upload')"
          @click="upload"
        >
          <Icon name="download" class="rotate-180" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="text-muted-foreground"
          :title="t('ssh.sftp.refresh')"
          :aria-label="t('ssh.sftp.refresh')"
          @click="load"
        >
          <Icon name="refresh" />
        </Button>
        <SftpColumnsMenu :columns="columns" @toggle="toggleColumn" />
        <Button
          variant="ghost"
          size="iconSm"
          class="text-muted-foreground"
          :title="t('ssh.panel.close')"
          :aria-label="t('ssh.panel.close')"
          @click="emit('close')"
        >
          <Icon name="x" />
        </Button>
      </div>
    </div>
    <Separator />

    <!-- Path bar: clickable breadcrumb, or an editable input (pencil / double-click). -->
    <div class="flex shrink-0 items-center">
      <template v-if="!editingPath">
        <div
          class="flex min-w-0 flex-1 cursor-text flex-wrap items-center gap-0.5 px-2 py-1 text-sm"
          @dblclick="startEditPath"
        >
          <Button
            variant="ghost"
            size="xs"
            :class="CRUMB"
            :disabled="cwd === '.'"
            @click="navigate('.')"
          >
            ~
          </Button>
          <template v-for="(seg, i) in crumbs" :key="i">
            <span class="text-muted-foreground">/</span>
            <Button variant="ghost" size="xs" :class="CRUMB" @click="navigate(seg.path)">
              {{ seg.name }}
            </Button>
          </template>
        </div>
        <Button
          variant="ghost"
          size="iconSm"
          class="mr-1 text-muted-foreground"
          :title="t('ssh.sftp.editPath')"
          :aria-label="t('ssh.sftp.editPath')"
          @click="startEditPath"
        >
          <Icon name="edit" />
        </Button>
      </template>
      <Input
        v-else
        ref="pathInput"
        v-model="pathDraft"
        spellcheck="false"
        :placeholder="t('ssh.sftp.pathPh')"
        class="mx-2 my-1 h-ctrl-xs min-w-0 flex-1 font-mono"
        @keydown.enter="commitPath"
        @keydown.esc="editingPath = false"
        @blur="editingPath = false"
      />
    </div>
    <Separator />

    <!-- Bulk-action bar (shown while ≥1 row is selected). -->
    <template v-if="hasSelection">
      <div class="flex shrink-0 items-center gap-2.5 bg-selected px-2.5 py-1.5">
        <span class="text-sm font-semibold text-primary">
          {{ t('ssh.sftp.selectedN', { count: selectedEntries.length }) }}
        </span>
        <div class="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="xs"
            class="bg-card"
            @click="openPathPicker('copy', selectedEntries)"
          >
            {{ t('ssh.sftp.ctx.copyTo') }}
          </Button>
          <Button
            variant="outline"
            size="xs"
            class="bg-card"
            @click="openPathPicker('move', selectedEntries)"
          >
            {{ t('ssh.sftp.ctx.moveTo') }}
          </Button>
          <Button
            variant="outline"
            size="xs"
            class="bg-card hover:border-transparent hover:bg-destructive/10 hover:text-destructive"
            @click="del(selectedEntries)"
          >
            {{ t('ssh.sftp.delete') }}
          </Button>
          <Button variant="outline" size="xs" class="bg-card" @click="clearSelection">
            {{ t('ssh.sftp.clearSelection') }}
          </Button>
        </div>
      </div>
      <Separator />
    </template>

    <!-- select-none: ⌘/Shift-click dựng selection — không bao giờ thành kéo chữ native. -->
    <div class="min-h-0 flex-auto overflow-auto select-none" @contextmenu.self.prevent>
      <div v-if="loading" class="px-3.5 py-3 text-sm text-muted-foreground">
        {{ t('ssh.sftp.loading') }}
      </div>
      <div v-else-if="error" class="px-3.5 py-3 font-mono text-sm break-words text-destructive">
        {{ error }}
      </div>
      <template v-else>
        <!-- Column header (sortable name/size/modified). -->
        <div
          class="sticky top-0 z-1 grid items-center gap-2 border-b bg-background px-2.5 py-1"
          :style="{ gridTemplateColumns: gridTemplate }"
        >
          <Button
            variant="ghost"
            size="xs"
            :class="[HC_BTN, 'justify-start']"
            @click="setSort('name')"
          >
            {{ t('ssh.sftp.col.name') }}
            <span v-if="sortKey === 'name'" :class="SORT_MARK">{{ sortAsc ? '▲' : '▼' }}</span>
          </Button>
          <Button
            v-if="hasCol('size')"
            variant="ghost"
            size="xs"
            :class="[HC_BTN, 'justify-end']"
            @click="setSort('size')"
          >
            {{ t('ssh.sftp.col.size') }}
            <span v-if="sortKey === 'size'" :class="SORT_MARK">{{ sortAsc ? '▲' : '▼' }}</span>
          </Button>
          <span v-if="hasCol('perms')" :class="HC">{{ t('ssh.sftp.col.perms') }}</span>
          <span v-if="hasCol('owner')" :class="HC">{{ t('ssh.sftp.col.owner') }}</span>
          <span v-if="hasCol('group')" :class="HC">{{ t('ssh.sftp.col.group') }}</span>
          <Button
            v-if="hasCol('modified')"
            variant="ghost"
            size="xs"
            :class="[HC_BTN, 'justify-start']"
            @click="setSort('modified')"
          >
            {{ t('ssh.sftp.col.modified') }}
            <span v-if="sortKey === 'modified'" :class="SORT_MARK">{{ sortAsc ? '▲' : '▼' }}</span>
          </Button>
          <span v-if="hasCol('accessed')" :class="HC">{{ t('ssh.sftp.col.accessed') }}</span>
          <span v-if="hasCol('changed')" :class="HC">{{ t('ssh.sftp.col.changed') }}</span>
        </div>

        <!-- raw-ok: cả hàng ".." là một vùng bấm (lên thư mục cha), không phải nút. -->
        <button
          v-if="cwd !== '.'"
          type="button"
          class="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1 text-left text-sm text-foreground hover:bg-accent"
          :class="ROW_SEP"
          @click="navigate(parentPath)"
        >
          <Icon name="chev" class="size-3.5 shrink-0 rotate-90 text-muted-foreground" />
          <span class="flex min-w-0 items-center gap-2">..</span>
        </button>

        <div v-if="!sorted.length" class="px-3.5 py-3 text-sm text-muted-foreground">
          {{ t('ssh.sftp.empty') }}
        </div>
        <div
          v-for="(e, i) in sorted"
          :key="e.name"
          class="grid w-full items-center gap-2 px-2.5 py-1 text-left text-sm text-foreground"
          :class="[
            ROW_SEP,
            e.type === 'dir' ? 'cursor-pointer' : 'cursor-default',
            isSelected(e.name) ? 'bg-selected' : 'hover:bg-accent',
          ]"
          :style="{ gridTemplateColumns: gridTemplate }"
          @click="onRowClick(e, i, $event)"
          @contextmenu.prevent="ctx.open($event, e)"
        >
          <span class="flex min-w-0 items-center gap-2 overflow-hidden">
            <Icon
              :name="iconFor(e)"
              class="size-3.5 shrink-0"
              :class="e.type === 'dir' ? 'text-primary' : 'text-muted-foreground'"
            />
            <span class="min-w-0 truncate">{{ e.name }}</span>
          </span>
          <span v-if="hasCol('size')" class="min-w-0 overflow-hidden text-right font-mono">
            {{ e.type === 'dir' ? '' : sizeLabel(e.size) }}
          </span>
          <span v-if="hasCol('perms')" :class="[CELL_DIM, 'font-mono']">
            {{ permString(e.mode, e.type) }}
          </span>
          <span v-if="hasCol('owner')" :class="[CELL_DIM, 'truncate']">
            {{ metaFor(e.name)?.owner ?? e.uid }}
          </span>
          <span v-if="hasCol('group')" :class="[CELL_DIM, 'truncate']">
            {{ metaFor(e.name)?.group ?? e.gid }}
          </span>
          <span v-if="hasCol('modified')" :class="[CELL_DIM, 'font-mono']">
            {{ fmtDate(e.mtime) }}
          </span>
          <span v-if="hasCol('accessed')" :class="[CELL_DIM, 'font-mono']">
            {{ fmtDate(e.atime) }}
          </span>
          <span v-if="hasCol('changed')" :class="[CELL_DIM, 'font-mono']">
            {{ fmtDate(metaFor(e.name)?.ctime ?? 0) }}
          </span>
        </div>
      </template>
    </div>

    <AppContextMenu
      :open="!!ctx.pos.value"
      :position="ctx.pos.value ?? { x: 0, y: 0 }"
      :items="ctx.items.value"
      @select="ctx.onSelect"
      @close="ctx.close"
    />
    <SftpChmodModal
      :open="!!chmodTargets"
      :targets="chmodTargets ?? []"
      @confirm="confirmChmod"
      @cancel="chmodTargets = null"
    />
    <SftpChownModal
      :open="!!chownTargets"
      :targets="chownTargets ?? []"
      @confirm="confirmChown"
      @cancel="chownTargets = null"
    />
    <SftpPathPickerModal
      :open="!!pathPicker"
      :conn-id="connId"
      :mode="pathPicker?.mode ?? 'copy'"
      :start-path="cwd"
      @confirm="onPathPicked"
      @cancel="pathPicker = null"
    />
  </div>
</template>

<script setup lang="ts">
// SFTP file manager (ADR 0063 P3, upgraded) — a remote file browser over an open
// SSH connection. Table with customizable columns (perms/owner/group/dates),
// multi-select (⌘/Shift, highlight-only), a full right-click menu (copy/move/
// compress/extract/chmod/chown/…) and bulk actions. All state + IPC lives in the
// useSftpBrowser controller; the right-click menu is built by useSftpContextMenu.
import { computed, onMounted, ref, toRef } from 'vue'
import SftpChmodModal from '~/components/ssh/SftpChmodModal.vue'
import SftpChownModal from '~/components/ssh/SftpChownModal.vue'
import SftpColumnsMenu from '~/components/ssh/SftpColumnsMenu.vue'
import SftpPathPickerModal from '~/components/ssh/SftpPathPickerModal.vue'
import {
  ALL_SFTP_COLUMNS,
  permString,
  useSftpBrowser,
  type SftpColumn,
} from '~/composables/useSftpBrowser'
import { useSftpContextMenu } from '~/composables/useSftpContextMenu'
import type { SftpEntry } from '~/composables/useSshApi'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{ connId: string }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const browser = useSftpBrowser(toRef(props, 'connId'))
const ctx = useSftpContextMenu(browser)

const {
  cwd,
  loading,
  error,
  columns,
  hasCol,
  toggleColumn,
  sortKey,
  sortAsc,
  setSort,
  editingPath,
  pathDraft,
  startEditPath,
  commitPath,
  sorted,
  crumbs,
  parentPath,
  metaFor,
  selectedEntries,
  hasSelection,
  isSelected,
  onRowClick,
  clearSelection,
  load,
  navigate,
  mkdir,
  newFile,
  upload,
  uploadPaths,
  del,
  applyChmod,
  applyChown,
  openPathPicker,
  onPathPicked,
  chmodTargets,
  chownTargets,
  pathPicker,
} = browser

// Fixed column widths (px), applied in the canonical ALL_SFTP_COLUMNS order so the
// header + rows share one grid template. Name flexes.
const COL_WIDTH: Record<SftpColumn, string> = {
  size: '90px',
  perms: '104px',
  owner: '96px',
  group: '96px',
  modified: '138px',
  accessed: '138px',
  changed: '138px',
}
const gridTemplate = computed(
  () =>
    `minmax(0, 1fr) ${ALL_SFTP_COLUMNS.filter((c) => hasCol(c))
      .map((c) => COL_WIDTH[c])
      .join(' ')}`,
)

// Class dùng lặp trong bảng SFTP (header/ô/hàng) — gom một chỗ cho template gọn.
// Hàng chia bằng hairline giữa hai hàng liền kề (`.row + .row`), không viền hàng đầu.
const ROW_SEP = '[&+&]:border-t'
const HC = 'text-sm font-semibold text-muted-foreground'
const HC_BTN = `${HC} h-auto gap-0.5 px-0 hover:bg-transparent hover:text-foreground`
const SORT_MARK = 'ml-0.5 text-[0.75em] text-primary'
const CELL_DIM = 'min-w-0 overflow-hidden text-sm text-muted-foreground'
const CRUMB =
  'h-auto px-1 py-0 font-mono text-sm font-normal text-primary disabled:text-muted-foreground disabled:opacity-100'

const iconFor = (e: SftpEntry): string =>
  e.type === 'dir' ? 'folder' : e.type === 'symlink' ? 'link' : 'file'

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(1)} ${units[i]}`
}
function fmtDate(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function confirmChmod(mode: number): void {
  const tg = chmodTargets.value
  chmodTargets.value = null
  if (tg?.length) void applyChmod(tg, mode)
}
function confirmChown(owner: string, group: string, recursive: boolean): void {
  const tg = chownTargets.value
  chownTargets.value = null
  if (tg?.length) void applyChown(tg, owner, group, recursive)
}

// ── OS drag-drop → upload ──
// A file dragged from the OS file manager exposes its real on-disk path via the
// Electron bridge (webUtils.getPathForFile); we stream each into the current dir.
const dragDepth = ref(0)
const isDragging = computed(() => dragDepth.value > 0)
const isFileDrag = (e: DragEvent): boolean =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
function onDragEnter(e: DragEvent): void {
  if (isFileDrag(e)) dragDepth.value += 1
}
function onDragOver(e: DragEvent): void {
  if (e.dataTransfer && isFileDrag(e)) e.dataTransfer.dropEffect = 'copy'
}
function onDragLeave(e: DragEvent): void {
  if (isFileDrag(e)) dragDepth.value = Math.max(0, dragDepth.value - 1)
}
function onDrop(e: DragEvent): void {
  dragDepth.value = 0
  const files = e.dataTransfer?.files
  if (!files?.length) return
  const bridge = typeof window !== 'undefined' ? window.awog : undefined
  if (!bridge?.getPathForFile) return
  const paths: string[] = []
  for (const f of Array.from(files)) {
    const p = bridge.getPathForFile(f)
    if (p) paths.push(p)
  }
  if (paths.length) void uploadPaths(paths)
}

onMounted(() => {
  void load()
  void browser.loadTools()
})
</script>
