import { computed, onMounted, ref } from 'vue'
import { useContextMenu, type MenuItem } from '~/composables/useContextMenu'
import { useI18n } from '~/composables/useI18n'
import { useSessionTaskLink } from '~/composables/useSessionTaskLink'
import { useSshApi } from '~/composables/useSshApi'
import { useToasts } from '~/composables/useToasts'
import { useSessionsStore } from '~/stores/sessions'
import {
  useSshStore,
  type SshConfigCandidate,
  type SshCredentialInput,
  type SshHost,
  type SshIdentity,
} from '~/stores/ssh'

// Page-controller for /ssh — owns the add/edit/import/delete flows, the identity
// sub-editor, the per-row context menu, and toasts so pages/ssh.vue stays a thin
// template. Selection is owned by LibraryView (no selectedSlug here). Scope is P1:
// host/identity CRUD + import; Connect/SFTP/Forward are placeholders that toast a
// "coming later" note (no engine call yet, ADR 0063).

// The host editor emits only the raw secret value (host password); the page keys
// it by the SAVED host id before calling `ssh.setCredential`.
export type SshHostSecret = { password: string }
// The identity editor emits its raw secret parts; the page maps them to the
// keychain mode ('inline-key' when a key was pasted, else 'passphrase').
export type SshIdentitySecret = { passphrase?: string; privateKey?: string }

type PendingDelete = { kind: 'host'; host: SshHost } | { kind: 'identity'; identity: SshIdentity }

export function useSshPage() {
  const store = useSshStore()
  const sshApi = useSshApi()
  const { t } = useI18n()
  const { toasts, pushToast, toastColor } = useToasts()

  // External selection control for LibraryView — set after a save so the new /
  // edited host is auto-selected.
  const selectKey = ref<string | null>(null)

  // --- host editor -----------------------------------------------------------
  const editorOpen = ref(false)
  const editTarget = ref<SshHost | null>(null)
  // Folder pre-seeded when adding within a group header (kept for the new host).
  const seedFolder = ref<string>('')

  const openNew = () => {
    editTarget.value = null
    seedFolder.value = ''
    editorOpen.value = true
  }
  const openNewInGroup = (folder: string) => {
    editTarget.value = null
    seedFolder.value = folder === 'ungrouped' ? '' : folder
    editorOpen.value = true
  }
  const openEditor = (h: SshHost) => {
    editTarget.value = h
    seedFolder.value = ''
    editorOpen.value = true
  }
  const closeEditor = () => {
    editorOpen.value = false
    editTarget.value = null
    seedFolder.value = ''
  }

  // Save the host, then (only when a password was actually entered) persist it to
  // the keychain keyed by the SAVED id. The credential is OMITTED when blank so an
  // empty submit never clobbers a stored one.
  const onSaveHost = async (host: SshHost, secret?: SshHostSecret) => {
    const mode = editTarget.value ? 'update' : 'create'
    try {
      const saved = await store.saveHost(host, mode)
      selectKey.value = saved.id
      if (secret && secret.password.trim()) {
        await store.setCredential({
          scope: 'host',
          id: saved.id,
          mode: 'password',
          password: secret.password,
        })
      }
      pushToast(t('ssh.toast.saved', { name: saved.name }), 'success')
    } catch (err) {
      console.error('[ssh] save host failed', err)
      pushToast(t('ssh.toast.saveFailed', { error: errText(err) }), 'error')
      return
    }
    closeEditor()
  }

  // --- identity editor + manager ---------------------------------------------
  const identityEditorOpen = ref(false)
  const identityTarget = ref<SshIdentity | null>(null)
  // The manager lists ALL identities (so orphans linked to no host are still
  // editable/deletable). Launching the editor closes it to avoid modal stacking;
  // delete keeps it open (the confirm dialog stacks above at z-200).
  const identityManagerOpen = ref(false)
  const openIdentityManager = () => {
    identityManagerOpen.value = true
  }
  const closeIdentityManager = () => {
    identityManagerOpen.value = false
  }

  const openNewIdentity = () => {
    identityManagerOpen.value = false
    identityTarget.value = null
    identityEditorOpen.value = true
  }
  const openEditIdentity = (id: string) => {
    identityManagerOpen.value = false
    identityTarget.value = store.identityById(id) ?? null
    identityEditorOpen.value = true
  }
  const closeIdentityEditor = () => {
    identityEditorOpen.value = false
    identityTarget.value = null
  }

  const onSaveIdentity = async (identity: SshIdentity, secret?: SshIdentitySecret) => {
    const mode = identityTarget.value ? 'update' : 'create'
    try {
      const saved = await store.saveIdentity(identity, mode)
      if (secret) {
        const cred = buildIdentityCredential(saved.id, secret)
        if (cred) await store.setCredential(cred)
      }
      pushToast(t('ssh.toast.identitySaved', { name: saved.name }), 'success')
    } catch (err) {
      console.error('[ssh] save identity failed', err)
      pushToast(t('ssh.toast.saveFailed', { error: errText(err) }), 'error')
      return
    }
    closeIdentityEditor()
  }

  // --- import from ~/.ssh/config ---------------------------------------------
  const importOpen = ref(false)
  const importLoading = ref(false)
  const candidates = ref<SshConfigCandidate[]>([])

  const openImport = async () => {
    importOpen.value = true
    importLoading.value = true
    candidates.value = []
    try {
      candidates.value = await store.importConfig()
    } catch (err) {
      console.error('[ssh] importConfig failed', err)
      pushToast(t('ssh.toast.importFailed', { error: errText(err) }), 'error')
    } finally {
      importLoading.value = false
    }
  }
  const closeImport = () => {
    importOpen.value = false
    candidates.value = []
  }
  const applyImport = async (aliases: string[]) => {
    if (!aliases.length) {
      closeImport()
      return
    }
    try {
      const res = await store.importConfigApply(aliases)
      pushToast(
        t('ssh.toast.imported', { imported: res.imported, skipped: res.skipped }),
        'success',
      )
    } catch (err) {
      console.error('[ssh] importConfigApply failed', err)
      pushToast(t('ssh.toast.importFailed', { error: errText(err) }), 'error')
    }
    closeImport()
  }

  // --- delete (hosts + identities share one confirm dialog) ------------------
  const pendingDelete = ref<PendingDelete | null>(null)
  const askDelete = (h: SshHost) => {
    pendingDelete.value = { kind: 'host', host: h }
  }
  const askDeleteIdentity = (id: string) => {
    const identity = store.identityById(id)
    if (identity) pendingDelete.value = { kind: 'identity', identity }
  }
  const cancelDelete = () => {
    pendingDelete.value = null
  }
  const deleteTitle = computed(() =>
    pendingDelete.value?.kind === 'identity' ? t('ssh.identity.delete') : t('ssh.delete'),
  )
  const deleteDescription = computed(() => {
    const p = pendingDelete.value
    if (!p) return ''
    if (p.kind === 'identity') {
      return t('ssh.identity.deleteHint', { name: p.identity.name })
    }
    return t('ssh.deleteHint', { name: p.host.name })
  })
  const confirmDelete = async () => {
    const p = pendingDelete.value
    if (!p) return
    pendingDelete.value = null
    try {
      if (p.kind === 'host') {
        const wasId = p.host.id
        await store.deleteHost(wasId)
        if (selectKey.value === wasId) selectKey.value = store.hosts[0]?.id ?? null
        pushToast(t('ssh.toast.deleted', { name: p.host.name }), 'success')
      } else {
        await store.deleteIdentity(p.identity.id)
        pushToast(t('ssh.toast.identityDeleted', { name: p.identity.name }), 'success')
      }
    } catch (err) {
      console.error('[ssh] delete failed', err)
      pushToast(t('ssh.toast.deleteFailed', { error: errText(err) }), 'error')
    }
  }

  // --- connect / test (P2) ---------------------------------------------------
  // Connect: open a NEW full-screen terminal tab for this host and focus it
  // (Termius-style — a host may have several concurrent shells). WorkspaceTerminal's
  // SSH transport drives the actual ssh.connect; any host-key prompt surfaces
  // app-wide via the store (SshHostKeyModal).
  const onConnect = (h: SshHost) => {
    store.openHostTerminal(h.id)
  }
  // Test: auth-only probe (may itself trigger a host-key prompt). No-op offline.
  const onTest = async (h: SshHost) => {
    if (!store.available) {
      pushToast(t('ssh.toast.comingSoon'), 'info')
      return
    }
    pushToast(t('ssh.toast.testing', { name: h.name }), 'info')
    try {
      const res = await sshApi.test(h.id)
      if (res.status === 'connected') pushToast(t('ssh.toast.testOk', { name: h.name }), 'success')
      else pushToast(t('ssh.toast.testFailed', { error: res.error ?? '' }), 'error')
    } catch (err) {
      pushToast(t('ssh.toast.testFailed', { error: errText(err) }), 'error')
    }
  }

  // SFTP + Forward (P3/P4): select the host, then open its panel in the detail
  // pane. Each panel gates on a live connId — it prompts Connect when none yet.
  const onSftp = (h: SshHost) => {
    selectKey.value = h.id
    store.openSftp(h.id)
  }
  const onForward = (h: SshHost) => {
    selectKey.value = h.id
    store.openForward(h.id)
  }

  // Answer the parked host-key prompt (accept + optional remember / reject).
  const confirmHostKey = (accept: boolean, remember: boolean): Promise<void> =>
    store.confirmHostKey(accept, remember)

  // --- per-row context menu (⋯ button + right-click) -------------------------
  const { discussInSshSession, openSession } = useSessionTaskLink()
  const sessionsStore = useSessionsStore()
  // Sessions linked to a host (ADR 0064) — newest first (higher client id = later).
  const linkedSessions = (hostId: string) =>
    sessionsStore.sessions.filter((s) => s.aboutSshHostId === hostId).sort((a, b) => b.id - a.id)
  const rowMenu = useContextMenu<SshHost>()
  const openRowMenu = (e: MouseEvent, h: SshHost) => rowMenu.open(e, h)
  const rowMenuItems = computed<MenuItem[]>(() => {
    const h = rowMenu.target.value
    const linked = h ? linkedSessions(h.id) : []
    return [
      { id: 'connect', label: t('ssh.menu.connect'), icon: 'play' },
      { id: 'edit', label: t('ssh.menu.edit'), icon: 'edit' },
      { id: 'open-in-session', label: t('ssh.menu.openInSession'), icon: 'sessions' },
      ...(linked.length
        ? [
            {
              id: 'view-sessions',
              label: t('ssh.menu.viewSessions', { count: linked.length }),
              icon: 'sessions',
            },
          ]
        : []),
      { separator: true },
      { id: 'delete', label: t('ssh.menu.delete'), icon: 'trash', danger: true },
    ]
  })
  const onRowMenuSelect = (id: string) => {
    const h = rowMenu.target.value
    if (!h) return
    if (id === 'edit') openEditor(h)
    else if (id === 'connect') onConnect(h)
    else if (id === 'open-in-session')
      void discussInSshSession(h.id, '', t('ssh.session.title', { name: h.name }))
    else if (id === 'view-sessions') {
      const latest = linkedSessions(h.id)[0]
      if (latest?.engineId) void openSession(latest.engineId)
    } else if (id === 'delete') askDelete(h)
  }

  onMounted(() => {
    void store.loadAll()
  })

  return {
    // store-backed
    hosts: computed(() => store.hosts),
    identities: computed(() => store.identities),
    available: computed(() => store.available),
    // selection
    selectKey,
    // host editor
    editorOpen,
    editTarget,
    seedFolder,
    openNew,
    openNewInGroup,
    openEditor,
    closeEditor,
    onSaveHost,
    // identity editor + manager
    identityEditorOpen,
    identityTarget,
    identityManagerOpen,
    openIdentityManager,
    closeIdentityManager,
    openNewIdentity,
    openEditIdentity,
    closeIdentityEditor,
    onSaveIdentity,
    // import
    importOpen,
    importLoading,
    candidates,
    openImport,
    closeImport,
    applyImport,
    // delete
    pendingDelete,
    askDelete,
    askDeleteIdentity,
    cancelDelete,
    deleteTitle,
    deleteDescription,
    confirmDelete,
    // connect / test / placeholders
    onConnect,
    onTest,
    onSftp,
    onForward,
    // host-key TOFU
    pendingHostKey: computed(() => store.pendingHostKey),
    confirmHostKey,
    // row menu
    rowMenu,
    openRowMenu,
    rowMenuItems,
    onRowMenuSelect,
    // toasts
    toasts,
    toastColor,
  }
}

// Map the identity editor's raw secret parts to a keychain credential. A pasted
// private key wins (mode 'inline-key', carrying an optional passphrase); else a
// lone passphrase writes mode 'passphrase'. Nothing entered → undefined (skip).
function buildIdentityCredential(
  id: string,
  secret: SshIdentitySecret,
): SshCredentialInput | undefined {
  const privateKey = secret.privateKey?.trim()
  const passphrase = secret.passphrase?.trim()
  if (privateKey) {
    return passphrase
      ? { scope: 'identity', id, mode: 'inline-key', privateKey, passphrase }
      : { scope: 'identity', id, mode: 'inline-key', privateKey }
  }
  if (passphrase) return { scope: 'identity', id, mode: 'passphrase', passphrase }
  return undefined
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
