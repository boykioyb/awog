<template>
  <div class="md libwrap">
    <div class="list" style="flex: 0 0 288px">
      <div class="ltop">
        <div class="srch">
          <Icon name="search" style="width: var(--icon-sm); height: var(--icon-sm)" />
          <input v-model="q" :placeholder="placeholder ?? t('common.search')" />
        </div>
        <button
          v-if="groupBy"
          class="iconbtn"
          :title="t('library.filter.tooltip')"
          style="width: 32px; height: 32px; position: relative"
          @click="showFilters = !showFilters"
        >
          <Icon name="filter" style="width: var(--icon-sm); height: var(--icon-sm)" />
          <span v-if="activeFilters" class="fbadge">{{ activeFilters }}</span>
        </button>
        <button
          v-if="groupBy"
          class="iconbtn"
          :title="t('library.foldAll.tooltip')"
          style="width: 32px; height: 32px"
          @click="toggleFoldAll"
        >
          <Icon name="foldv" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          v-if="importKind"
          class="iconbtn"
          :title="t('library.import.tooltip')"
          style="width: 32px; height: 32px"
          @click="importOpen = true"
        >
          <Icon name="download" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          v-if="showNew"
          class="iconbtn"
          :title="t('common.add')"
          style="width: 32px; height: 32px"
          @click="emit('new')"
        >
          <Icon name="plus" />
        </button>
      </div>

      <!-- Filter drawer (grouped lists only) — project tier filter, mirrors Sessions. -->
      <div v-if="groupBy && showFilters" class="sfdrawer">
        <div class="csrow">
          <span class="cslbl">{{ t('library.filter.project') }}</span>
          <div class="csval" style="position: relative" @click.stop="projMenu = !projMenu">
            {{ groupFilter === 'all' ? t('library.filter.all') : filterLabel }}
            <Icon name="chev" style="width: var(--icon-sm); height: var(--icon-sm)" />
            <div
              v-if="projMenu"
              class="smenu"
              style="position: absolute; top: 116%; left: 0; right: 0; z-index: 50"
              @click.stop
            >
              <div class="mi" @click="selectFilter('all')">
                {{ t('library.filter.all') }}
                <Icon
                  v-if="groupFilter === 'all'"
                  name="check"
                  class="ck"
                  style="width: var(--icon-sm); height: var(--icon-sm)"
                />
              </div>
              <div v-for="o in groupOptions" :key="o.key" class="mi" @click="selectFilter(o.key)">
                {{ o.label }}
                <Icon
                  v-if="o.key === groupFilter"
                  name="check"
                  class="ck"
                  style="width: var(--icon-sm); height: var(--icon-sm)"
                />
              </div>
            </div>
          </div>
        </div>
        <span v-if="activeFilters" class="clearf" @click="groupFilter = 'all'">
          {{ t('library.filter.clear') }}
        </span>
      </div>

      <!-- Close the filter dropdown on outside click. -->
      <div
        v-if="projMenu"
        style="position: fixed; inset: 0; z-index: 40"
        @click="projMenu = false"
      />

      <div class="lscroll">
        <!-- Flat list — used when no groupBy is provided. -->
        <template v-if="!groupBy">
          <div
            v-for="it in visible"
            :key="itemKey(it)"
            class="libli"
            :class="{ on: !!selected && itemKey(it) === itemKey(selected) }"
            @click="selectedKey = itemKey(it)"
          >
            <slot name="row" :item="it" />
          </div>
          <div v-if="!filtered.length" class="listempty">{{ t('common.empty.none') }}</div>
        </template>

        <!-- Grouped by project tier — collapsible headers (mirrors the Sessions list). -->
        <template v-else>
          <div
            v-for="grp in groups"
            :key="grp.key"
            class="grp"
            :class="{ col: collapsed[grp.key] }"
            :data-grp="grp.key"
          >
            <div class="grph" @click="toggleGroup(grp.key)">
              <Icon name="chev" class="gchv" />
              <span class="pdot" :style="{ background: grp.dot }" />
              <span class="gnm">{{ grp.label }}</span>
              <span class="gct">{{ grp.items.length }}</span>
              <span
                v-if="showNew"
                class="grpadd"
                :title="t('common.add')"
                @click.stop="emit('new-in-group', grp.key)"
              >
                <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
              </span>
            </div>
            <div class="grpitems">
              <div
                v-for="it in grp.visible"
                :key="itemKey(it)"
                class="libli"
                :class="{ on: !!selected && itemKey(it) === itemKey(selected) }"
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
          <div v-if="!filtered.length" class="listempty">{{ t('common.empty.none') }}</div>
        </template>

        <LoadMoreSentinel
          v-if="!groupBy && hasMore"
          auto
          :remaining="remaining"
          @load="loadMore()"
        />
      </div>
    </div>
    <div class="detail">
      <slot v-if="selected" name="detail" :item="selected" />
      <div v-else class="empty">
        <span class="ei">
          <Icon name="folder" style="width: var(--icon-lg); height: var(--icon-lg)" />
        </span>
        <div class="et">{{ t('common.empty.choose') }}</div>
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

// Shared master-detail shell — a searchable list (.list/.ltop/.lscroll/.libli)
// beside a detail pane (.detail). Pages supply per-entity #row and #detail slots
// + an itemKey.
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
const projMenu = ref(false)
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

function selectFilter(key: string): void {
  groupFilter.value = key
  projMenu.value = false
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

const filterLabel = computed(
  () => groupOptions.value.find((o) => o.key === groupFilter.value)?.label ?? groupFilter.value,
)
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
</script>
