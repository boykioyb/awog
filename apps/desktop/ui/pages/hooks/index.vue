<template>
  <MasterDetailShell
    :mobile-pane="mobilePane"
    :selected-id="mode === 'edit' && !selectedKey ? '_creating' : selectedKey"
    list-width="18rem"
    @update:mobile-pane="onBack"
  >
    <template #list>
      <div
        class="px-3 py-3 flex items-center gap-2"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <SearchInput v-model="searchQuery" class="flex-1" :placeholder="tr('hooks.search')" />
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="refreshTitle"
          :disabled="refreshing"
          @click="onRefresh"
          @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
          @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
        >
          <RotateCw :size="14" :class="refreshing ? 'animate-spin' : ''" />
        </button>
        <button
          ref="newButtonRef"
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('hooks.new')"
          @click="onNew"
          @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
          @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
        >
          <Plus :size="14" />
        </button>
      </div>

      <div
        class="px-2 py-2 flex items-center gap-1 overflow-x-auto"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <button
          v-for="cat in eventCategories"
          :key="cat"
          class="px-2 py-0.5 text-[1em] rounded transition flex-shrink-0"
          :style="{
            background: pill(eventFilter === cat).background,
            color: eventFilter === cat ? t.text : t.textDim,
            border: `1px solid ${eventFilter === cat ? t.borderStrong : 'transparent'}`,
          }"
          @click="eventFilter = cat"
        >
          {{ cat === 'all' ? tr('hooks.filter_all') : cat }}
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div
          v-if="filtered.length === 0"
          class="px-4 py-8 text-center text-[1em]"
          :style="{ color: t.textFaint }"
        >
          {{ ws.hooks.length === 0 ? tr('hooks.empty.none') : tr('hooks.empty.no_match') }}
        </div>
        <template v-for="(group, gi) in grouped" :key="group.key">
          <button
            v-if="showHeaders"
            class="w-full px-3 py-1.5 flex items-center gap-1.5 transition"
            :style="{
              color: t.textDim,
              background: groupHover === group.key ? t.bgHover : 'transparent',
              marginTop: gi > 0 ? '4px' : '0',
            }"
            @click="toggleGroup(group.key)"
            @mouseenter="groupHover = group.key"
            @mouseleave="groupHover = null"
          >
            <ChevronDown
              :size="10"
              :style="{
                transform: collapsedGroups[group.key] ? 'rotate(-90deg)' : 'none',
                transition: 'transform 0.15s',
              }"
            />
            <span
              class="text-[12px] uppercase tracking-wider font-semibold flex-1 text-left truncate"
              :style="{ color: t.text }"
            >
              {{ group.label }}
            </span>
            <span class="text-[12px] font-mono leading-none" :style="{ color: t.textFaint }">
              {{ group.items.length }}
            </span>
          </button>
          <template v-if="!showHeaders || !collapsedGroups[group.key]">
            <div
              v-for="hook in group.items"
              :key="`${hook.source ?? 'global'}:${hook.projectId ?? ''}:${hook.id}`"
              class="w-full px-3 py-2 cursor-pointer transition"
              :style="{
                background: pill(selectedKey === hookKey(hook)).background,
                borderBottom: `1px solid ${t.border}`,
                borderLeft: `2px solid ${selectedKey === hookKey(hook) ? t.accent : 'transparent'}`,
                opacity: hook.enabled ? 1 : 0.55,
              }"
              @click="onSelect(hook)"
              @contextmenu="onContextMenu($event, hook)"
            >
              <div class="flex items-center gap-2 mb-0.5">
                <Zap :size="11" :style="{ color: t.textDim }" />
                <input
                  v-if="renamingKey === hookKey(hook)"
                  :ref="setRenameInputRef"
                  v-model="renameValue"
                  class="text-[1em] flex-1 rounded px-1 py-0.5"
                  :style="{
                    background: t.bgInput,
                    border: `1px solid ${t.borderStrong}`,
                    color: t.text,
                    outline: 'none',
                  }"
                  @click.stop
                  @keydown.enter="commitRename"
                  @keydown.escape="cancelRename"
                  @blur="commitRename"
                />
                <span
                  v-else
                  class="text-[1em] flex-1 truncate"
                  :style="{ color: t.text }"
                  @dblclick.stop="startRename(hook)"
                >
                  {{ hook.name }}
                </span>
                <span
                  class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  :style="{ background: lastRunDot(hook) }"
                />
                <Lock
                  v-if="hook.readOnly"
                  :size="11"
                  class="flex-shrink-0"
                  :style="{ color: t.textFaint }"
                  :title="tr('common.imported_readonly')"
                />
                <button
                  v-else
                  class="p-1 rounded flex-shrink-0 transition opacity-60 hover:opacity-100"
                  :style="{ color: t.textMuted }"
                  :title="tr('common.actions', { name: hook.name })"
                  @click.stop="openMenuFromButton($event, hook)"
                >
                  <MoreHorizontal :size="13" />
                </button>
              </div>
              <div class="flex items-center gap-1.5 pl-5">
                <span class="text-[1em] truncate font-mono" :style="{ color: t.textDim }">
                  {{ hook.event }}
                </span>
                <span
                  v-if="hook.source && hook.source !== 'global'"
                  class="text-[12px] px-1 rounded font-mono leading-none flex-shrink-0"
                  :style="{
                    background: t.bgInput,
                    color:
                      hook.trusted === false
                        ? t.warning
                        : isProjectScoped(hook)
                          ? t.accent
                          : t.textDim,
                    border: `1px solid ${
                      hook.trusted === false
                        ? t.warningBorder
                        : isProjectScoped(hook)
                          ? t.accent
                          : t.border
                    }`,
                  }"
                  :title="sourceLabel(hook)"
                >
                  {{ sourceLabel(hook) }}{{ hook.trusted === false ? ' ⚠' : '' }}
                </span>
              </div>
            </div>
          </template>
        </template>
      </div>
    </template>

    <template #detail>
      <HookEditor
        v-if="mode === 'edit'"
        :hook="selected ?? null"
        :initial-draft="manualSeed"
        @save="onSave"
        @cancel="onCancel"
      />
      <HookDetail v-else-if="selected" :hook="selected" @edit="mode = 'edit'" @delete="askDelete" />
    </template>

    <template #empty-detail>
      <EmptyView :icon="Zap" :title="tr('hooks.select')" />
    </template>
  </MasterDetailShell>

  <HookPromptCreator
    v-if="showPromptModal"
    :anchor="anchor"
    :projects="ws.projects"
    @save="onSaveFromCreator"
    @edit-manually="onEditManually"
    @cancel="onCancelPromptModal"
  />

  <ConfirmDeleteModal
    v-if="pendingDelete"
    :title="tr('hooks.delete.title')"
    :description="tr('hooks.delete.description', { name: pendingDelete.name })"
    @confirm="confirmDelete"
    @cancel="pendingDelete = null"
  />

  <ContextMenu
    v-if="contextMenu"
    :x="contextMenu.x"
    :y="contextMenu.y"
    :items="menuItems"
    @close="contextMenu = null"
  />

  <div
    v-if="toasts.length > 0"
    class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-[360px]"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="px-3 py-2 rounded text-[1em] shadow-lg"
      :style="toastStyle(toast.kind)"
    >
      {{ toast.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Plus,
  Zap,
  Edit3,
  Trash2,
  MoreHorizontal,
  RotateCw,
  ChevronDown,
  Lock,
} from 'lucide-vue-next'
import type { Hook, HookScanReport, HookSource } from '~/types'
import type { HookDraft } from '~/composables/useHookGenerator'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

const { t } = useTheme()
const { t: tr } = useI18n()
const { pill } = useGlass()
const ws = useWorkspaceStore()
const { toasts, pushToast, toastStyle } = useToasts()

const HOOK_SOURCE_KEY: Record<HookSource, string> = {
  global: 'hooks.source.global',
  project: 'hooks.source.project',
}
const sourceLabel = (h: Hook): string => tr(HOOK_SOURCE_KEY[h.source ?? 'global'])
const isProjectScoped = (h: Hook): boolean => h.source === 'project'

const refreshing = ref(false)
const refreshTitle = computed(() => tr('hooks.refresh'))

const sleep = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms)
  })

const refresh = async (opts: { silent?: boolean } = {}) => {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await ws.hydrateProjectsFromSidecar()
    await Promise.all([ws.hydrateHooksFromSidecar(), sleep(350)])
    if (!selectedKey.value && ws.hooks[0]) selectedKey.value = hookKey(ws.hooks[0])
    if (!opts.silent) {
      const after = ws.hooks.length
      const reportText =
        ws.hookScanReports.length > 0
          ? ws.hookScanReports.map((r: HookScanReport) => `${r.dir} (${r.found})`).join(' · ')
          : 'no scan report'
      if (!useSidecar().available) {
        pushToast(tr('hooks.toast.offline'), 'info')
      } else {
        pushToast(
          tr('hooks.toast.loaded', { count: after, report: reportText }),
          after > 0 ? 'success' : 'info',
        )
      }
    }
  } catch (err) {
    console.error('[hooks] refresh failed', err)
    pushToast(tr('hooks.toast.failed'), 'error')
  } finally {
    refreshing.value = false
  }
}

const onRefresh = () => {
  refresh()
}

onMounted(() => {
  refresh({ silent: true })
})

const searchQuery = ref('')
const eventFilter = ref<string>('all')
const mode = ref<'view' | 'edit'>('view')
// Composite key (source|projectId|id) so same-id hooks across tiers/projects
// (e.g. imported CC hooks) don't all highlight at once. Mirrors the Rules page.
const hookKey = (h: Hook): string => `${h.source ?? 'global'}|${h.projectId ?? ''}|${h.id}`
const selectedKey = ref<string | null>(ws.hooks[0] ? hookKey(ws.hooks[0]) : null)
const mobilePane = ref<'list' | 'detail'>('list')
const pendingDelete = ref<Hook | null>(null)
const showPromptModal = ref(false)
const newButtonRef = ref<HTMLButtonElement | null>(null)
const anchor = ref<{ top: number; left: number } | null>(null)
const manualSeed = ref<HookDraft | null>(null)

const eventCategories = computed<string[]>(() => {
  const groups = new Set<string>(['all'])
  ws.hooks.forEach((h) => groups.add(h.event.split('.')[0] ?? h.event))
  return Array.from(groups)
})

const selected = computed<Hook | undefined>(() =>
  ws.hooks.find((h) => hookKey(h) === selectedKey.value),
)

const filtered = computed<Hook[]>(() =>
  ws.hooks.filter((h) => {
    if (eventFilter.value !== 'all' && !h.event.startsWith(eventFilter.value)) return false
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      if (!h.name.toLowerCase().includes(q) && !h.event.toLowerCase().includes(q)) return false
    }
    return true
  }),
)

// Group by project (mirrors Skills): one section per project + a trailing
// "User & Global" group for global-tier hooks. Empty groups are dropped.
type HookGroup = { key: string; label: string; items: Hook[] }
const grouped = computed<HookGroup[]>(() => {
  const map = new Map<string, HookGroup>()
  ws.projects.forEach((p) => map.set(p.id, { key: p.id, label: p.name, items: [] }))
  map.set('_user', { key: '_user', label: tr('common.user_global'), items: [] })
  filtered.value.forEach((h) => {
    const g = (h.projectId ? map.get(h.projectId) : undefined) ?? map.get('_user')
    g?.items.push(h)
  })
  return Array.from(map.values()).filter((g) => g.items.length > 0)
})

// Collapse state (mirrors Skills): one group reads as a flat list (no header).
const collapsedGroups = ref<Record<string, boolean>>({})
const groupHover = ref<string | null>(null)
const showHeaders = computed(() => grouped.value.length > 1)
const toggleGroup = (key: string) => {
  collapsedGroups.value = { ...collapsedGroups.value, [key]: !collapsedGroups.value[key] }
}

const lastRunDot = (hook: Hook): string => {
  if (!hook.enabled) return '#404040'
  const last = hook.recentRuns[0]
  if (!last) return '#737373'
  return last.exitCode === 0 ? '#22c55e' : '#ef4444'
}

const onSelect = (hook: Hook) => {
  selectedKey.value = hookKey(hook)
  mode.value = 'view'
  manualSeed.value = null
  mobilePane.value = 'detail'
}

const onNew = () => {
  manualSeed.value = null
  mode.value = 'view'
  const rect = newButtonRef.value?.getBoundingClientRect()
  anchor.value = rect ? { top: rect.bottom + 8, left: rect.left } : null
  showPromptModal.value = true
}

const onEditManually = (draft: HookDraft) => {
  manualSeed.value = draft
  selectedKey.value = null
  showPromptModal.value = false
  mode.value = 'edit'
  mobilePane.value = 'detail'
}

const onSave = (data: Hook) => {
  const isNew = !ws.hooks.some((h) => h.id === data.id)
  const saved = isNew ? { ...data, id: data.id || `hk${Date.now()}` } : data
  ws.saveHook(saved)
  selectedKey.value = hookKey(saved)
  mode.value = 'view'
  manualSeed.value = null
  showPromptModal.value = false
  mobilePane.value = 'detail'
}

// The creator's "Save to" picker → source/projectId before the shared onSave.
const onSaveFromCreator = (hook: Hook, scope: string) => {
  onSave({
    ...hook,
    source: scope === 'global' ? 'global' : 'project',
    ...(scope !== 'global' ? { projectId: scope } : {}),
  })
}

const onCancel = () => {
  mode.value = 'view'
  manualSeed.value = null
  if (!selected.value) selectedKey.value = ws.hooks[0] ? hookKey(ws.hooks[0]) : null
}

const onBack = () => {
  mobilePane.value = 'list'
  mode.value = 'view'
}

const onCancelPromptModal = () => {
  showPromptModal.value = false
}

const askDelete = () => {
  if (selected.value) pendingDelete.value = selected.value
}

const confirmDelete = () => {
  const target = pendingDelete.value
  if (!target) return
  ws.deleteHook(target.id, target.source, target.projectId)
  if (selectedKey.value === hookKey(target)) {
    selectedKey.value = ws.hooks[0] ? hookKey(ws.hooks[0]) : null
  }
  pendingDelete.value = null
}

const contextMenu = ref<{ x: number; y: number; hook: Hook } | null>(null)
const renamingKey = ref<string | null>(null)
const renameValue = ref('')

const setRenameInputRef = (el: unknown) => {
  if (el instanceof HTMLInputElement) {
    nextTick(() => {
      el.focus()
      el.select()
    })
  }
}

const onContextMenu = (e: MouseEvent, hook: Hook) => {
  e.preventDefault()
  if (hook.readOnly) return // imported hooks have no actions
  contextMenu.value = { x: e.clientX, y: e.clientY, hook }
}

const openMenuFromButton = (e: MouseEvent, hook: Hook) => {
  if (hook.readOnly) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  contextMenu.value = { x: rect.right, y: rect.bottom + 4, hook }
}

const startRename = (hook: Hook) => {
  if (hook.readOnly) return
  renamingKey.value = hookKey(hook)
  renameValue.value = hook.name
}

const commitRename = () => {
  const key = renamingKey.value
  if (!key) return
  const trimmed = renameValue.value.trim()
  const item = ws.hooks.find((h) => hookKey(h) === key)
  if (trimmed && item && trimmed !== item.name) {
    ws.saveHook({ ...item, name: trimmed })
  }
  renamingKey.value = null
}

const cancelRename = () => {
  renamingKey.value = null
}

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const item = ctx.hook
  return [
    { label: tr('common.rename'), icon: Edit3, action: () => startRename(item) },
    {
      label: tr('common.delete'),
      icon: Trash2,
      danger: true,
      action: () => {
        pendingDelete.value = item
      },
    },
  ]
})
</script>
