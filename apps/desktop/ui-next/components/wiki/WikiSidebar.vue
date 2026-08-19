<template>
  <aside
    class="wsidebar"
    :style="{
      background: 'var(--bgPanel)',
      borderRight: '1px solid var(--border)',
      flex: `0 0 ${width}px`,
      width: `${width}px`,
    }"
  >
    <div class="wsb-top">
      <div class="wsb-search">
        <Icon name="search" :size="13" />
        <input
          :value="query"
          class="wsb-input"
          :placeholder="t('wiki.searchPlaceholder')"
          @input="emit('update:query', ($event.target as HTMLInputElement).value)"
          @keydown.enter="emit('search')"
        />
        <button
          v-if="query"
          class="wsb-clear"
          :title="t('common.clear')"
          @click="emit('clear-search')"
        >
          <Icon name="x" :size="12" />
        </button>
      </div>
      <div class="wsb-actions">
        <button class="btn sm" :title="t('wiki.newPage')" @click="emit('new-page')">
          <Icon name="plus" :size="13" />
          {{ t('wiki.newPage') }}
        </button>
        <button class="btn sm" :title="t('wiki.import.files')" @click="emit('import-files')">
          <Icon name="download" :size="13" />
          {{ t('wiki.import.short') }}
        </button>
      </div>
    </div>

    <div class="wsb-tree">
      <div v-if="tree.length === 0" class="wsb-empty" :style="{ color: 'var(--textFaint)' }">
        {{ t('wiki.tree.empty') }}
      </div>

      <div
        v-for="node in tree"
        :key="node.space + node.source + (node.projectId ?? '')"
        class="wsb-space"
      >
        <button class="wsb-spacerow" @click="emit('toggle-space', node)">
          <Icon :name="collapsed(node) ? 'chev-right' : 'chev'" :size="12" />
          <span class="wsb-spacename">
            {{ node.space === '' ? t('wiki.tree.rootGroup') : node.title }}
          </span>
          <span v-if="node.source === 'project'" class="tag acc" style="padding: 1px 6px">
            {{ t('wiki.tier.project') }}
          </span>
          <span class="wsb-count">{{ node.pages.length }}</span>
        </button>

        <template v-if="!collapsed(node)">
          <button
            v-for="page in node.pages"
            :key="page.path + page.source + (page.projectId ?? '')"
            class="wsb-page"
            :class="{ on: pageKey(page) === selectedKey }"
            :title="page.description || page.path"
            @click="emit('open', page)"
            @contextmenu.prevent="emit('context-page', $event, page)"
          >
            <Icon name="file" :size="12" />
            <span class="wsb-pagetitle">{{ page.title }}</span>
            <Icon
              v-if="!page.context"
              name="eye-off"
              :size="12"
              class="wsb-hidden"
              :title="t('wiki.page.hiddenFromLlm')"
            />
          </button>
        </template>
      </div>
    </div>

    <div
      class="wsb-foot"
      :style="{ borderTop: '1px solid var(--border)', color: 'var(--textFaint)' }"
    >
      {{ t('wiki.footer.budget', { pages: contextPageCount, chars: chars }) }}
    </div>
  </aside>
  <div ref="resizeEl" class="wsb-resize" :class="{ drag: dragging }" @pointerdown="onPointerDown" />
</template>

<script setup lang="ts">
// Wiki sidebar: search box, create/import actions, and the space → page tree.
// Presentational only — every action is emitted up to the page controller
// (useWikiManager), which owns the state (nuxt-vue rule: thin components).
import type { WikiTreeNode } from '~/composables/useWikiManager'
import type { WikiPage } from '~/stores/wiki'
import { wikiKey } from '~/stores/wiki'

const props = defineProps<{
  tree: WikiTreeNode[]
  selectedKey: string
  query: string
  isCollapsed: (node: WikiTreeNode) => boolean
  contextPageCount: number
  indexChars: number
  width: number
}>()

const emit = defineEmits<{
  open: [page: WikiPage]
  'toggle-space': [node: WikiTreeNode]
  'context-page': [event: MouseEvent, page: WikiPage]
  'update:query': [value: string]
  search: []
  'clear-search': []
  'new-page': []
  'import-files': []
  resize: [width: number]
}>()

const { t } = useI18n()

const pageKey = (page: WikiPage): string => wikiKey(page)

// Drag-to-resize, same idiom as GitSidebar: pointer capture on the handle, width
// emitted up so the page owns (and persists) it.
const resizeEl = useTemplateRef<HTMLElement>('resizeEl')
const dragging = ref(false)

function onPointerDown(ev: PointerEvent): void {
  const handle = resizeEl.value
  if (!handle) return
  ev.preventDefault()
  handle.setPointerCapture(ev.pointerId)
  dragging.value = true
  const startX = ev.clientX
  const startW = props.width
  const move = (e: PointerEvent) => {
    emit('resize', Math.max(200, Math.min(480, startW + (e.clientX - startX))))
  }
  const up = () => {
    dragging.value = false
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
}
const collapsed = (node: WikiTreeNode): boolean => props.isCollapsed(node)
// Rounded to the nearest 100 chars — the point is the order of magnitude the
// index costs per turn, not an exact byte count.
const chars = computed(() =>
  props.indexChars >= 1000 ? `${(props.indexChars / 1000).toFixed(1)}k` : String(props.indexChars),
)
</script>

<style scoped>
.wsidebar {
  display: flex;
  flex-direction: column;
  min-width: 200px;
  height: 100%;
  overflow: hidden;
}
.wsb-resize {
  flex: 0 0 4px;
  cursor: col-resize;
  background: transparent;
  transition: background var(--dur) var(--ease);
}
.wsb-resize:hover,
.wsb-resize.drag {
  background: var(--accentDim);
}
.wsb-top {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wsb-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: var(--r);
  background: var(--bgInput);
  color: var(--textDim);
}
.wsb-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--text);
  font-size: 1em;
}
.wsb-clear {
  background: transparent;
  border: 0;
  color: var(--textFaint);
  cursor: pointer;
  padding: 0;
}
.wsb-actions {
  display: flex;
  gap: 6px;
}
.wsb-actions .btn {
  flex: 1;
  justify-content: center;
}
.wsb-tree {
  flex: 1;
  overflow-y: auto;
  padding: 0 4px 8px;
}
.wsb-empty {
  padding: 16px 8px;
  font-size: 1em;
  line-height: 1.5;
}
.wsb-space {
  margin-bottom: 2px;
}
.wsb-spacerow,
.wsb-page {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 6px;
  background: transparent;
  border: 0;
  border-radius: var(--r);
  color: var(--textDim);
  cursor: pointer;
  text-align: left;
  font-size: 1em;
}
.wsb-spacerow {
  color: var(--text);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.wsb-spacerow:hover,
.wsb-page:hover {
  background: var(--bgHover);
  color: var(--text);
}
.wsb-page.on {
  background: var(--bgActive);
  color: var(--text);
}
.wsb-page {
  padding-left: 20px;
}
.wsb-spacename,
.wsb-pagetitle {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wsb-count {
  font-family: var(--code);
  font-size: 12px;
  line-height: 1;
  min-width: 18px;
  text-align: right;
  color: var(--textFaint);
}
.wsb-hidden {
  color: var(--textFaint);
  flex: 0 0 auto;
}
.wsb-foot {
  padding: 6px 8px;
  font-size: 12px;
  line-height: 1.4;
}
</style>
