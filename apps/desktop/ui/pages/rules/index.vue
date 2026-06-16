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
        <SearchInput v-model="searchQuery" class="flex-1" :placeholder="tr('rules.search')" />
        <AppButton
          variant="ghost"
          size="icon"
          :title="refreshTitle"
          :disabled="refreshing"
          @click="onRefresh"
        >
          <RotateCw :size="14" :class="refreshing ? 'animate-spin' : ''" />
        </AppButton>
        <AppButton variant="ghost" size="icon" :title="tr('rules.new')" @click="onNew">
          <Plus :size="14" />
        </AppButton>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div
          v-if="filtered.length === 0"
          class="px-4 py-8 text-center text-[1em]"
          :style="{ color: t.textFaint }"
        >
          {{ ws.rules.length === 0 ? tr('rules.empty.none') : tr('rules.empty.no_match') }}
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
              v-for="rule in group.items"
              :key="ruleKey(rule)"
              class="w-full px-3 py-2 cursor-pointer transition"
              :style="{
                background: pill(selectedKey === ruleKey(rule)).background,
                borderBottom: `1px solid ${t.border}`,
                borderLeft: `2px solid ${selectedKey === ruleKey(rule) ? t.accent : 'transparent'}`,
                opacity: rule.enabled ? 1 : 0.55,
              }"
              @click="onSelect(rule)"
              @contextmenu="onContextMenu($event, rule)"
            >
              <div class="flex items-center gap-2 mb-0.5">
                <ScrollText :size="11" :style="{ color: t.textDim }" />
                <span class="text-[1em] flex-1 truncate" :style="{ color: t.text }">
                  {{ rule.name }}
                </span>
                <Lock
                  v-if="rule.readOnly"
                  :size="11"
                  class="flex-shrink-0"
                  :style="{ color: t.textFaint }"
                  :title="tr('common.imported_readonly')"
                />
                <span
                  v-else-if="!rule.enabled"
                  class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  :style="{ background: t.textFaint }"
                  :title="tr('common.disabled')"
                />
                <button
                  v-if="!rule.readOnly"
                  class="p-1 rounded flex-shrink-0 transition opacity-60 hover:opacity-100"
                  :style="{ color: t.textMuted }"
                  :title="tr('common.actions', { name: rule.name })"
                  @click.stop="openMenuFromButton($event, rule)"
                >
                  <MoreHorizontal :size="13" />
                </button>
              </div>
              <div class="flex items-center gap-1.5 pl-5">
                <span class="text-[1em] truncate" :style="{ color: t.textDim }">
                  {{ rule.description || '—' }}
                </span>
                <span
                  v-if="rule.source && rule.source !== 'global'"
                  class="text-[12px] px-1 rounded font-mono leading-none flex-shrink-0"
                  :style="sourceBadgeStyle(rule)"
                  :title="sourceLabel(rule)"
                >
                  {{ sourceLabel(rule) }}
                </span>
              </div>
            </div>
          </template>
        </template>
      </div>
    </template>

    <template #detail>
      <RuleEditor
        v-if="mode === 'edit'"
        :rule="selected ?? null"
        :initial-draft="manualSeed"
        @save="onSave"
        @cancel="onCancel"
      />
      <RuleDetail
        v-else-if="selected"
        :rule="selected"
        @edit="mode = 'edit'"
        @delete="askDelete"
        @edit-body="onEditBody"
      />
    </template>

    <template #empty-detail>
      <EmptyView :icon="ScrollText" :title="tr('rules.select')" />
    </template>
  </MasterDetailShell>

  <RuleBodyEditModal
    v-if="bodyEditing && selected"
    :rule="selected"
    :anchor="bodyEditAnchor"
    @apply="onApplyBodyEdit"
    @cancel="bodyEditing = false"
  />

  <RulePromptCreator
    v-if="showPromptModal"
    :projects="ws.projects"
    @save="onSaveFromCreator"
    @edit-manually="onEditManually"
    @cancel="showPromptModal = false"
  />

  <ConfirmDeleteModal
    v-if="pendingDelete"
    :title="tr('rules.delete.title')"
    :description="tr('rules.delete.description', { name: pendingDelete.name })"
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
  ScrollText,
  Edit3,
  Trash2,
  MoreHorizontal,
  RotateCw,
  Lock,
  ChevronDown,
} from 'lucide-vue-next'
import type { Rule, RuleScanReport, RuleSource } from '~/types'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

const { t } = useTheme()
const { t: tr } = useI18n()
const { pill } = useGlass()
const ws = useWorkspaceStore()
const { toasts, pushToast, toastStyle } = useToasts()

const ruleKey = (r: Rule): string => `${r.source ?? 'global'}|${r.projectId ?? ''}|${r.id}`

const SOURCE_KEY: Record<RuleSource, string> = {
  global: 'rules.source.global',
  project: 'rules.source.project',
}
const sourceLabel = (r: Rule): string => tr(SOURCE_KEY[r.source ?? 'global'])
const sourceBadgeStyle = (r: Rule): CSSProperties => {
  // Imported = muted; editable project = accent.
  const accent = r.source === 'project'
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
const manualSeed = ref<RuleDraft | null>(null)
const mobilePane = ref<'list' | 'detail'>('list')
const pendingDelete = ref<Rule | null>(null)

const selected = computed<Rule | undefined>(() =>
  ws.rules.find((r) => ruleKey(r) === selectedKey.value),
)

const filtered = computed<Rule[]>(() =>
  ws.rules.filter((r) => {
    if (!searchQuery.value) return true
    const q = searchQuery.value.toLowerCase()
    return (
      r.name.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q)
    )
  }),
)

// Group by project (mirrors Skills): one section per project + a trailing
// "User & Global" group (global + ~/.claude). Empty groups are dropped.
type RuleGroup = { key: string; label: string; items: Rule[] }
const grouped = computed<RuleGroup[]>(() => {
  const map = new Map<string, RuleGroup>()
  ws.projects.forEach((p) => map.set(p.id, { key: p.id, label: p.name, items: [] }))
  map.set('_user', { key: '_user', label: tr('common.user_global'), items: [] })
  filtered.value.forEach((r) => {
    const g = (r.projectId ? map.get(r.projectId) : undefined) ?? map.get('_user')
    g?.items.push(r)
  })
  return Array.from(map.values()).filter((g) => g.items.length > 0)
})

// Collapse state (mirrors Skills). Always show the project/group header so a
// single-project list still names its owner (badge alone only says "project").
const collapsedGroups = ref<Record<string, boolean>>({})
const groupHover = ref<string | null>(null)
const showHeaders = computed(() => grouped.value.length > 0)
const toggleGroup = (key: string) => {
  collapsedGroups.value = { ...collapsedGroups.value, [key]: !collapsedGroups.value[key] }
}

const onSelect = (rule: Rule) => {
  selectedKey.value = ruleKey(rule)
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
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'new-rule'

const onSaveFromCreator = (draft: RuleDraft, scope: string) => {
  showPromptModal.value = false
  onSave({
    id: slugify(draft.name),
    source: scope === 'global' ? 'global' : 'project',
    ...(scope !== 'global' ? { projectId: scope } : {}),
    name: draft.name,
    description: draft.description,
    body: draft.body,
    enabled: true,
  })
}

const onEditManually = (draft: RuleDraft) => {
  manualSeed.value = draft
  showPromptModal.value = false
  selectedKey.value = null
  mode.value = 'edit'
  mobilePane.value = 'detail'
}

const onSave = (data: Rule) => {
  ws.saveRule(data)
  selectedKey.value = ruleKey(data)
  manualSeed.value = null
  mode.value = 'view'
  mobilePane.value = 'detail'
}

const onCancel = () => {
  manualSeed.value = null
  mode.value = 'view'
  if (!selected.value) selectedKey.value = ws.rules[0] ? ruleKey(ws.rules[0]) : null
}

const onEditBody = (anchor: { top: number; left: number } | null) => {
  bodyEditAnchor.value = anchor
  bodyEditing.value = true
}

const onApplyBodyEdit = (updated: Rule) => {
  ws.saveRule(updated)
  selectedKey.value = ruleKey(updated)
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
  ws.deleteRule(target.id, target.source, target.projectId)
  if (selectedKey.value === ruleKey(target)) {
    selectedKey.value = ws.rules[0] ? ruleKey(ws.rules[0]) : null
  }
  pendingDelete.value = null
}

const contextMenu = ref<{ x: number; y: number; rule: Rule } | null>(null)

const onContextMenu = (e: MouseEvent, rule: Rule) => {
  e.preventDefault()
  if (rule.readOnly) return // imported rules have no actions
  contextMenu.value = { x: e.clientX, y: e.clientY, rule }
}

const openMenuFromButton = (e: MouseEvent, rule: Rule) => {
  if (rule.readOnly) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  contextMenu.value = { x: rect.right, y: rect.bottom + 4, rule }
}

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const rule = ctx.rule
  return [
    {
      label: tr('common.edit'),
      icon: Edit3,
      action: () => {
        selectedKey.value = ruleKey(rule)
        mode.value = 'edit'
        mobilePane.value = 'detail'
      },
    },
    {
      label: rule.enabled ? tr('common.disable') : tr('common.enable'),
      icon: ScrollText,
      action: () => ws.toggleRule(rule.id),
    },
    {
      label: tr('common.delete'),
      icon: Trash2,
      danger: true,
      action: () => {
        pendingDelete.value = rule
      },
    },
  ]
})

const refreshing = ref(false)
const refreshTitle = computed(() => tr('rules.refresh'))

const sleep = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms)
  })

const refresh = async (opts: { silent?: boolean } = {}) => {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await ws.hydrateProjectsFromSidecar()
    await Promise.all([ws.hydrateRulesFromSidecar(), sleep(350)])
    if (!selectedKey.value && ws.rules[0]) selectedKey.value = ruleKey(ws.rules[0])
    if (!opts.silent) {
      const after = ws.rules.length
      const reportText =
        ws.ruleScanReports.length > 0
          ? ws.ruleScanReports.map((r: RuleScanReport) => `${r.dir} (${r.found})`).join(' · ')
          : 'no scan report'
      if (!useSidecar().available) {
        pushToast(tr('rules.toast.offline'), 'info')
      } else {
        pushToast(
          tr('rules.toast.loaded', { count: after, report: reportText }),
          after > 0 ? 'success' : 'info',
        )
      }
    }
  } catch (err) {
    console.error('[rules] refresh failed', err)
    pushToast(tr('rules.toast.failed'), 'error')
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
