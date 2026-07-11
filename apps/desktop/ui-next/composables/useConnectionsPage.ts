import { computed, onMounted, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useSidecar } from '~/composables/useSidecar'
import { useToasts } from '~/composables/useToasts'
import { useSettingsStore } from '~/stores/settings'
import {
  useConnectionsStore,
  type ApiCredentialInput,
  type Source,
  type SourceInput,
  type SourceOAuthResult,
  type SourcePresetMeta,
  type SourceTestOutcome,
} from '~/stores/connections'

// Page-controller for /connections — owns selection, CRUD, creator, and delete
// state so pages/connections.vue stays a thin template. Rewired to the `source.*`
// contract (ADR 0060 P1): sources are keyed by slug; there is no live process, so
// there is no restart / stderr. Testing is save-then-test because `source.test`
// operates on a persisted source (by slug), not an in-memory draft.

export function useConnectionsPage() {
  const store = useConnectionsStore()
  const settings = useSettingsStore()
  const sc = useSidecar()
  const { t } = useI18n()
  const { toasts, pushToast, toastColor } = useToasts()

  // Active Anthropic account drives the chat-driven creator; null → the panel
  // shows a "connect an account" hint and refuses to send.
  const accountId = computed(() => settings.activeAccount('anthropic')?.id ?? null)

  // --- selection -----------------------------------------------------------
  const selectedSlug = ref<string | null>(null)
  const selectedSource = computed<Source | null>(() => {
    if (selectedSlug.value) {
      const hit = store.sourceBySlug(selectedSlug.value)
      if (hit) return hit
    }
    return store.sources[0] ?? null
  })
  const selectSource = (s: Source) => {
    selectedSlug.value = s.slug
  }

  // --- hydrate -------------------------------------------------------------
  const refreshing = ref(false)
  const refresh = async (opts: { silent?: boolean } = {}): Promise<void> => {
    if (refreshing.value) return
    refreshing.value = true
    try {
      await store.loadSources()
      if (!opts.silent) {
        if (!sc.available) pushToast('Engine offline — showing cached connections', 'info')
        else pushToast(`Loaded ${store.sources.length} connections`, 'info')
      }
    } catch (err) {
      console.error('[connections] refresh failed', err)
      pushToast('Refresh failed — see console', 'error')
    } finally {
      refreshing.value = false
    }
  }

  onMounted(() => {
    void refresh({ silent: true })
  })

  // --- add flow (picker → scratch / AI / preset) ---------------------------
  // The LibraryView "+" opens a picker offering three paths (UI-parity area 3):
  // start blank, describe with AI, or pick a catalog provider (→ seed the editor
  // with a pre-filled draft).
  const addPickerOpen = ref(false)
  const presets = ref<SourcePresetMeta[]>([])
  let presetsLoaded = false
  const loadPresets = async (): Promise<void> => {
    try {
      presets.value = await store.listPresets()
      presetsLoaded = true
    } catch (err) {
      console.error('[connections] listPresets failed', err)
    }
  }
  const openAddPicker = () => {
    addPickerOpen.value = true
    if (!presetsLoaded) void loadPresets()
  }
  const closeAddPicker = () => {
    addPickerOpen.value = false
  }
  const startFromScratch = () => {
    addPickerOpen.value = false
    openNew()
  }
  const startFromAi = () => {
    addPickerOpen.value = false
    openCreator()
  }
  // Fetch the pre-filled draft for a chosen provider and open the editor seeded
  // with it (new source: editable slug + generated id). The setupHint is surfaced
  // as a banner in the editor.
  const onPickPreset = async (id: string) => {
    try {
      const res = await store.discoverPreset(id)
      if (!res) return
      seedSource.value = res.preset
      seedSetupHint.value = res.meta.setupHint ?? ''
      editTarget.value = null
      addPickerOpen.value = false
      editorOpen.value = true
    } catch (err) {
      console.error('[connections] discoverPreset failed', err)
      pushToast(
        `Could not load preset: ${err instanceof Error ? err.message : 'see console'}`,
        'error',
      )
    }
  }

  // --- create (chat-driven) ------------------------------------------------
  const creatorOpen = ref(false)
  const openCreator = () => {
    creatorOpen.value = true
  }
  const onCreatorTurn = () => {
    // Each turn may have written a sources/<slug>/config.json — re-hydrate live
    // (store also re-hydrates on sources.fs-changed, but this is immediate).
    void refresh({ silent: true })
  }
  const onCreatorClose = () => {
    creatorOpen.value = false
    void refresh()
  }

  // --- edit (form) ---------------------------------------------------------
  const editorOpen = ref(false)
  const editTarget = ref<Source | null>(null)
  // Preset draft seeding a NEW connection (from the picker) + its setup hint. Both
  // clear whenever the editor opens for edit / scratch so a stale seed never leaks.
  const seedSource = ref<Source | null>(null)
  const seedSetupHint = ref('')
  const openEditor = (s: Source) => {
    editTarget.value = s
    seedSource.value = null
    seedSetupHint.value = ''
    editorOpen.value = true
  }
  const openNew = () => {
    editTarget.value = null
    seedSource.value = null
    seedSetupHint.value = ''
    editorOpen.value = true
  }
  const closeEditor = () => {
    editorOpen.value = false
    editTarget.value = null
    seedSource.value = null
    seedSetupHint.value = ''
  }
  // Save the source config, then (for an `api` source whose credential fields were
  // actually filled) persist the credential to the keychain. The credential is
  // OMITTED when the fields are blank so an empty submit never clobbers a stored
  // one. Keyed by the SAVED source id (stable across slug edits).
  const onSave = async (data: SourceInput, credential?: ApiCredentialInput) => {
    try {
      const saved = await store.saveSource(data)
      selectedSlug.value = saved.slug
      if (credential) await store.setApiCredential({ sourceId: saved.id, ...credential })
      pushToast(`Saved ${saved.slug}`, 'success')
    } catch (err) {
      console.error('[connections] save failed', err)
      pushToast(`Save failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
      return
    }
    closeEditor()
  }

  // --- runtime actions -----------------------------------------------------
  const onToggle = async (s: Source) => {
    try {
      await store.toggleSource(s.slug)
    } catch (err) {
      console.error('[connections] toggle failed', err)
      pushToast(`Toggle failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    }
  }
  const onToggleTool = async (s: Source, toolName: string) => {
    try {
      await store.toggleToolDeny(s.slug, toolName)
    } catch (err) {
      console.error('[connections] toggle tool failed', err)
      pushToast('Tool toggle failed — see console', 'error')
    }
  }

  // Detail Test button — tests the already-persisted source by slug.
  const runTest = (source: Source, done: (outcome: SourceTestOutcome) => void) => {
    void store
      .testSource(source.slug)
      .then(({ outcome }) => done(outcome))
      .catch((err) => {
        done({
          ok: false,
          supported: true,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
      })
  }

  // Editor Verify button — save-first, since `source.test` needs a persisted
  // source. Persists the draft, sets the api credential first (if one was entered,
  // so an authed api source can actually authenticate during the probe), then
  // tests it by slug and returns the outcome.
  const runVerify = async (
    data: SourceInput,
    credential?: ApiCredentialInput,
  ): Promise<SourceTestOutcome> => {
    const saved = await store.saveSource(data)
    selectedSlug.value = saved.slug
    if (credential) await store.setApiCredential({ sourceId: saved.id, ...credential })
    const { outcome } = await store.testSource(saved.slug)
    return outcome
  }

  // --- OAuth (ADR 0060 P2) -------------------------------------------------
  // Detail "Connect with OAuth" — long-lived flow. The store opens the browser
  // (via the source.oauth-url event) and resolves with the outcome. A cancel
  // returns silently (no error toast); success/failure toast + the persisted
  // connectionStatus/connectionError drive the detail pane. `done` clears the
  // component's pending spinner.
  const runOAuth = (source: Source, done: (result: SourceOAuthResult) => void) => {
    void store
      .startOAuth(source.slug)
      .then((result) => {
        if (result.kind === 'connected') {
          pushToast(t('connections.toast.oauthConnected', { slug: source.slug }), 'success')
        } else if (result.kind === 'failed') {
          pushToast(t('connections.toast.oauthFailed', { error: result.error }), 'error')
        }
        // canceled → silent
        done(result)
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[connections] oauth failed', err)
        pushToast(t('connections.toast.oauthError', { error: msg }), 'error')
        done({ kind: 'failed', error: msg })
      })
  }
  const cancelOAuth = (source: Source) => {
    void store.cancelOAuth(source.slug)
  }

  // --- delete --------------------------------------------------------------
  const pendingDelete = ref<Source | null>(null)
  const askDelete = (s: Source) => {
    pendingDelete.value = s
  }
  const cancelDelete = () => {
    pendingDelete.value = null
  }
  const deleteDescription = computed(() => {
    const s = pendingDelete.value
    if (!s) return ''
    return `This will permanently delete the connection "${s.name}" from ~/.awog/sources/${s.slug}/ and purge any keychain secrets it owns. Agents using it will lose access.`
  })
  const confirmDelete = async () => {
    const s = pendingDelete.value
    if (!s) return
    const wasSlug = s.slug
    pendingDelete.value = null
    try {
      await store.deleteSource(s.slug)
      if (selectedSlug.value === wasSlug) {
        selectedSlug.value = store.sources[0]?.slug ?? null
      }
      pushToast(`Deleted ${s.slug}`, 'success')
    } catch (err) {
      console.error('[connections] delete failed', err)
      pushToast(`Delete failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    }
  }

  return {
    // store-backed
    sources: computed(() => store.sources),
    accountId,
    available: computed(() => store.available),
    // selection
    selectedSource,
    selectSource,
    // hydrate
    refreshing,
    refresh,
    // add flow (picker)
    addPickerOpen,
    presets,
    openAddPicker,
    closeAddPicker,
    startFromScratch,
    startFromAi,
    onPickPreset,
    // create
    creatorOpen,
    openCreator,
    onCreatorTurn,
    onCreatorClose,
    // edit
    editorOpen,
    editTarget,
    seedSource,
    seedSetupHint,
    openEditor,
    openNew,
    closeEditor,
    onSave,
    // runtime
    onToggle,
    onToggleTool,
    runTest,
    runVerify,
    // oauth
    runOAuth,
    cancelOAuth,
    // delete
    pendingDelete,
    askDelete,
    cancelDelete,
    deleteDescription,
    confirmDelete,
    // toasts
    toasts,
    toastColor,
  }
}
