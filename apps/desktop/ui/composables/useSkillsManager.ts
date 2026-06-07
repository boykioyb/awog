import type { CSSProperties } from 'vue'
import { Edit3, Trash2 } from 'lucide-vue-next'
import type { Project, Skill, SkillSource } from '~/types'
import type { SkillScanReport } from '~/stores/workspace'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

// A run of skills sharing a project (or the trailing user/global tiers). The
// list groups by project so it is obvious which project each skill comes from
// — mirrors the Sessions list grouping.
export type SkillGroup = {
  key: string
  label: string
  skills: Skill[]
}

// Trailing group for tiers not tied to a project (global, user-claude,
// user-agents). Underscore prefix avoids colliding with a real project id.
const USER_GROUP_KEY = '_user'

// All Skills-page state + actions. The page (pages/skills/index.vue) stays a
// thin template that binds to this. Toasts come from the shared useToasts().
export function useSkillsManager() {
  const { t } = useTheme()
  const ws = useWorkspaceStore()
  const { toasts, pushToast, toastStyle } = useToasts()

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

  // Group filtered skills by project (project-claude / project-agents carry a
  // projectId); user-level + global tiers fall into one trailing group. Project
  // groups come first in store order, empty groups are dropped.
  const grouped = computed<SkillGroup[]>(() => {
    const map = new Map<string, SkillGroup>()
    ws.projects.forEach((p: Project) => map.set(p.id, { key: p.id, label: p.name, skills: [] }))
    map.set(USER_GROUP_KEY, { key: USER_GROUP_KEY, label: 'User & Global', skills: [] })
    filtered.value.forEach((s: Skill) => {
      const target = s.projectId ? map.get(s.projectId) : map.get(USER_GROUP_KEY)
      ;(target ?? map.get(USER_GROUP_KEY))?.skills.push(s)
    })
    return Array.from(map.values()).filter((g: SkillGroup) => g.skills.length > 0)
  })

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

  // Quiet tag: muted bg for all; project-scoped gets accent text + border instead
  // of a loud solid fill so the list reads calmer.
  const sourceBadgeStyle = (s: Skill): CSSProperties => {
    const highlight = isProjectSkill(s)
    return {
      background: t.value.bgInput,
      color: highlight ? t.value.accent : t.value.textDim,
      border: `1px solid ${highlight ? t.value.accent : t.value.border}`,
    }
  }

  const refreshing = ref(false)

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
    // Silent on entry — the scan-report toast was noisy on every visit. The
    // manual Refresh button still reports (which tiers scanned, counts); load
    // errors still toast via the catch block.
    refresh({ silent: true })
  })

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

  return {
    // list + selection
    skillKey,
    searchQuery,
    filtered,
    grouped,
    selectedKey,
    selectedSkill,
    mobilePane,
    editing,
    refreshing,
    refreshTitle,
    sidebarRef,
    anchor,
    sourceLabel,
    sourceBadgeStyle,
    onSelect,
    onNew,
    onRefresh,
    onBack,
    onCancel,
    // create / edit
    showPromptModal,
    onClosePromptModal,
    onSave,
    bodyEditing,
    bodyEditAnchor,
    onEditBody,
    onApplyBodyEdit,
    // single delete
    pendingDelete,
    deleteDescription,
    askDelete,
    confirmDelete,
    // bulk select + delete
    bulkSelection,
    bulkPendingDelete,
    bulkDeleting,
    bulkDeleteDescription,
    allFilteredSelected,
    someFilteredSelected,
    toggleBulk,
    clearBulk,
    toggleSelectAllFiltered,
    askBulkDelete,
    confirmBulkDelete,
    // context menu + rename
    contextMenu,
    menuItems,
    renamingKey,
    renameValue,
    setRenameInputRef,
    onContextMenu,
    openMenuFromButton,
    startRename,
    commitRename,
    cancelRename,
    // toasts
    toasts,
    toastStyle,
  }
}
