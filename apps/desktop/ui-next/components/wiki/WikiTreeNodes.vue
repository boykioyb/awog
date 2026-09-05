<template>
  <div v-for="node in nodes" :key="node.key" class="wtn">
    <div
      class="wtn-row"
      :class="{ on: node.page && pageKey(node.page) === selectedKey }"
      :title="node.page?.description || node.path"
      :style="{ paddingLeft: `${6 + node.depth * 12}px` }"
      @click="onRowClick(node)"
      @contextmenu.prevent="node.page && emit('context-page', $event, node.page)"
    >
      <button
        v-if="node.children.length > 0"
        class="wtn-twist"
        :title="collapsed(node) ? t('wiki.tree.expand') : t('wiki.tree.collapse')"
        @click.stop="emit('toggle', node)"
      >
        <Icon :name="collapsed(node) ? 'chev-right' : 'chev'" :size="12" />
      </button>
      <span v-else class="wtn-twist wtn-twistoff" />

      <Icon :name="node.page ? 'file' : 'folder'" :size="12" class="wtn-icon" />
      <span class="wtn-title">{{ node.title }}</span>
      <span
        v-if="node.depth === 0 && node.source === 'project'"
        class="tag acc"
        style="padding: 1px 6px"
      >
        {{ t('wiki.tier.project') }}
      </span>

      <Icon
        v-if="node.page && !node.page.context"
        name="eye-off"
        :size="12"
        class="wtn-dim"
        :title="t('wiki.page.hiddenFromLlm')"
      />
      <span v-if="node.children.length > 0" class="wtn-count">{{ node.pageCount }}</span>
      <button
        class="wtn-add"
        :title="t('wiki.tree.newChild')"
        @click.stop="emit('new-child', node)"
      >
        <Icon name="plus" :size="12" />
      </button>
    </div>

    <WikiTreeNodes
      v-if="node.children.length > 0 && !collapsed(node)"
      :nodes="node.children"
      :selected-key="selectedKey"
      :is-collapsed="isCollapsed"
      @open="(p) => emit('open', p)"
      @toggle="(n) => emit('toggle', n)"
      @new-child="(n) => emit('new-child', n)"
      @context-page="(e, p) => emit('context-page', e, p)"
    />
  </div>
</template>

<script setup lang="ts">
// Recursive wiki tree rows (Notion-style nesting). Self-referencing by name — the
// SFC's own filename resolves inside its template, the same trick
// EditorFileTreeNodes uses for the workspace file tree.
//
// A node can be a page, a pure container (a folder on disk with no page of its own),
// or both. Clicking a page opens it; clicking a container toggles it, because there
// is nothing to open — silently doing nothing would read as a broken row.
import type { WikiTreeNode } from '~/composables/useWikiManager'
import type { WikiPage } from '~/stores/wiki'
import { wikiKey } from '~/stores/wiki'

const props = defineProps<{
  nodes: WikiTreeNode[]
  selectedKey: string
  isCollapsed: (node: WikiTreeNode) => boolean
}>()

const emit = defineEmits<{
  open: [page: WikiPage]
  toggle: [node: WikiTreeNode]
  'new-child': [node: WikiTreeNode]
  'context-page': [event: MouseEvent, page: WikiPage]
}>()

const { t } = useI18n()

const pageKey = (page: WikiPage): string => wikiKey(page)
const collapsed = (node: WikiTreeNode): boolean => props.isCollapsed(node)

function onRowClick(node: WikiTreeNode): void {
  if (node.page) emit('open', node.page)
  else emit('toggle', node)
}
</script>

<style scoped>
.wtn-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-radius: var(--r-sm);
  color: var(--textDim);
  cursor: pointer;
  font-size: 1em;
}
.wtn-row:hover {
  background: var(--bgHover);
  color: var(--text);
}
.wtn-row.on {
  background: var(--bgActive);
  color: var(--text);
}
.wtn-twist {
  flex: 0 0 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--textFaint);
  cursor: pointer;
}
.wtn-twistoff {
  cursor: default;
}
.wtn-icon {
  flex: 0 0 auto;
  color: var(--textFaint);
}
.wtn-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wtn-dim {
  flex: 0 0 auto;
  color: var(--textFaint);
}
.wtn-count {
  font-family: var(--code);
  font-size: 12px;
  line-height: 1;
  min-width: 18px;
  text-align: right;
  color: var(--textFaint);
}
/* The add-child affordance stays hidden until the row is hovered — Notion's
   behaviour, and it keeps a deep tree from looking like a wall of buttons. */
.wtn-add {
  flex: 0 0 auto;
  background: transparent;
  border: 0;
  padding: 0 2px;
  color: var(--textFaint);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur) var(--ease);
}
.wtn-row:hover .wtn-add {
  opacity: 1;
}
.wtn-add:hover {
  color: var(--text);
}
</style>
