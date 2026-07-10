import { computed, onMounted, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useSidecar } from '~/composables/useSidecar'
import { useToasts } from '~/composables/useToasts'
import { useSettingsStore } from '~/stores/settings'
import {
  useConnectionsStore,
  type Source,
  type SourceInput,
  type SourceOAuthResult,
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
  const openEditor = (s: Source) => {
    editTarget.value = s
    editorOpen.value = true
  }
  const openNew = () => {
    editTarget.value = null
    editorOpen.value = true
  }
  const closeEditor = () => {
    editorOpen.value = false
    editTarget.value = null
  }
  const onSave = async (data: SourceInput) => {
    try {
      const saved = await store.saveSource(data)
      selectedSlug.value = saved.slug
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
  // source. Persists the draft, then tests it by slug and returns the outcome.
  const runVerify = async (data: SourceInput): Promise<SourceTestOutcome> => {
    await store.saveSource(data)
    selectedSlug.value = data.slug
    const { outcome } = await store.testSource(data.slug)
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
    // create
    creatorOpen,
    openCreator,
    onCreatorTurn,
    onCreatorClose,
    // edit
    editorOpen,
    editTarget,
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
