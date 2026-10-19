<template>
  <aside
    class="flex h-full min-w-50 flex-col overflow-hidden border-r bg-sidebar"
    :style="{ flex: `0 0 ${width}px`, width: `${width}px` }"
  >
    <div class="flex flex-col gap-1.5 p-2">
      <div class="relative">
        <Icon
          name="search"
          class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          class="h-ctrl-sm pr-8 pl-8"
          :model-value="query"
          :placeholder="t('wiki.searchPlaceholder')"
          @keydown.enter="emit('search')"
          @update:model-value="emit('update:query', $event)"
        />
        <Button
          v-if="query"
          variant="ghost"
          size="iconSm"
          class="absolute top-1/2 right-1 size-6 -translate-y-1/2 text-faint"
          :title="t('common.clear')"
          :aria-label="t('common.clear')"
          @click="emit('clear-search')"
        >
          <Icon name="x" class="size-3" />
        </Button>
      </div>
      <!-- Lọc theo tier: toàn bộ / global / từng project — cây và kết quả
           search đều bám filter này (useWikiManager.matchTier). -->
      <AppSelect
        :model-value="tierFilter"
        :options="tierOptions"
        width="100%"
        @update:model-value="(v) => emit('update:tierFilter', v)"
      />
      <div class="flex gap-1.5">
        <Button
          :title="t('wiki.newPage')"
          variant="outline"
          size="sm"
          class="flex-1"
          @click="emit('new-page')"
        >
          <Icon name="plus" class="size-3.5" />
          {{ t('wiki.newPage') }}
        </Button>
        <Button
          :title="t('wiki.newSpace.hint')"
          variant="outline"
          size="sm"
          class="flex-1"
          @click="emit('new-space')"
        >
          <Icon name="folder" class="size-3.5" />
          {{ t('wiki.newSpace.action') }}
        </Button>
        <Button
          :title="t('wiki.import.files')"
          variant="outline"
          size="sm"
          class="flex-1"
          @click="emit('import-files')"
        >
          <Icon name="download" class="size-3.5" />
          {{ t('wiki.import.short') }}
        </Button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-1 pb-2">
      <div v-if="tree.length === 0" class="px-2 py-4 text-base text-faint">
        {{ t('wiki.tree.empty') }}
      </div>

      <WikiTreeNodes
        :nodes="tree"
        :selected-key="selectedKey"
        :is-collapsed="isCollapsed"
        @open="(p) => emit('open', p)"
        @toggle="(n) => emit('toggle-space', n)"
        @new-child="(n) => emit('new-child', n)"
        @context-page="(e, p) => emit('context-page', e, p)"
      />
    </div>

    <div class="border-t px-2 py-1.5 text-sm text-faint">
      {{ t('wiki.footer.budget', { pages: contextPageCount, chars: chars }) }}
    </div>
  </aside>
  <!-- Grip kéo đổi bề rộng (pointer capture), không phải control. -->
  <div
    ref="resizeEl"
    role="separator"
    aria-orientation="vertical"
    class="w-1 flex-none cursor-col-resize bg-transparent transition-colors hover:bg-selected"
    :class="{ 'bg-selected': dragging }"
    @pointerdown="onPointerDown"
  />
</template>

<script setup lang="ts">
// Wiki sidebar: search box, create/import actions, and the space → page tree.
// Presentational only — every action is emitted up to the page controller
// (useWikiManager), which owns the state (nuxt-vue rule: thin components).
import WikiTreeNodes from '~/components/wiki/WikiTreeNodes.vue'
import AppSelect from '~/components/common/AppSelect.vue'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import type { WikiTreeNode } from '~/composables/useWikiManager'
import type { WikiPage } from '~/stores/wiki'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{
  tree: WikiTreeNode[]
  selectedKey: string
  query: string
  isCollapsed: (node: WikiTreeNode) => boolean
  contextPageCount: number
  indexChars: number
  width: number
  // '' = mọi wiki · 'global' · 'project:<id>' — filter của cây + search.
  tierFilter: string
  tierOptions: AppSelectOption[]
}>()

const emit = defineEmits<{
  open: [page: WikiPage]
  'toggle-space': [node: WikiTreeNode]
  'context-page': [event: MouseEvent, page: WikiPage]
  'new-child': [node: WikiTreeNode]
  'update:query': [value: string]
  'update:tierFilter': [value: string]
  search: []
  'clear-search': []
  'new-page': []
  'new-space': []
  'import-files': []
  resize: [width: number]
}>()

const { t } = useI18n()

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
// Rounded to the nearest 100 chars — the point is the order of magnitude the
// index costs per turn, not an exact byte count.
const chars = computed(() =>
  props.indexChars >= 1000 ? `${(props.indexChars / 1000).toFixed(1)}k` : String(props.indexChars),
)
</script>
