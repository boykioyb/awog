import { computed, onMounted, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useProjects } from '~/composables/useProjects'
import { useSidecar } from '~/composables/useSidecar'
import { useToasts } from '~/composables/useToasts'
import { useSettingsStore } from '~/stores/settings'
import { useSkillsStore, type Skill } from '~/stores/skills'

// Page-controller for /skills — owns all selection, CRUD, creator, and delete
// state so pages/skills.vue stays a thin template. Mirrors the old UI
// useSkillsManager, slimmed to the ui-next surface (no bulk select / rename
// inline — those weren't in the prototype). This is the REFERENCE page-controller
// the sibling features mirror.

export function useSkillsPage() {
  const store = useSkillsStore()
  const settings = useSettingsStore()
  const sc = useSidecar()
  const { projects } = useProjects()
  const { toasts, pushToast, toastColor } = useToasts()
  const { t } = useI18n()

  // Project list for the scope picker + tier hints (id/name/path).
  const projectList = computed(() => projects.value.map((p) => ({ id: p.id, name: p.name })))

  // Provider-agnostic creator account (mirrors Sessions' default resolution); the
  // creator panel reads the full object, the body-edit modal only the id. Null id
  // → the panels surface a "connect an account" message.
  const account = computed(() => settings.resolveCreatorAccount())
  const accountId = computed(() => account.value.accountId)

  // --- selection -----------------------------------------------------------
  const selectedKey = ref<string | null>(null)
  const selectedSkill = computed<Skill | null>(() => {
    if (selectedKey.value) {
      const hit = store.skillByKey(selectedKey.value)
      if (hit) return hit
    }
    return store.skills[0] ?? null
  })

  const selectSkill = (s: Skill) => {
    selectedKey.value = store.skillKey(s)
  }

  // --- hydrate -------------------------------------------------------------
  const refreshing = ref(false)

  const refresh = async (opts: { silent?: boolean } = {}): Promise<void> => {
    if (refreshing.value) return
    refreshing.value = true
    const before = store.skills.length
    try {
      const ids = projectList.value.map((p) => p.id)
      await store.loadSkills(ids)
      if (!opts.silent) {
        const delta = store.skills.length - before
        if (!sc.available) pushToast('Engine offline — showing cached skills', 'info')
        else if (delta > 0) pushToast(`Loaded ${store.skills.length} skills (+${delta})`, 'success')
        else pushToast(`Loaded ${store.skills.length} skills`, 'info')
      }
    } catch (err) {
      console.error('[skills] refresh failed', err)
      pushToast('Refresh failed — see console', 'error')
    } finally {
      refreshing.value = false
    }
  }

  onMounted(() => {
    // Silent on entry — the manual refresh button reports counts.
    void refresh({ silent: true })
  })

  // --- config import (ADR 0035) --------------------------------------------
  // The `.claude`/`.agents` picker copied items into `.awog` — re-scan so the
  // freshly imported tiers show up, then report what landed.
  const onImported = async (n: number): Promise<void> => {
    if (!n) {
      pushToast(t('library.import.none'), 'info')
      return
    }
    await refresh({ silent: true })
    pushToast(t('library.import.done', { n }), 'success')
  }

  // --- create (chat-driven) ------------------------------------------------
  const creatorOpen = ref(false)
  // Initial scope for the creator's tier picker — 'global' or a projectId, set by
  // the per-group "+" so creating inside a project group preselects that tier.
  const creatorScope = ref('global')
  const openCreator = (scope: string = 'global') => {
    creatorScope.value = scope
    creatorOpen.value = true
  }
  const onCreatorTurn = () => {
    // Each turn may have written a SKILL.md — re-hydrate live (store also
    // re-hydrates on fs-changed, but this is immediate).
    void refresh({ silent: true })
  }
  const onCreatorClose = () => {
    creatorOpen.value = false
    void refresh()
  }

  // --- edit (form) ---------------------------------------------------------
  const editorOpen = ref(false)
  const editTarget = ref<Skill | null>(null)
  const openEditor = (s: Skill) => {
    editTarget.value = s
    editorOpen.value = true
  }
  const closeEditor = () => {
    editorOpen.value = false
    editTarget.value = null
  }
  const onSave = async (payload: { skill: Skill; previousId?: string }) => {
    const isRename = payload.previousId && payload.previousId !== payload.skill.id
    try {
      const saved = await store.saveSkill(payload.skill, payload.previousId)
      selectedKey.value = store.skillKey(saved)
      pushToast(isRename ? `Renamed to /${saved.id}` : `Saved /${saved.id}`, 'success')
    } catch (err) {
      console.error('[skills] save failed', err)
      pushToast(`Save failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
      return
    }
    closeEditor()
  }

  // --- edit body (LLM) -----------------------------------------------------
  const bodyEditOpen = ref(false)
  const bodyEditTarget = ref<Skill | null>(null)
  const openBodyEdit = (s: Skill) => {
    bodyEditTarget.value = s
    bodyEditOpen.value = true
  }
  const closeBodyEdit = () => {
    bodyEditOpen.value = false
    bodyEditTarget.value = null
  }
  const onApplyBodyEdit = async (updated: Skill) => {
    try {
      const saved = await store.saveSkill(updated)
      selectedKey.value = store.skillKey(saved)
      pushToast('Skill updated', 'success')
    } catch (err) {
      console.error('[skills] body edit save failed', err)
      pushToast('Failed to save edit — see console', 'error')
      return
    }
    closeBodyEdit()
  }

  // --- duplicate -----------------------------------------------------------
  const onDuplicate = async (s: Skill) => {
    try {
      const copy = await store.duplicateSkill(s)
      selectedKey.value = store.skillKey(copy)
      pushToast(`Duplicated to /${copy.id}`, 'success')
    } catch (err) {
      console.error('[skills] duplicate failed', err)
      pushToast(`Duplicate failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    }
  }

  // --- delete --------------------------------------------------------------
  const pendingDelete = ref<Skill | null>(null)
  const askDelete = (s: Skill) => {
    pendingDelete.value = s
  }
  const cancelDelete = () => {
    pendingDelete.value = null
  }
  const deleteDescription = computed(() => {
    const s = pendingDelete.value
    if (!s) return ''
    const where = s.source === 'global' ? '~/.awog/skills/' : '.awog/skills/'
    return `This will permanently delete the skill "${s.name}" from ${where}${s.id}/. Agents using it will lose this skill.`
  })
  const confirmDelete = async () => {
    const s = pendingDelete.value
    if (!s) return
    const wasKey = store.skillKey(s)
    pendingDelete.value = null
    try {
      await store.deleteSkill(s.id, s.source, s.projectId)
      if (selectedKey.value === wasKey) {
        selectedKey.value = store.skills[0] ? store.skillKey(store.skills[0]) : null
      }
      pushToast(`Deleted /${s.id}`, 'success')
    } catch (err) {
      console.error('[skills] delete failed', err)
      pushToast(`Delete failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    }
  }

  return {
    // store-backed
    skills: computed(() => store.skills),
    skillKey: store.skillKey,
    projectList,
    account,
    accountId,
    // selection
    selectedSkill,
    selectSkill,
    // hydrate
    refreshing,
    refresh,
    // create
    creatorOpen,
    creatorScope,
    openCreator,
    onCreatorTurn,
    onCreatorClose,
    // edit
    editorOpen,
    editTarget,
    openEditor,
    closeEditor,
    onSave,
    // body edit
    bodyEditOpen,
    bodyEditTarget,
    openBodyEdit,
    closeBodyEdit,
    onApplyBodyEdit,
    // duplicate
    onDuplicate,
    // delete
    pendingDelete,
    askDelete,
    cancelDelete,
    deleteDescription,
    confirmDelete,
    // config import
    onImported,
    // toasts
    toasts,
    toastColor,
  }
}
