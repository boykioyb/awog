import { computed, onMounted, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useProjects } from '~/composables/useProjects'
import { useSidecar } from '~/composables/useSidecar'
import { useToasts } from '~/composables/useToasts'
import { useSettingsStore } from '~/stores/settings'
import { useCommandsStore, type Command } from '~/stores/commands'

// Page-controller for /commands — owns all selection, CRUD, creator, body-edit,
// and delete state so pages/commands.vue stays a thin template. Mirrors the
// reference useSkillsPage, with the command-specific extras: an enable/disable
// toggle and an "edit details" hand-off from the AI creator to the form editor.

// Draft handed off from the AI creator to the manual editor ("Edit details").
export type CommandSeed = {
  name: string
  description: string
  argumentHint: string
  body: string
}

export function useCommandsPage() {
  const store = useCommandsStore()
  const settings = useSettingsStore()
  const sc = useSidecar()
  const { projects } = useProjects()
  const { toasts, pushToast, toastColor } = useToasts()
  const { t } = useI18n()

  // Project list for the scope picker + tier hints (id/name).
  const projectList = computed(() => projects.value.map((p) => ({ id: p.id, name: p.name })))

  // Provider-agnostic creator account (mirrors Sessions' default resolution); the
  // creator panel reads the full object, the body-edit modal only the id. Null id
  // → the panels surface a "connect an account" message.
  const account = computed(() => settings.resolveCreatorAccount())
  const accountId = computed(() => account.value.accountId)

  // --- selection -----------------------------------------------------------
  const selectedKey = ref<string | null>(null)
  const selectedCommand = computed<Command | null>(() => {
    if (selectedKey.value) {
      const hit = store.commandByKey(selectedKey.value)
      if (hit) return hit
    }
    return store.commands[0] ?? null
  })

  const selectCommand = (c: Command) => {
    selectedKey.value = store.commandKey(c)
  }

  // --- hydrate -------------------------------------------------------------
  const refreshing = ref(false)

  const refresh = async (opts: { silent?: boolean } = {}): Promise<void> => {
    if (refreshing.value) return
    refreshing.value = true
    const before = store.commands.length
    try {
      const ids = projectList.value.map((p) => p.id)
      await store.loadCommands(ids)
      if (!opts.silent) {
        const delta = store.commands.length - before
        if (!sc.available) pushToast('Engine offline — showing cached commands', 'info')
        else if (delta > 0)
          pushToast(`Loaded ${store.commands.length} commands (+${delta})`, 'success')
        else pushToast(`Loaded ${store.commands.length} commands`, 'info')
      }
    } catch (err) {
      console.error('[commands] refresh failed', err)
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

  // --- create (AI prompt → draft) ------------------------------------------
  const creatorOpen = ref(false)
  // Initial scope for the creator's tier picker — 'global' or a projectId, set by
  // the per-group "+" so creating inside a project group preselects that tier.
  const creatorScope = ref('global')
  const openCreator = (scope: string = 'global') => {
    creatorScope.value = scope
    creatorOpen.value = true
  }
  const closeCreator = () => {
    creatorOpen.value = false
  }

  // --- edit (form) ---------------------------------------------------------
  const editorOpen = ref(false)
  const editTarget = ref<Command | null>(null)
  // Seed for a fresh editor opened from the creator's "edit details" action.
  const editorSeed = ref<CommandSeed | null>(null)

  const openEditor = (c: Command) => {
    editTarget.value = c
    editorSeed.value = null
    editorOpen.value = true
  }
  const closeEditor = () => {
    editorOpen.value = false
    editTarget.value = null
    editorSeed.value = null
  }
  const onSave = async (command: Command) => {
    const isNew = !editTarget.value
    try {
      const saved = await store.saveCommand(command)
      selectedKey.value = store.commandKey(saved)
      pushToast(isNew ? `Saved /${saved.name}` : `Updated /${saved.name}`, 'success')
    } catch (err) {
      console.error('[commands] save failed', err)
      pushToast(`Save failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
      return
    }
    closeEditor()
  }

  // Hand-off from the AI creator: open the manual editor seeded with the draft.
  const onEditDetails = (seed: CommandSeed) => {
    creatorOpen.value = false
    editTarget.value = null
    editorSeed.value = seed
    editorOpen.value = true
  }

  // Persist directly from the creator (skip the form). Maps the scope picker value
  // ('global' or a projectId) → { source, projectId } before saving.
  const onCreatorSave = async (payload: { seed: CommandSeed; scope: string }) => {
    const isGlobal = payload.scope === 'global'
    const command: Command = {
      id: slugify(payload.seed.name),
      name: payload.seed.name,
      description: payload.seed.description,
      body: payload.seed.body,
      argumentHint: payload.seed.argumentHint || undefined,
      enabled: true,
      source: isGlobal ? 'global' : 'project',
    }
    if (!isGlobal) command.projectId = payload.scope
    creatorOpen.value = false
    await onSave(command)
  }

  // --- edit body (LLM) -----------------------------------------------------
  const bodyEditOpen = ref(false)
  const bodyEditTarget = ref<Command | null>(null)
  const openBodyEdit = (c: Command) => {
    bodyEditTarget.value = c
    bodyEditOpen.value = true
  }
  const closeBodyEdit = () => {
    bodyEditOpen.value = false
    bodyEditTarget.value = null
  }
  const onApplyBodyEdit = async (updated: Command) => {
    try {
      const saved = await store.saveCommand(updated)
      selectedKey.value = store.commandKey(saved)
      pushToast('Command updated', 'success')
    } catch (err) {
      console.error('[commands] body edit save failed', err)
      pushToast('Failed to save edit — see console', 'error')
      return
    }
    closeBodyEdit()
  }

  // --- toggle enabled ------------------------------------------------------
  const onToggle = async (c: Command) => {
    try {
      await store.toggleCommand(c.id, c.source ?? 'global', c.projectId)
    } catch (err) {
      console.error('[commands] toggle failed', err)
      pushToast('Toggle failed — see console', 'error')
    }
  }

  // --- duplicate -----------------------------------------------------------
  const onDuplicate = async (c: Command) => {
    try {
      const copy = await store.duplicateCommand(c)
      selectedKey.value = store.commandKey(copy)
      pushToast(`Duplicated to /${copy.name}`, 'success')
    } catch (err) {
      console.error('[commands] duplicate failed', err)
      pushToast(`Duplicate failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    }
  }

  // --- delete --------------------------------------------------------------
  const pendingDelete = ref<Command | null>(null)
  const askDelete = (c: Command) => {
    pendingDelete.value = c
  }
  const cancelDelete = () => {
    pendingDelete.value = null
  }
  const deleteDescription = computed(() => {
    const c = pendingDelete.value
    if (!c) return ''
    const where = (c.source ?? 'global') === 'global' ? '~/.awog/commands/' : '.awog/commands/'
    return `This will permanently delete the command "/${c.name}" from ${where}${c.id}.md.`
  })
  const confirmDelete = async () => {
    const c = pendingDelete.value
    if (!c) return
    const wasKey = store.commandKey(c)
    pendingDelete.value = null
    try {
      await store.deleteCommand(c.id, c.source, c.projectId)
      if (selectedKey.value === wasKey) {
        selectedKey.value = store.commands[0] ? store.commandKey(store.commands[0]) : null
      }
      pushToast(`Deleted /${c.name}`, 'success')
    } catch (err) {
      console.error('[commands] delete failed', err)
      pushToast(`Delete failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    }
  }

  return {
    // store-backed
    commands: computed(() => store.commands),
    commandKey: store.commandKey,
    projectList,
    account,
    accountId,
    // selection
    selectedCommand,
    selectCommand,
    // hydrate
    refreshing,
    refresh,
    // create
    creatorOpen,
    creatorScope,
    openCreator,
    closeCreator,
    onCreatorSave,
    onEditDetails,
    // edit
    editorOpen,
    editTarget,
    editorSeed,
    openEditor,
    closeEditor,
    onSave,
    // body edit
    bodyEditOpen,
    bodyEditTarget,
    openBodyEdit,
    closeBodyEdit,
    onApplyBodyEdit,
    // toggle
    onToggle,
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

// Slug used for the on-disk filename + the `/name` invoked from the composer.
const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9:]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'new-command'
