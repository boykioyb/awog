<template>
  <MasterDetailShell
    :mobile-pane="mobilePane"
    :selected-id="editing && !selectedKey ? '_creating' : selectedKey"
    list-width="20rem"
    @update:mobile-pane="onBack"
  >
    <template #list>
      <SkillsListSidebar
        ref="sidebarRef"
        :skills="filtered"
        :selected-key="selectedKey"
        :bulk-selection="bulkSelection"
        :renaming-key="renamingKey"
        :rename-value="renameValue"
        :refreshing="refreshing"
        :refresh-title="refreshTitle"
        :search-query="searchQuery"
        :all-filtered-selected="allFilteredSelected"
        :some-filtered-selected="someFilteredSelected"
        :skill-key="skillKey"
        :agent-count-for="agentCountFor"
        :source-label="sourceLabel"
        :source-badge-style="sourceBadgeStyle"
        @update:search-query="(v: string) => (searchQuery = v)"
        @refresh="onRefresh"
        @new="onNew"
        @toggle-select-all="toggleSelectAllFiltered"
        @clear-bulk="clearBulk"
        @select="onSelect"
        @context-menu="onContextMenu"
        @toggle-bulk="toggleBulk"
        @start-rename="startRename"
        @update:rename-value="(v: string) => (renameValue = v)"
        @commit-rename="commitRename"
        @cancel-rename="cancelRename"
        @open-menu="openMenuFromButton"
        @rename-input-mounted="setRenameInputRef"
      />
    </template>

    <template #detail>
      <SkillEditor
        v-if="editing"
        :skill="selectedSkill ?? null"
        @save="onSave"
        @cancel="onCancel"
      />
      <SkillDetail
        v-else-if="selectedSkill"
        :skill="selectedSkill"
        @edit="editing = true"
        @edit-body="onEditBody"
        @delete="askDelete"
      />
    </template>

    <template #empty-detail>
      <EmptyView :icon="Wand2" title="Select a skill" />
    </template>
  </MasterDetailShell>

  <SkillPromptCreator v-if="showPromptModal" :anchor="anchor" @close="onClosePromptModal" />

  <SkillBodyEditModal
    v-if="bodyEditing && selectedSkill"
    :skill="selectedSkill"
    :anchor="bodyEditAnchor"
    @apply="onApplyBodyEdit"
    @cancel="bodyEditing = false"
  />

  <ConfirmDeleteModal
    v-if="pendingDelete"
    title="Delete skill?"
    :description="deleteDescription"
    @confirm="confirmDelete"
    @cancel="pendingDelete = null"
  />

  <ConfirmDeleteModal
    v-if="bulkPendingDelete"
    :title="`Delete ${bulkPendingDelete.length} skills?`"
    :description="bulkDeleteDescription"
    @confirm="confirmBulkDelete"
    @cancel="bulkPendingDelete = null"
  />

  <SkillsBulkActionBar
    v-if="bulkSelection.size > 0"
    :count="bulkSelection.size"
    :deleting="bulkDeleting"
    @cancel="clearBulk"
    @delete="askBulkDelete"
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
      class="px-3 py-2 rounded text-xs shadow-lg"
      :style="toastStyle(toast.kind)"
    >
      {{ toast.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { Wand2, Edit3, Trash2 } from 'lucide-vue-next'
import type { Agent, Skill, SkillSource } from '~/types'
import type { SkillScanReport } from '~/stores/workspace'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

const { t } = useTheme()
const ws = useWorkspaceStore()

const skillKey = (s: Pick<Skill, 'id' | 'source' | 'projectId'>): string =>
  `${s.source}|${s.projectId ?? ''}|${s.id}`

const SOURCE_LABEL: Record<SkillSource, string> = {
  global: '~/.awog',
  'user-claude': '~/.claude',
  'user-agents': '~/.agents',
  'project-claude': '.claude',
  'project-agents': '.agents',
}

const sourceLabel = (s: Skill): string => SOURCE_LABEL[s.source]

const isProjectSkill = (s: Skill): boolean =>
  s.source === 'project-claude' || s.source === 'project-agents'

const searchQuery = ref('')
const editing = ref(false)
const bodyEditing = ref(false)
const bodyEditAnchor = ref<{ top: number; left: number } | null>(null)

// Bulk selection state — Set of composite skillKey() strings. Independent of
// `selectedKey` (single-item navigation) so a user can keep their detail-pane
// selection while ticking other rows.
const bulkSelection = ref<Set<string>>(new Set())
const bulkPendingDelete = ref<Skill[] | null>(null)
const bulkDeleting = ref(false)

const toggleBulk = (s: Skill) => {
  const key = skillKey(s)
  const next = new Set(bulkSelection.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  bulkSelection.value = next
}

const clearBulk = () => {
  bulkSelection.value = new Set()
}

const selectedKey = ref<string | null>(ws.skills[0] ? skillKey(ws.skills[0]) : null)
const mobilePane = ref<'list' | 'detail'>('list')
const pendingDelete = ref<Skill | null>(null)
const showPromptModal = ref(false)
const sidebarRef = ref<{ newButtonRef: HTMLButtonElement | null } | null>(null)
const anchor = ref<{ top: number; left: number } | null>(null)

const selectedSkill = computed<Skill | undefined>(() =>
  ws.skills.find((s: Skill) => skillKey(s) === selectedKey.value),
)

const filtered = computed<Skill[]>(() =>
  ws.skills.filter((s: Skill) => {
    if (!searchQuery.value) return true
    const q = searchQuery.value.toLowerCase()
    return (
      s.id.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    )
  }),
)

const allFilteredSelected = computed(() => {
  if (filtered.value.length === 0) return false
  return filtered.value.every((s: Skill) => bulkSelection.value.has(skillKey(s)))
})

const someFilteredSelected = computed(() =>
  filtered.value.some((s: Skill) => bulkSelection.value.has(skillKey(s))),
)

const toggleSelectAllFiltered = () => {
  const next = new Set(bulkSelection.value)
  if (allFilteredSelected.value) {
    // Drop only the visible/filtered keys; preserve any selection on hidden
    // rows so search-filter doesn't silently lose ticks.
    filtered.value.forEach((s: Skill) => next.delete(skillKey(s)))
  } else {
    filtered.value.forEach((s: Skill) => next.add(skillKey(s)))
  }
  bulkSelection.value = next
}

const bulkSelectedSkills = computed<Skill[]>(() =>
  ws.skills.filter((s: Skill) => bulkSelection.value.has(skillKey(s))),
)

const sourceBadgeStyle = (s: Skill): CSSProperties => {
  const highlight = isProjectSkill(s)
  return {
    background: highlight ? t.value.accent : t.value.bgInput,
    color: highlight ? t.value.accentText : t.value.textDim,
    border: `1px solid ${highlight ? t.value.accent : t.value.border}`,
  }
}

const refreshing = ref(false)
type ToastKind = 'info' | 'success' | 'error'
const toasts = ref<{ id: string; text: string; kind: ToastKind }[]>([])

const pushToast = (text: string, kind: ToastKind = 'info') => {
  const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  toasts.value = [...toasts.value, { id, text, kind }]
  setTimeout(() => {
    toasts.value = toasts.value.filter((tt: { id: string }) => tt.id !== id)
  }, 3200)
}

const toastStyle = (kind: ToastKind): CSSProperties => {
  if (kind === 'success') {
    return {
      background: t.value.infoBg,
      color: t.value.info,
      border: `1px solid ${t.value.infoBorder}`,
    }
  }
  if (kind === 'error') {
    return {
      background: t.value.dangerBg,
      color: t.value.danger,
      border: `1px solid ${t.value.dangerBorder}`,
    }
  }
  return {
    background: t.value.bgPanel,
    color: t.value.text,
    border: `1px solid ${t.value.border}`,
  }
}

const refreshTitle = computed(() => {
  const projectCount = ws.projects.length
  const scope = projectCount > 0 ? `${projectCount} project(s) + user dirs` : 'user dirs only'
  return `Refresh skills from filesystem (${scope})`
})

const sleep = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms)
  })

const refresh = async (opts: { silent?: boolean } = {}) => {
  if (refreshing.value) return
  refreshing.value = true
  const before = ws.skills.length
  try {
    // Make sure projects are loaded first so the skill list can scan every
    // registered project's .claude/skills + .agents/skills (a fresh /skills
    // reload otherwise sees user-level dirs only).
    await ws.hydrateProjectsFromSidecar()
    // Run hydrate and a min-duration sleep in parallel so the spinner is at
    // least visible for one beat — local-mode hydrate is otherwise instant.
    await Promise.all([ws.hydrateSkillsFromSidecar(), sleep(450)])
    if (!selectedKey.value && ws.skills[0]) selectedKey.value = skillKey(ws.skills[0])
    if (!opts.silent) {
      const after = ws.skills.length
      const delta = after - before
      const sidecar = useSidecar()
      // Use the resolved paths the sidecar actually scanned (lets us diagnose
      // homedir mismatch — what the UI THINKS the path is vs what node sees).
      const reportText =
        ws.skillScanReports.length > 0
          ? ws.skillScanReports.map((r: SkillScanReport) => `${r.dir} (${r.found})`).join(' · ')
          : 'no scan report'
      if (!sidecar.available) {
        pushToast('Sidecar offline — showing cached skills only', 'info')
      } else if (delta > 0) {
        pushToast(`Loaded ${after} skills (+${delta} new) · ${reportText}`, 'success')
      } else if (delta < 0) {
        pushToast(`Loaded ${after} skills (${delta} removed) · ${reportText}`, 'info')
      } else if (after === 0) {
        pushToast(
          `No skills found. Sidecar scanned: ${reportText}. If a path is wrong, check sidecar HOME.`,
          'info',
        )
      } else {
        pushToast(`No changes · ${after} skills · ${reportText}`, 'info')
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[skills] refresh failed', err)
    pushToast('Refresh failed — see console', 'error')
  } finally {
    refreshing.value = false
  }
}

const onRefresh = () => {
  refresh()
}

onMounted(() => {
  // Initial load is NON-silent so the toast confirms which tiers got scanned
  // and how many skills came back — surfaces "sidecar still on old code" and
  // "user dirs are empty" cases that would otherwise look like a silent blank
  // list.
  refresh()
})

const agentCountFor = (skillId: string): number =>
  ws.agents.filter((a: Agent) => a.skillIds.includes(skillId)).length

const WHERE_BY_SOURCE: Record<SkillSource, string> = {
  global: '~/.awog/skills/',
  'user-claude': '~/.claude/skills/',
  'user-agents': '~/.agents/skills/',
  'project-claude': '.claude/skills/',
  'project-agents': '.agents/skills/',
}

const whereFor = (source: SkillSource): string => WHERE_BY_SOURCE[source]

const deleteDescription = computed(() => {
  const s = pendingDelete.value
  if (!s) return ''
  const where = whereFor(s.source)
  return `This will permanently delete the skill "${s.name}" from ${where}${s.id}/. Agents using it will lose this skill.`
})

const bulkDeleteDescription = computed(() => {
  const list = bulkPendingDelete.value
  if (!list || list.length === 0) return ''
  const sample = list
    .slice(0, 5)
    .map((s: Skill) => `${whereFor(s.source)}${s.id}`)
    .join('\n')
  const more = list.length > 5 ? `\n…and ${list.length - 5} more` : ''
  return `This will permanently delete ${list.length} skill folder(s):\n\n${sample}${more}\n\nAgents using any of these will lose them.`
})

const onSelect = (s: Skill) => {
  selectedKey.value = skillKey(s)
  editing.value = false
  mobilePane.value = 'detail'
}

const onNew = () => {
  editing.value = false
  const rect = sidebarRef.value?.newButtonRef?.getBoundingClientRect()
  anchor.value = rect ? { top: rect.bottom + 8, left: rect.left } : null
  showPromptModal.value = true
}

const onClosePromptModal = async () => {
  showPromptModal.value = false
  // The LLM may have written a SKILL.md to disk during the conversation. Pull
  // fresh state so any newly-created skill shows up + becomes selectable.
  // refresh() already toasts on its own (success/no-changes/etc) — no extra
  // notification needed here.
  await refresh()
}

const onEditBody = (at: { top: number; left: number } | null) => {
  bodyEditAnchor.value = at
  bodyEditing.value = true
}

const onApplyBodyEdit = async (updated: Skill) => {
  try {
    const saved = await ws.saveSkill(updated)
    selectedKey.value = skillKey(saved)
    pushToast('Skill updated', 'success')
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[skills] body edit save failed', err)
    pushToast('Failed to save edit — see console', 'error')
    return
  }
  bodyEditing.value = false
}

const onSave = async (payload: { skill: Skill; previousId?: string } | Skill) => {
  // SkillPromptCreator emits a bare Skill draft; SkillEditor emits a payload
  // with the optional previousId for slug renames.
  const data = 'skill' in payload ? payload.skill : payload
  const previousId = 'skill' in payload ? payload.previousId : undefined
  const isRename = previousId && previousId !== data.id
  try {
    const saved = await ws.saveSkill(data, previousId)
    selectedKey.value = skillKey(saved)
    pushToast(isRename ? `Renamed to /${saved.id}` : `Saved /${saved.id}`, 'success')
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[skills] save failed', err)
    pushToast(`Save failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    return
  }
  editing.value = false
  showPromptModal.value = false
  mobilePane.value = 'detail'
}

const onCancel = () => {
  editing.value = false
  if (!selectedSkill.value && ws.skills[0]) {
    selectedKey.value = skillKey(ws.skills[0])
  }
}

const onBack = () => {
  mobilePane.value = 'list'
  editing.value = false
}

const askDelete = () => {
  if (selectedSkill.value) pendingDelete.value = selectedSkill.value
}

const confirmDelete = async () => {
  const s = pendingDelete.value
  if (!s) return
  const wasSelectedKey = selectedKey.value
  pendingDelete.value = null
  try {
    await ws.deleteSkill(s.id, s.source, s.projectId)
    if (wasSelectedKey === skillKey(s)) {
      selectedKey.value = ws.skills[0] ? skillKey(ws.skills[0]) : null
    }
    pushToast(`Deleted /${s.id}`, 'success')
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[skills] delete failed', err)
    pushToast(`Delete failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
  }
}

const askBulkDelete = () => {
  if (bulkSelection.value.size === 0) return
  bulkPendingDelete.value = [...bulkSelectedSkills.value]
}

const confirmBulkDelete = async () => {
  const list = bulkPendingDelete.value
  if (!list || list.length === 0) return
  bulkPendingDelete.value = null
  bulkDeleting.value = true
  const wasSelectedKey = selectedKey.value
  let ok = 0
  const failures: { skill: Skill; err: unknown }[] = []
  // Sequential delete — sidecar RPC is single-threaded per request anyway and
  // it makes the per-skill failure attribution clean.
  await list.reduce<Promise<void>>(async (prev: Promise<void>, s: Skill) => {
    await prev
    try {
      await ws.deleteSkill(s.id, s.source, s.projectId)
      ok += 1
      bulkSelection.value.delete(skillKey(s))
    } catch (err) {
      failures.push({ skill: s, err })
    }
  }, Promise.resolve())
  // Reassign to trigger reactivity (Set mutation isn't reactive in Pinia ref).
  bulkSelection.value = new Set(bulkSelection.value)
  if (wasSelectedKey && !ws.skills.some((s: Skill) => skillKey(s) === wasSelectedKey)) {
    selectedKey.value = ws.skills[0] ? skillKey(ws.skills[0]) : null
  }
  bulkDeleting.value = false
  if (failures.length === 0) {
    pushToast(`Deleted ${ok} skill${ok === 1 ? '' : 's'}`, 'success')
  } else if (ok === 0) {
    pushToast(`Bulk delete failed for ${failures.length} skill(s) — see console`, 'error')
  } else {
    pushToast(`Deleted ${ok}, failed ${failures.length} — see console for failed items`, 'info')
  }
  if (failures.length > 0) {
    // eslint-disable-next-line no-console
    console.error('[skills] bulk delete failures', failures)
  }
}

const contextMenu = ref<{ x: number; y: number; skill: Skill } | null>(null)
const renamingKey = ref<string | null>(null)
const renamingSkill = ref<Skill | null>(null)
const renameValue = ref('')

const setRenameInputRef = (el: HTMLInputElement | null) => {
  if (el) {
    nextTick(() => {
      el.focus()
      el.select()
    })
  }
}

const onContextMenu = (e: MouseEvent, skill: Skill) => {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, skill }
}

const openMenuFromButton = (e: MouseEvent, skill: Skill) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  contextMenu.value = { x: rect.right, y: rect.bottom + 4, skill }
}

const startRename = (s: Skill) => {
  renamingSkill.value = s
  renamingKey.value = skillKey(s)
  renameValue.value = s.name
}

const commitRename = async () => {
  const target = renamingSkill.value
  if (!target) return
  const trimmed = renameValue.value.trim()
  renamingKey.value = null
  renamingSkill.value = null
  if (!trimmed || trimmed === target.name) return
  try {
    await ws.saveSkill({ ...target, name: trimmed })
    pushToast(`Renamed /${target.id} → "${trimmed}"`, 'success')
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[skills] rename failed', err)
    pushToast(`Rename failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
  }
}

const cancelRename = () => {
  renamingKey.value = null
  renamingSkill.value = null
}

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  return [
    { label: 'Rename', icon: Edit3, action: () => startRename(ctx.skill) },
    {
      label: 'Delete',
      icon: Trash2,
      danger: true,
      action: () => {
        pendingDelete.value = ctx.skill
      },
    },
  ]
})
</script>
