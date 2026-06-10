<template>
  <div class="flex flex-col h-full min-h-0" :style="{ background: t.bgPanel }">
    <!-- Toolbar -->
    <div
      class="flex items-center justify-between px-3 py-2 flex-shrink-0"
      :style="{ borderBottom: `1px solid ${t.border}` }"
    >
      <span class="text-[1em] uppercase tracking-wide font-medium" :style="{ color: t.textDim }">
        {{ tr('code.explorer') }}
      </span>
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          :title="tr('code.explorer.new_file')"
          :style="iconBtn"
          @click="startNew('file', '')"
        >
          <FilePlus :size="13" />
        </button>
        <button
          type="button"
          :title="tr('code.explorer.new_folder')"
          :style="iconBtn"
          @click="startNew('folder', '')"
        >
          <FolderPlus :size="13" />
        </button>
        <button
          type="button"
          :title="tr('code.refresh')"
          :style="iconBtn"
          @click="ctx.refreshTree()"
        >
          <RefreshCw :size="13" />
        </button>
      </div>
    </div>

    <!-- New item inline input -->
    <div
      v-if="newItem"
      class="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0"
      :style="{ background: t.bgSubtle }"
    >
      <component
        :is="newItem.kind === 'folder' ? FolderPlus : FilePlus"
        :size="13"
        :style="{ color: t.textDim }"
      />
      <input
        ref="newItemInput"
        v-model="newItemName"
        :placeholder="newItem.dir ? `${newItem.dir}/…` : tr('code.explorer.name_placeholder')"
        class="flex-1 min-w-0 px-1 rounded text-[1em] outline-none"
        :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.borderFocus}` }"
        @keydown.enter.prevent="submitNew"
        @keydown.esc.prevent="cancelNew"
        @blur="cancelNew"
      />
    </div>

    <!-- Tree -->
    <div class="flex-1 min-h-0 overflow-auto py-1">
      <p
        v-if="ctx.rootEntries.value.length === 0"
        class="px-3 py-2 text-[1em]"
        :style="{ color: t.textFaint }"
      >
        {{ tr('code.explorer.empty') }}
      </p>
      <CodeTreeNode
        v-for="entry in ctx.rootEntries.value"
        :key="entry.path"
        :entry="entry"
        :depth="0"
        :expanded="ctx.expanded"
        :children-by-path="ctx.childrenByPath"
        :active-path="ctx.activePath.value"
        :renaming-path="renamingPath"
        :on-toggle="ctx.toggleDir"
        :on-open="(e) => ctx.openFile(e.path)"
        :on-context="onContext"
        :on-rename-submit="onRenameSubmit"
        :on-rename-cancel="() => (renamingPath = null)"
      />
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <template v-if="menu">
        <div class="fixed inset-0 z-40" @click="menu = null" @contextmenu.prevent="menu = null" />
        <div
          class="fixed z-50 py-1 rounded-md shadow-lg min-w-[160px] text-[1em]"
          :style="{
            top: `${menu.y}px`,
            left: `${menu.x}px`,
            background: t.bgElevated,
            border: `1px solid ${t.border}`,
          }"
        >
          <button
            v-for="item in menuItems"
            :key="item.label"
            type="button"
            class="w-full text-left px-3 py-1.5 transition"
            :style="{ color: item.danger ? t.danger : t.text }"
            @mouseenter="(e) => hover(e, true, item.danger)"
            @mouseleave="(e) => hover(e, false, item.danger)"
            @click="item.run"
          >
            {{ item.label }}
          </button>
        </div>
      </template>
    </Teleport>

    <!-- Delete confirm -->
    <Teleport to="body">
      <div
        v-if="deleting"
        class="fixed inset-0 z-50 flex items-center justify-center"
        :style="{ background: 'rgba(0,0,0,0.5)' }"
        @click.self="deleting = null"
      >
        <div
          class="w-80 rounded-lg p-4"
          :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
        >
          <p class="text-[1em] font-medium mb-1" :style="{ color: t.text }">
            {{
              deleting.isDir ? tr('code.explorer.delete_folder') : tr('code.explorer.delete_file')
            }}
          </p>
          <p class="text-[1em] mb-4 break-all" :style="{ color: t.textDim }">{{ deleting.path }}</p>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1.5 rounded text-[1em]"
              :style="ghostBtn"
              @click="deleting = null"
            >
              {{ tr('common.cancel') }}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded text-[1em]"
              :style="{ background: t.dangerBg, color: t.danger }"
              @click="confirmDelete"
            >
              {{ tr('common.delete') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { FilePlus, FolderPlus, RefreshCw } from 'lucide-vue-next'
import { computed, nextTick, ref } from 'vue'
import type { CSSProperties } from 'vue'
import type { FsEntry } from '~/types'
import { useSidecar } from '~/composables/useSidecar'
import { useProjectWorkspaceContext } from '~/composables/useProjectWorkspace'
import CodeTreeNode from './CodeTreeNode.vue'

const { t } = useTheme()
const { t: tr } = useI18n()
const ctx = useProjectWorkspaceContext()
const sidecar = useSidecar()

const iconBtn = computed<CSSProperties>(() => ({
  padding: '6px',
  borderRadius: '4px',
  color: t.value.textDim,
  transition: 'all 0.15s',
}))
const ghostBtn = computed<CSSProperties>(() => ({
  background: t.value.bgHover,
  color: t.value.text,
}))

// ── New file / folder ──
const newItem = ref<{ kind: 'file' | 'folder'; dir: string } | null>(null)
const newItemName = ref('')
const newItemInput = ref<HTMLInputElement | null>(null)

const startNew = async (kind: 'file' | 'folder', dir: string) => {
  newItem.value = { kind, dir }
  newItemName.value = ''
  await nextTick()
  newItemInput.value?.focus()
}
const cancelNew = () => {
  newItem.value = null
}
const submitNew = async () => {
  const item = newItem.value
  const name = newItemName.value.trim()
  if (!item || !name) {
    cancelNew()
    return
  }
  if (item.kind === 'file') await ctx.createFile(item.dir, name)
  else await ctx.createFolder(item.dir, name)
  newItem.value = null
}

// ── Rename ──
const renamingPath = ref<string | null>(null)
const onRenameSubmit = async (from: string, name: string) => {
  renamingPath.value = null
  await ctx.renamePath(from, name)
}

// ── Delete ──
const deleting = ref<{ path: string; isDir: boolean } | null>(null)
const confirmDelete = async () => {
  const d = deleting.value
  if (!d) return
  deleting.value = null
  await ctx.deletePath(d.path, d.isDir)
}

// ── Context menu ──
const menu = ref<{ x: number; y: number; entry: FsEntry } | null>(null)
const onContext = (entry: FsEntry, ev: MouseEvent) => {
  menu.value = { x: ev.clientX, y: ev.clientY, entry }
}

const closeMenu = () => {
  menu.value = null
}
const act = (fn: () => void) => {
  closeMenu()
  fn()
}

interface MenuItem {
  label: string
  run: () => void
  danger?: boolean
}
const menuItems = computed<MenuItem[]>(() => {
  const m = menu.value
  if (!m) return []
  const { entry } = m
  const items: MenuItem[] = []
  if (entry.kind === 'file') {
    items.push({ label: tr('common.open'), run: () => act(() => ctx.openFile(entry.path)) })
  } else {
    items.push({
      label: tr('code.menu.new_file'),
      run: () => act(() => startNew('file', entry.path)),
    })
    items.push({
      label: tr('code.menu.new_folder'),
      run: () => act(() => startNew('folder', entry.path)),
    })
  }
  items.push({
    label: tr('common.rename'),
    run: () =>
      act(() => {
        renamingPath.value = entry.path
      }),
  })
  items.push({
    label: tr('code.menu.reveal_os'),
    run: () =>
      act(() => {
        sidecar.revealPath(ctx.workspaceRoot.value, entry.path).catch(() => undefined)
      }),
  })
  items.push({
    label: tr('common.delete'),
    danger: true,
    run: () =>
      act(() => {
        deleting.value = { path: entry.path, isDir: entry.kind === 'dir' }
      }),
  })
  return items
})

const hover = (e: MouseEvent, on: boolean, danger?: boolean) => {
  const el = e.target as HTMLElement
  let color = 'transparent'
  if (on) color = danger ? t.value.dangerBg : t.value.bgHover
  el.style.background = color
}
</script>
