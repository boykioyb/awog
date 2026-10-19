<template>
  <div v-for="node in nodes" :key="node.key">
    <div
      class="group/wtn flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-1 hover:bg-accent hover:text-foreground"
      :class="
        node.page && pageKey(node.page) === selectedKey
          ? 'border-selected-border bg-selected text-foreground'
          : 'border-transparent text-dim'
      "
      :title="node.page?.description || node.path"
      :style="{ paddingLeft: `${6 + node.depth * 12}px` }"
      @click="onRowClick(node)"
      @contextmenu.prevent="node.page && emit('context-page', $event, node.page)"
    >
      <Button
        v-if="node.children.length > 0"
        variant="ghost"
        size="iconSm"
        class="size-3.5 flex-none text-faint hover:bg-transparent"
        :title="collapsed(node) ? t('wiki.tree.expand') : t('wiki.tree.collapse')"
        :aria-label="collapsed(node) ? t('wiki.tree.expand') : t('wiki.tree.collapse')"
        @click.stop="emit('toggle', node)"
      >
        <Icon :name="collapsed(node) ? 'chev-right' : 'chev'" class="size-3" />
      </Button>
      <span v-else class="w-3.5 flex-none" />

      <Icon :name="node.page ? 'file' : 'folder'" class="size-3 flex-none text-faint" />
      <span class="min-w-0 flex-1 truncate">{{ node.title }}</span>
      <Badge
        v-if="node.depth === 0 && node.source === 'project'"
        variant="outline"
        class="border-primary/40 bg-primary/10 px-1.5 py-0 text-primary"
      >
        {{ t('wiki.tier.project') }}
      </Badge>

      <Icon
        v-if="node.page && !node.page.context"
        name="eye-off"
        class="size-3 flex-none text-faint"
        :title="t('wiki.page.hiddenFromLlm')"
      />
      <span
        v-if="node.children.length > 0"
        class="min-w-4.5 text-right text-sm text-faint tabular-nums"
      >
        {{ node.pageCount }}
      </span>
      <!-- Nút thêm trang con ẩn tới khi hover hàng — kiểu Notion, cây sâu không thành
           bức tường nút. -->
      <Button
        variant="ghost"
        size="iconSm"
        class="size-4 flex-none text-faint opacity-0 transition-opacity group-hover/wtn:opacity-100 hover:bg-transparent hover:text-foreground"
        :title="t('wiki.tree.newChild')"
        :aria-label="t('wiki.tree.newChild')"
        @click.stop="emit('new-child', node)"
      >
        <Icon name="plus" class="size-3" />
      </Button>
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
import Badge from '~/components/ui/badge/Badge.vue'
import Button from '~/components/ui/button/Button.vue'

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
