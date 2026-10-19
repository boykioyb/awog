<template>
  <!-- `.md` + `.list`: app-shell.css `.app.compact .md/.list` biến cột list thành
       drawer off-canvas (useResponsiveShell). Cột .list chỉ thêm utility KHÔNG đụng
       position/width/transform để drawer compact vẫn thắng. -->
  <!-- hook-ok: `.md` — app-shell.css compact drawer -->
  <div class="md flex min-w-0 flex-1 overflow-hidden">
    <!-- hook-ok: `.list` — app-shell.css compact drawer -->
    <div class="list flex flex-none basis-72 flex-col overflow-hidden border-r bg-sidebar">
      <div class="flex items-center gap-2 border-b p-3">
        <!-- Search: real shadcn Input (bordered, --ctrl-h, focus ring) with the
             icon overlaid inside. -->
        <div class="relative flex-1">
          <Icon
            name="search"
            class="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input v-model="q" class="pl-9" :placeholder="placeholder ?? t('common.search')" />
        </div>
        <Button
          v-if="groupBy"
          :title="t('library.filter.tooltip')"
          :aria-label="t('library.filter.tooltip')"
          class="relative"
          variant="outline"
          size="iconMd"
          @click="showFilters = !showFilters"
        >
          <Icon name="filter" class="size-3.5" />
          <Badge
            v-if="activeFilters"
            class="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 rounded-full px-1 text-xs font-semibold tabular-nums"
          >
            {{ activeFilters }}
          </Badge>
        </Button>
        <Button
          v-if="groupBy"
          :title="t('library.foldAll.tooltip')"
          :aria-label="t('library.foldAll.tooltip')"
          variant="outline"
          size="iconMd"
          @click="toggleFoldAll"
        >
          <Icon name="foldv" class="size-3.5" />
        </Button>
        <Button
          v-if="importKind"
          :title="t('library.import.tooltip')"
          :aria-label="t('library.import.tooltip')"
          variant="outline"
          size="iconMd"
          @click="importOpen = true"
        >
          <Icon name="download" class="size-3.5" />
        </Button>
        <Button
          v-if="showNew"
          :title="t('common.add')"
          :aria-label="t('common.add')"
          variant="outline"
          size="iconMd"
          @click="emit('new')"
        >
          <Icon name="plus" />
        </Button>
      </div>

      <!-- Filter drawer (grouped lists only) — project tier filter, mirrors Sessions. -->
      <div v-if="groupBy && showFilters" class="flex flex-col gap-2 border-b bg-muted p-3 pb-2">
        <div class="flex items-center gap-2.5">
          <span class="w-15.5 flex-none text-sm text-dim">{{ t('library.filter.project') }}</span>
          <div class="min-w-0 flex-1">
            <AppSelect v-model="groupFilter" :options="filterOptions" size="sm" width="100%" />
          </div>
        </div>
        <Button
          v-if="activeFilters"
          variant="link"
          size="xs"
          class="self-start px-0 text-dim hover:text-foreground"
          @click="groupFilter = 'all'"
        >
          {{ t('library.filter.clear') }}
        </Button>
      </div>

      <div class="flex-1 overflow-y-auto px-3 py-2">
        <!-- Flat list — used when no groupBy is provided. -->
        <template v-if="!groupBy">
          <div
            v-for="it in visible"
            :key="itemKey(it)"
            :class="[ROW, isSelected(it) ? ROW_ON : ROW_OFF]"
            @click="selectedKey = itemKey(it)"
          >
            <slot name="row" :item="it" />
          </div>
          <div v-if="!filtered.length" class="px-3.5 py-8 text-center text-sm text-dim">
            {{ t('common.empty.none') }}
          </div>
        </template>

        <!-- Grouped by project tier — collapsible headers (mirrors the Sessions list). -->
        <template v-else>
          <div
            v-for="grp in groups"
            :key="grp.key"
            class="mb-0.5 not-first:mt-3"
            :data-grp="grp.key"
          >
            <!-- Header nhóm dính trên cùng khi cuộn, nền đặc + hairline dưới để đọc
                 như vạch chia nhóm chứ không phải một hàng list. -->
            <!-- raw-ok: cả header nhóm là một vùng bấm thu gọn, chứa nút thêm bên trong -->
            <div
              class="group/grph sticky top-0 z-2 flex cursor-pointer items-center gap-2 border-b bg-sidebar px-2 py-1.5 select-none hover:bg-accent"
              @click="toggleGroup(grp.key)"
            >
              <Icon
                name="chev"
                class="size-3 flex-none text-faint transition-transform"
                :class="{ '-rotate-90': collapsed[grp.key] }"
              />
              <span class="size-2 flex-none rounded-sm" :style="{ background: grp.dot }" />
              <span
                class="text-xs font-semibold text-muted-foreground group-hover/grph:text-foreground"
              >
                {{ grp.label }}
              </span>
              <span class="ml-auto text-xs text-faint tabular-nums">{{ grp.items.length }}</span>
              <Button
                v-if="showNew"
                variant="ghost"
                size="iconSm"
                class="size-5"
                :title="t('common.add')"
                :aria-label="t('common.add')"
                @click.stop="emit('new-in-group', grp.key)"
              >
                <Icon name="plus" class="size-3.5" />
              </Button>
            </div>
            <div v-show="!collapsed[grp.key]" class="pt-1">
              <div
                v-for="it in grp.visible"
                :key="itemKey(it)"
                :class="[ROW, isSelected(it) ? ROW_ON : ROW_OFF]"
                @click="selectedKey = itemKey(it)"
              >
                <slot name="row" :item="it" />
              </div>
              <LoadMoreSentinel
                v-if="grp.hasMore"
                :remaining="grp.remaining"
                @load="groupLoad.loadMore(grp.key)"
              />
            </div>
          </div>
          <div v-if="!filtered.length" class="px-3.5 py-8 text-center text-sm text-dim">
            {{ t('common.empty.none') }}
          </div>
        </template>

        <LoadMoreSentinel
          v-if="!groupBy && hasMore"
          auto
          :remaining="remaining"
          @load="loadMore()"
        />
      </div>
    </div>
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <slot v-if="selected" name="detail" :item="selected" />
      <div
        v-else
        class="flex flex-1 flex-col items-center justify-center gap-3.5 p-10 text-center text-dim"
      >
        <span class="grid size-12 place-items-center rounded-xl border bg-card text-dim">
          <Icon name="folder" class="size-5" />
        </span>
        <div class="text-lg text-muted-foreground">{{ t('common.empty.choose') }}</div>
      </div>
    </div>

    <!-- Config import (ADR 0035): pull this kind out of `.claude`/`.agents` into `.awog`. -->
    <LibraryImportModal
      v-if="importKind"
      :open="importOpen"
      :kind="importKind"
      @close="importOpen = false"
      @imported="onImported"
    />
  </div>
</template>

<script setup lang="ts" generic="T">
import { computed, ref, watch } from 'vue'
import type { GroupWindow } from '~/composables/useLoadMore'
import type { ConfigKind } from '~/stores/templates'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import Badge from '~/components/ui/badge/Badge.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

// Shared master-detail shell — a searchable list beside a detail pane. Pages supply
// per-entity #row and #detail slots + an itemKey.
//
// Optional project grouping: pass `groupBy` (→ a stable group key per item, e.g.
// 'global' or a projectId) and the list renders collapsible group headers with a
// color dot + count + per-group add button — mirroring the Sessions list. Omit
// `groupBy` to keep the flat list (unchanged behaviour for non-tiered features).
const props = defineProps<{
  items: T[]
  itemKey: (it: T) => string
  // Text searched by the filter box; defaults to itemKey when omitted.
  searchText?: (it: T) => string
  placeholder?: string
  showNew?: boolean
  // ── Grouping (optional) ──
  // Stable group key per item (e.g. project tier). When set → grouped render.
  groupBy?: (it: T) => string
  // Display label for a group key (e.g. 'global' → "Global", projectId → name).
  groupLabel?: (key: string) => string
  // Dot color for a group key (defaults to a neutral token).
  groupDot?: (key: string) => string
  // Group sorted first (e.g. the global tier). Defaults to 'global'.
  primaryGroupKey?: string
  // Optional external selection control (additive — internal click still works):
  // when this key CHANGES, the list selects that item. Used to restore a minimized
  // Task PiP (LibraryView otherwise owns selection internally).
  selectKey?: string | null
  // Config kind of the listed entity. When set, the toolbar gains an import
  // button that copies this kind out of `.claude`/`.agents` into `.awog`
  // (ADR 0035). Omit for lists that have no legacy source (Tasks, Connections…).
  importKind?: ConfigKind
}>()

const emit = defineEmits<{
  (e: 'new'): void
  // Per-group add button (only rendered when grouped + showNew).
  (e: 'new-in-group', key: string): void
  // Items were copied into `.awog` — the page re-hydrates its store.
  (e: 'imported', n: number): void
}>()

const { t } = useI18n()

const q = ref('')
const selectedKey = ref<string | null>(null)

// External selection control: adopt `selectKey` whenever it changes to a real key
// (a minimize-dock restore publishes the wanted id here). One-way — internal clicks
// still drive `selectedKey` directly; we never write back to the prop.
watch(
  () => props.selectKey,
  (k) => {
    if (k != null) selectedKey.value = k
  },
)
// Per-group collapse state, keyed by the group key. Default expanded.
const collapsed = ref<Record<string, boolean>>({})
// Filter drawer (grouped lists): show/hide + the active project-tier filter.
const showFilters = ref(false)
const groupFilter = ref<string>('all')
// Config-import picker (only mounted when `importKind` is set).
const importOpen = ref(false)

// Close on a finished import and let the page re-hydrate its store — the fs
// watcher only re-scans tiers already present in the list, so new project-tier
// items would otherwise stay invisible until a manual refresh.
function onImported(n: number): void {
  importOpen.value = false
  emit('imported', n)
}

function toggleGroup(key: string): void {
  collapsed.value[key] = !collapsed.value[key]
}

// Collapse every group if any is open; otherwise expand all (mirrors Sessions).
function toggleFoldAll(): void {
  const keys = groups.value.map((g) => g.key)
  const collapseAll = keys.some((k) => !collapsed.value[k])
  const next: Record<string, boolean> = {}
  for (const k of keys) next[k] = collapseAll
  collapsed.value = next
}

const filtered = computed(() => {
  let list = props.items
  const by = props.groupBy
  // Project-tier filter (grouped lists only).
  if (by && groupFilter.value !== 'all') list = list.filter((it) => by(it) === groupFilter.value)
  const query = q.value.trim().toLowerCase()
  if (!query) return list
  const text = props.searchText ?? props.itemKey
  return list.filter((it) => text(it).toLowerCase().includes(query))
})

// Incremental render windows keep the DOM small on large lists.
//  • Flat (no groupBy): a single bottom window that grows on scroll.
//  • Grouped: each tier/project shows GROUP_PAGE_SIZE rows with its own "load
//    more" button (see the grouped template + `groups`).
// `selected` still resolves against the full `filtered` set, so selecting a
// not-yet-rendered item stays correct.
const { visible, hasMore, remaining, loadMore, reset } = useLoadMore(() => filtered.value)
const groupLoad = useGroupLoadMore()
// Reset to the first page when the query/filter changes (results from the top).
watch([q, groupFilter], () => {
  reset()
  groupLoad.reset()
})

// All group keys present across the items (the filter dropdown's options) —
// derived from the full item set so every tier stays selectable while filtered.
const groupOptions = computed<{ key: string; label: string }[]>(() => {
  const by = props.groupBy
  if (!by) return []
  const keys = new Set<string>()
  for (const it of props.items) keys.add(by(it))
  const primary = props.primaryGroupKey ?? 'global'
  const label = (key: string) => props.groupLabel?.(key) ?? key
  return [...keys]
    .map((key) => ({ key, label: label(key) }))
    .sort((a, b) => {
      if (a.key === primary) return -1
      if (b.key === primary) return 1
      return a.label.localeCompare(b.label)
    })
})

// Lựa chọn cho ô lọc project: "Tất cả" + mọi tier đang có.
const filterOptions = computed<AppSelectOption[]>(() => [
  { value: 'all', label: t('library.filter.all') },
  ...groupOptions.value.map((o) => ({ value: o.key, label: o.label })),
])
const activeFilters = computed(() => (groupFilter.value !== 'all' ? 1 : 0))

// Buckets for the grouped render. Insertion order from `filtered`, then the
// primary group (global tier) floated to the top and the rest sorted by label.
const groups = computed<({ key: string; label: string; dot: string } & GroupWindow<T>)[]>(() => {
  const by = props.groupBy
  if (!by) return []
  const map = new Map<string, T[]>()
  for (const it of filtered.value) {
    const k = by(it)
    const bucket = map.get(k)
    if (bucket) bucket.push(it)
    else map.set(k, [it])
  }
  const primary = props.primaryGroupKey ?? 'global'
  const label = (key: string) => props.groupLabel?.(key) ?? key
  const dot = (key: string) => props.groupDot?.(key) ?? 'var(--textDim)'
  return [...map.entries()]
    .map(([key, items]) => ({
      key,
      label: label(key),
      // Per-group window: first GROUP_PAGE_SIZE rows, rest behind "load more".
      ...groupLoad.windowOf(key, items),
      dot: dot(key),
    }))
    .sort((a, b) => {
      if (a.key === primary) return -1
      if (b.key === primary) return 1
      return a.label.localeCompare(b.label)
    })
})

// Effective selection: the chosen item if still visible, else the first row
// (matches the prototype auto-selecting the top item). Uses the flat filtered
// list so it works the same in grouped and flat modes.
const selected = computed<T | null>(() => {
  const list = filtered.value
  if (!list.length) return null
  return list.find((it) => props.itemKey(it) === selectedKey.value) ?? list[0] ?? null
})

const isSelected = (it: T): boolean =>
  !!selected.value && props.itemKey(it) === props.itemKey(selected.value)

// Hàng list: đang chọn = accent-tint + thanh accent 2px bên trái (nuxt-vue.md).
const ROW = 'mb-0.5 cursor-pointer rounded-md border px-3 py-2'
const ROW_OFF = 'border-transparent hover:bg-accent'
const ROW_ON = 'border-selected-border bg-selected shadow-[inset_2px_0_0_var(--primary)]'
</script>
