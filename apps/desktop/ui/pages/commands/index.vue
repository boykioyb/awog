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
        <SearchInput v-model="searchQuery" class="flex-1" :placeholder="tr('commands.search')" />
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('commands.refresh')"
          :disabled="refreshing"
          @click="onRefresh"
          @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
          @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
        >
          <RotateCw :size="14" :class="refreshing ? 'animate-spin' : ''" />
        </button>
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('commands.new')"
          @click="onNew"
          @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
          @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
        >
          <Plus :size="14" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div
          v-if="filtered.length === 0"
          class="px-4 py-8 text-center text-[1em]"
          :style="{ color: t.textFaint }"
        >
          {{ ws.commands.length === 0 ? tr('commands.empty.none') : tr('commands.empty.no_match') }}
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
              v-for="cmd in group.items"
              :key="commandKey(cmd)"
              class="w-full px-3 py-2 cursor-pointer transition"
              :style="{
                background: pill(selectedKey === commandKey(cmd)).background,
                borderBottom: `1px solid ${t.border}`,
                borderLeft: `2px solid ${selectedKey === commandKey(cmd) ? t.accent : 'transparent'}`,
                opacity: cmd.enabled ? 1 : 0.55,
              }"
              @click="onSelect(cmd)"
              @contextmenu="onContextMenu($event, cmd)"
            >
              <div class="flex items-center gap-2 mb-0.5">
                <Slash :size="11" :style="{ color: t.textDim }" />
                <span class="text-[1em] font-mono flex-1 truncate" :style="{ color: t.text }">
                  /{{ cmd.name }}
                </span>
                <Lock
                  v-if="cmd.readOnly"
                  :size="11"
                  class="flex-shrink-0"
                  :style="{ color: t.textFaint }"
                  :title="tr('common.imported_readonly')"
                />
                <span
                  v-else-if="!cmd.enabled"
                  class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  :style="{ background: t.textFaint }"
                  :title="tr('common.disabled')"
                />
                <button
                  class="p-1 rounded flex-shrink-0 transition opacity-60 hover:opacity-100"
                  :style="{ color: t.textMuted }"
                  :title="tr('common.actions', { name: cmd.name })"
                  @click.stop="openMenuFromButton($event, cmd)"
                >
                  <MoreHorizontal :size="13" />
                </button>
              </div>
              <div class="flex items-center gap-1.5 pl-5">
                <span class="text-[1em] truncate" :style="{ color: t.textDim }">
                  {{ cmd.description || '—' }}
                </span>
                <span
                  v-if="cmd.source && cmd.source !== 'global'"
                  class="text-[12px] px-1 rounded font-mono leading-none flex-shrink-0"
                  :style="sourceBadgeStyle(cmd)"
                  :title="sourceLabel(cmd)"
                >
                  {{ sourceLabel(cmd) }}
                </span>
              </div>
            </div>
          </template>
        </template>
      </div>
    </template>

    <template #detail>
      <CommandEditor
        v-if="mode === 'edit'"
        :command="selected ?? null"
        :initial-draft="manualSeed"
        @save="onSave"
        @cancel="onCancel"
      />
      <CommandDetail
        v-else-if="selected"
        :command="selected"
        @edit="mode = 'edit'"
        @delete="askDelete"
        @edit-body="onEditBody"
      />
    </template>

    <template #empty-detail>
      <EmptyView :icon="Slash" :title="tr('commands.select')" />
    </template>
  </MasterDetailShell>

  <CommandBodyEditModal
    v-if="bodyEditing && selected"
    :command="selected"
    :anchor="bodyEditAnchor"
    @apply="onApplyBodyEdit"
    @cancel="bodyEditing = false"
  />

  <CommandPromptCreator
    v-if="showPromptModal"
    :anchor="anchor"
    @save="onSaveFromCreator"
    @edit-manually="onEditManually"
    @cancel="showPromptModal = false"
  />

  <ConfirmDeleteModal
    v-if="pendingDelete"
    :title="tr('commands.delete.title')"
    :description="tr('commands.delete.description', { name: pendingDelete.name })"
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
import type { CSSProperties } from 'vue'
import {
  Plus,
  Slash,
  Edit3,
  Trash2,
  MoreHorizontal,
  RotateCw,
  Lock,
  ChevronDown,
} from 'lucide-vue-next'
import type { Command, CommandScanReport, CommandSource } from '~/types'
import type { CommandDraft } from '~/composables/useCommandGenerator'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

const { t } = useTheme()
const { t: tr } = useI18n()
const { pill } = useGlass()
const ws = useWorkspaceStore()
const { toasts, pushToast, toastStyle } = useToasts()

const commandKey = (c: Command): string => `${c.source ?? 'global'}|${c.projectId ?? ''}|${c.id}`

const SOURCE_KEY: Record<CommandSource, string> = {
  global: 'commands.source.global',
  project: 'commands.source.project',
}
const sourceLabel = (c: Command): string => tr(SOURCE_KEY[c.source ?? 'global'])
const sourceBadgeStyle = (c: Command): CSSProperties => {
  const accent = c.source === 'project'
  return {
    background: t.value.bgInput,
    color: accent ? t.value.accent : t.value.textDim,
    border: `1px solid ${accent ? t.value.accent : t.value.border}`,
  }
}

const searchQuery = ref('')
const mode = ref<'view' | 'edit'>('view')
const selectedKey = ref<string | null>(null)
const bodyEditing = ref(false)
const bodyEditAnchor = ref<{ top: number; left: number } | null>(null)
const showPromptModal = ref(false)
const anchor = ref<{ top: number; left: number } | null>(null)
const manualSeed = ref<CommandDraft | null>(null)
const mobilePane = ref<'list' | 'detail'>('list')
const pendingDelete = ref<Command | null>(null)

const selected = computed<Command | undefined>(() =>
  ws.commands.find((c) => commandKey(c) === selectedKey.value),
)

const filtered = computed<Command[]>(() =>
  ws.commands.filter((c) => {
    if (!searchQuery.value) return true
    const q = searchQuery.value.toLowerCase()
    return (
      c.name.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q)
    )
  }),
)

// Group by project (mirrors Rules/Skills): one section per project + a trailing
// "User & Global" group. Empty groups are dropped.
type CommandGroup = { key: string; label: string; items: Command[] }
const grouped = computed<CommandGroup[]>(() => {
  const map = new Map<string, CommandGroup>()
  ws.projects.forEach((p) => map.set(p.id, { key: p.id, label: p.name, items: [] }))
  map.set('_user', { key: '_user', label: tr('common.user_global'), items: [] })
  filtered.value.forEach((c) => {
    const g = (c.projectId ? map.get(c.projectId) : undefined) ?? map.get('_user')
    g?.items.push(c)
  })
  return Array.from(map.values()).filter((g) => g.items.length > 0)
})

const collapsedGroups = ref<Record<string, boolean>>({})
const groupHover = ref<string | null>(null)
const showHeaders = computed(() => grouped.value.length > 1)
const toggleGroup = (key: string) => {
  collapsedGroups.value = { ...collapsedGroups.value, [key]: !collapsedGroups.value[key] }
}

const onSelect = (cmd: Command) => {
  selectedKey.value = commandKey(cmd)
  mode.value = 'view'
  mobilePane.value = 'detail'
}

// "New" opens the LLM creator (Create with AI); "Edit details" falls through to
// the manual editor seeded with the generated draft.
const onNew = () => {
  manualSeed.value = null
  mode.value = 'view'
  showPromptModal.value = true
}

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9:]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'new-command'

const onSaveFromCreator = (draft: CommandDraft) => {
  showPromptModal.value = false
  onSave({
    id: slugify(draft.name),
    source: 'global',
    name: draft.name,
    description: draft.description,
    argumentHint: draft.argumentHint,
    body: draft.body,
    enabled: true,
  })
}

const onEditManually = (draft: CommandDraft) => {
  manualSeed.value = draft
  showPromptModal.value = false
  selectedKey.value = null
  mode.value = 'edit'
  mobilePane.value = 'detail'
}

const onSave = (data: Command) => {
  ws.saveCommand(data)
  selectedKey.value = commandKey(data)
  manualSeed.value = null
  mode.value = 'view'
  mobilePane.value = 'detail'
}

const onCancel = () => {
  manualSeed.value = null
  mode.value = 'view'
  if (!selected.value) selectedKey.value = ws.commands[0] ? commandKey(ws.commands[0]) : null
}

const onEditBody = (a: { top: number; left: number } | null) => {
  bodyEditAnchor.value = a
  bodyEditing.value = true
}

const onApplyBodyEdit = (updated: Command) => {
  ws.saveCommand(updated)
  selectedKey.value = commandKey(updated)
  bodyEditing.value = false
}

const onBack = () => {
  mobilePane.value = 'list'
  mode.value = 'view'
}

const askDelete = () => {
  if (selected.value) pendingDelete.value = selected.value
}

const confirmDelete = () => {
  const target = pendingDelete.value
  if (!target) return
  ws.deleteCommand(target.id, target.source, target.projectId)
  if (selectedKey.value === commandKey(target)) {
    selectedKey.value = ws.commands[0] ? commandKey(ws.commands[0]) : null
  }
  pendingDelete.value = null
}

const contextMenu = ref<{ x: number; y: number; command: Command } | null>(null)

const onContextMenu = (e: MouseEvent, command: Command) => {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, command }
}

const openMenuFromButton = (e: MouseEvent, command: Command) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  contextMenu.value = { x: rect.right, y: rect.bottom + 4, command }
}

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const cmd = ctx.command
  const items: ContextMenuItem[] = [
    {
      label: tr('common.edit'),
      icon: Edit3,
      action: () => {
        selectedKey.value = commandKey(cmd)
        mode.value = 'edit'
        mobilePane.value = 'detail'
      },
    },
  ]
  // Imported commands have no enable/disable + delete (identity is the CC file).
  if (!cmd.readOnly) {
    items.push(
      {
        label: cmd.enabled ? tr('common.disable') : tr('common.enable'),
        icon: Slash,
        action: () => ws.toggleCommand(cmd.id),
      },
      {
        label: tr('common.delete'),
        icon: Trash2,
        danger: true,
        action: () => {
          pendingDelete.value = cmd
        },
      },
    )
  }
  return items
})

const refreshing = ref(false)

const sleep = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms)
  })

const refresh = async (opts: { silent?: boolean } = {}) => {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await ws.hydrateProjectsFromSidecar()
    await Promise.all([ws.hydrateCommandsFromSidecar(), sleep(350)])
    if (!selectedKey.value && ws.commands[0]) selectedKey.value = commandKey(ws.commands[0])
    if (!opts.silent) {
      const after = ws.commands.length
      const reportText =
        ws.commandScanReports.length > 0
          ? ws.commandScanReports.map((r: CommandScanReport) => `${r.dir} (${r.found})`).join(' · ')
          : 'no scan report'
      if (!useSidecar().available) {
        pushToast(tr('commands.toast.offline'), 'info')
      } else {
        pushToast(
          tr('commands.toast.loaded', { count: after, report: reportText }),
          after > 0 ? 'success' : 'info',
        )
      }
    }
  } catch (err) {
    console.error('[commands] refresh failed', err)
    pushToast(tr('commands.toast.failed'), 'error')
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
</script>
