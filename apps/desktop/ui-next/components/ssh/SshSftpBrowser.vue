<template>
  <div
    class="ssh-sf-surface"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent.stop="onDrop"
  >
    <!-- OS drag-drop upload target: dropping files from the file manager uploads
         them into the current directory. -->
    <div v-if="isDragging" class="ssh-sf-drop">
      <Icon name="download" style="width: 26px; height: 26px; transform: rotate(180deg)" />
      <span>{{ t('ssh.sftp.dropHint') }}</span>
    </div>

    <div class="ssh-sf-head">
      <Icon name="folder" style="width: 13px; height: 13px" />
      <span class="ssh-sf-head-t">{{ t('ssh.section.sftp') }}</span>
      <div class="ssh-sf-tools">
        <button
          class="ssh-sf-tool"
          :title="t('ssh.sftp.newFile')"
          :aria-label="t('ssh.sftp.newFile')"
          @click="newFile"
        >
          <Icon name="file" style="width: 13px; height: 13px" />
        </button>
        <button
          class="ssh-sf-tool"
          :title="t('ssh.sftp.mkdir')"
          :aria-label="t('ssh.sftp.mkdir')"
          @click="mkdir"
        >
          <Icon name="plus" style="width: 13px; height: 13px" />
        </button>
        <button
          class="ssh-sf-tool"
          :title="t('ssh.sftp.upload')"
          :aria-label="t('ssh.sftp.upload')"
          @click="upload"
        >
          <Icon name="download" style="width: 13px; height: 13px; transform: rotate(180deg)" />
        </button>
        <button
          class="ssh-sf-tool"
          :title="t('ssh.sftp.refresh')"
          :aria-label="t('ssh.sftp.refresh')"
          @click="load"
        >
          <Icon name="refresh" style="width: 13px; height: 13px" />
        </button>
        <SftpColumnsMenu :columns="columns" @toggle="toggleColumn" />
        <button
          class="ssh-sf-tool"
          :title="t('ssh.panel.close')"
          :aria-label="t('ssh.panel.close')"
          @click="emit('close')"
        >
          <Icon name="x" style="width: 13px; height: 13px" />
        </button>
      </div>
    </div>

    <!-- Path bar: clickable breadcrumb, or an editable input (pencil / double-click). -->
    <div class="ssh-sf-path">
      <template v-if="!editingPath">
        <div class="ssh-sf-crumbs" @dblclick="startEditPath">
          <button class="ssh-sf-crumb" :disabled="cwd === '.'" @click="navigate('.')">~</button>
          <template v-for="(seg, i) in crumbs" :key="i">
            <span class="ssh-sf-sep">/</span>
            <button class="ssh-sf-crumb" @click="navigate(seg.path)">{{ seg.name }}</button>
          </template>
        </div>
        <button
          class="ssh-sf-pathedit"
          :title="t('ssh.sftp.editPath')"
          :aria-label="t('ssh.sftp.editPath')"
          @click="startEditPath"
        >
          <Icon name="edit" style="width: 12px; height: 12px" />
        </button>
      </template>
      <input
        v-else
        ref="pathInput"
        v-model="pathDraft"
        class="ssh-sf-pathinput mono"
        spellcheck="false"
        :placeholder="t('ssh.sftp.pathPh')"
        @keydown.enter="commitPath"
        @keydown.esc="editingPath = false"
        @blur="editingPath = false"
      />
    </div>

    <!-- Bulk-action bar (shown while ≥1 row is selected). -->
    <div v-if="hasSelection" class="ssh-sf-bulk">
      <span class="ssh-sf-bulk-n">
        {{ t('ssh.sftp.selectedN', { count: selectedEntries.length }) }}
      </span>
      <div class="ssh-sf-bulk-acts">
        <button class="ssh-sf-bulk-btn" @click="openPathPicker('copy', selectedEntries)">
          {{ t('ssh.sftp.ctx.copyTo') }}
        </button>
        <button class="ssh-sf-bulk-btn" @click="openPathPicker('move', selectedEntries)">
          {{ t('ssh.sftp.ctx.moveTo') }}
        </button>
        <button class="ssh-sf-bulk-btn danger" @click="del(selectedEntries)">
          {{ t('ssh.sftp.delete') }}
        </button>
        <button class="ssh-sf-bulk-btn" @click="clearSelection">
          {{ t('ssh.sftp.clearSelection') }}
        </button>
      </div>
    </div>

    <div class="ssh-sf-list" @contextmenu.self.prevent>
      <div v-if="loading" class="ssh-sf-empty">{{ t('ssh.sftp.loading') }}</div>
      <div v-else-if="error" class="ssh-sf-err mono">{{ error }}</div>
      <template v-else>
        <!-- Column header (sortable name/size/modified). -->
        <div class="ssh-sf-hrow" :style="{ gridTemplateColumns: gridTemplate }">
          <button class="ssh-sf-hc name" @click="setSort('name')">
            {{ t('ssh.sftp.col.name') }}
            <span v-if="sortKey === 'name'" class="ssh-sf-sort">{{ sortAsc ? '▲' : '▼' }}</span>
          </button>
          <button v-if="hasCol('size')" class="ssh-sf-hc num" @click="setSort('size')">
            {{ t('ssh.sftp.col.size') }}
            <span v-if="sortKey === 'size'" class="ssh-sf-sort">{{ sortAsc ? '▲' : '▼' }}</span>
          </button>
          <span v-if="hasCol('perms')" class="ssh-sf-hc">{{ t('ssh.sftp.col.perms') }}</span>
          <span v-if="hasCol('owner')" class="ssh-sf-hc">{{ t('ssh.sftp.col.owner') }}</span>
          <span v-if="hasCol('group')" class="ssh-sf-hc">{{ t('ssh.sftp.col.group') }}</span>
          <button v-if="hasCol('modified')" class="ssh-sf-hc" @click="setSort('modified')">
            {{ t('ssh.sftp.col.modified') }}
            <span v-if="sortKey === 'modified'" class="ssh-sf-sort">{{ sortAsc ? '▲' : '▼' }}</span>
          </button>
          <span v-if="hasCol('accessed')" class="ssh-sf-hc">{{ t('ssh.sftp.col.accessed') }}</span>
          <span v-if="hasCol('changed')" class="ssh-sf-hc">{{ t('ssh.sftp.col.changed') }}</span>
        </div>

        <button v-if="cwd !== '.'" class="ssh-sf-row up" @click="navigate(parentPath)">
          <Icon name="chev" class="ssh-sf-up-icn" style="width: 13px; height: 13px" />
          <span class="ssh-sf-name">..</span>
        </button>

        <div v-if="!sorted.length" class="ssh-sf-empty">{{ t('ssh.sftp.empty') }}</div>
        <div
          v-for="(e, i) in sorted"
          :key="e.name"
          class="ssh-sf-row"
          :class="{ dir: e.type === 'dir', sel: isSelected(e.name) }"
          :style="{ gridTemplateColumns: gridTemplate }"
          @click="onRowClick(e, i, $event)"
          @contextmenu.prevent="ctx.open($event, e)"
        >
          <span class="ssh-sf-c ssh-sf-name">
            <Icon :name="iconFor(e)" class="ssh-sf-icn" style="width: 13px; height: 13px" />
            <span class="ssh-sf-nametext">{{ e.name }}</span>
          </span>
          <span v-if="hasCol('size')" class="ssh-sf-c num mono">
            {{ e.type === 'dir' ? '' : sizeLabel(e.size) }}
          </span>
          <span v-if="hasCol('perms')" class="ssh-sf-c mono dim">
            {{ permString(e.mode, e.type) }}
          </span>
          <span v-if="hasCol('owner')" class="ssh-sf-c dim ellip">
            {{ metaFor(e.name)?.owner ?? e.uid }}
          </span>
          <span v-if="hasCol('group')" class="ssh-sf-c dim ellip">
            {{ metaFor(e.name)?.group ?? e.gid }}
          </span>
          <span v-if="hasCol('modified')" class="ssh-sf-c mono dim">{{ fmtDate(e.mtime) }}</span>
          <span v-if="hasCol('accessed')" class="ssh-sf-c mono dim">{{ fmtDate(e.atime) }}</span>
          <span v-if="hasCol('changed')" class="ssh-sf-c mono dim">
            {{ fmtDate(metaFor(e.name)?.ctime ?? 0) }}
          </span>
        </div>
      </template>
    </div>

    <ContextMenu
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
import ContextMenu from '~/components/common/ContextMenu.vue'
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

<style scoped>
/* Fills its host area flush (the split divider + edge delimit it). */
.ssh-sf-surface {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* OS drag-drop upload overlay — covers the whole panel while files hover. */
.ssh-sf-drop {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  pointer-events: none;
  background: var(--accentDim);
  border: 2px dashed var(--accent);
  border-radius: 8px;
  color: var(--accent);
  font-size: 1rem;
  font-weight: 600;
}
.ssh-sf-head {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  padding: 6px 10px;
  font-size: 0.8462rem;
  color: var(--textDim);
  border-bottom: 1px solid var(--border);
}
.ssh-sf-head-t {
  font-weight: 600;
  min-width: 0;
}
.ssh-sf-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.ssh-sf-tool {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
}
.ssh-sf-tool:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ssh-sf-tool:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.ssh-sf-empty {
  padding: 12px 14px;
  font-size: 0.9231rem;
  color: var(--textDim);
}
.ssh-sf-path {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--border);
}
.ssh-sf-crumbs {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
  font-size: 0.8846rem;
  cursor: text;
}
.ssh-sf-pathedit {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
  margin-right: 4px;
}
.ssh-sf-pathedit:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ssh-sf-pathinput {
  flex: 1;
  min-width: 0;
  margin: 4px 8px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--accent);
  background: var(--bgInput);
  color: var(--text);
  font-size: 0.8846rem;
  outline: none;
}
.ssh-sf-crumb {
  border: none;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  padding: 1px 3px;
  border-radius: 5px;
  font-family: var(--code);
}
.ssh-sf-crumb:disabled {
  color: var(--textDim);
  cursor: default;
}
.ssh-sf-crumb:not(:disabled):hover {
  background: var(--bgHover);
}
.ssh-sf-sep {
  color: var(--textDim);
}
/* ── bulk bar ── */
.ssh-sf-bulk {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--accentDim);
}
.ssh-sf-bulk-n {
  font-size: 0.8846rem;
  font-weight: 600;
  color: var(--accent);
}
.ssh-sf-bulk-acts {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.ssh-sf-bulk-btn {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bgEl);
  color: var(--text);
  font-size: 0.8462rem;
  cursor: pointer;
}
.ssh-sf-bulk-btn:hover {
  border-color: var(--borderStrong);
}
.ssh-sf-bulk-btn.danger:hover {
  background: var(--dangerDim);
  color: var(--danger);
  border-color: transparent;
}
/* ── list / table ── */
.ssh-sf-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  /* Ctrl/⌘/Shift-click builds a selection — never a native browser text drag. */
  user-select: none;
}
.ssh-sf-hrow {
  display: grid;
  align-items: center;
  gap: 9px;
  padding: 5px 10px;
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.ssh-sf-hc {
  font-size: 12px;
  font-weight: 600;
  color: var(--textDim);
  text-align: left;
  background: transparent;
  border: none;
  padding: 0;
  cursor: default;
}
button.ssh-sf-hc {
  cursor: pointer;
}
button.ssh-sf-hc:hover {
  color: var(--text);
}
.ssh-sf-hc.num {
  text-align: right;
}
.ssh-sf-sort {
  margin-left: 3px;
  font-size: 9px;
  color: var(--accent);
}
.ssh-sf-row {
  display: grid;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 5px 10px;
  border: none;
  background: transparent;
  color: var(--text);
  text-align: left;
  font-size: 0.9231rem;
  cursor: default;
}
.ssh-sf-row + .ssh-sf-row {
  border-top: 1px solid var(--border);
}
.ssh-sf-row.dir {
  cursor: pointer;
}
.ssh-sf-row:hover {
  background: var(--bgHover);
}
.ssh-sf-row.sel {
  background: var(--accentDim);
}
.ssh-sf-row.up {
  display: flex;
  cursor: pointer;
}
.ssh-sf-up-icn {
  transform: rotate(90deg);
  color: var(--textDim);
}
.ssh-sf-c {
  min-width: 0;
  overflow: hidden;
}
.ssh-sf-c.num {
  text-align: right;
}
.ssh-sf-c.dim {
  color: var(--textDim);
  font-size: 12px;
}
.ssh-sf-c.ellip {
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ssh-sf-name {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.ssh-sf-nametext {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ssh-sf-icn {
  flex: 0 0 auto;
  color: var(--textDim);
}
.ssh-sf-row.dir .ssh-sf-icn {
  color: var(--accent);
}
.ssh-sf-err {
  padding: 12px 14px;
  font-size: 0.8846rem;
  color: var(--danger);
  word-break: break-word;
}
</style>
