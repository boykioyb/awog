import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'

// SSH Manager store — dual-path live over the `ssh.*` RPC surface (ADR 0063).
// Two file-per-entity inventories live on disk (parallel to Sources):
//   ~/.awog/ssh-hosts/<id>.json       — SshHost
//   ~/.awog/ssh-identities/<id>.json  — SshIdentity
//
// NEITHER file ever holds a secret. Passwords / key passphrases / inline private
// key material live ONLY in the OS keychain, written through `ssh.setCredential`
// (WRITE-ONLY — the secret is never returned, never read back). `keyPath` is a
// filesystem path, not a secret, so it round-trips as plaintext.
//
// P1 is CRUD + import only: there is no live connection process, so the store
// subscribes just to the two fs-changed channels (re-hydrate on out-of-band
// edits). Without the Electron shell there is no data to load, so the list stays
// empty (no seed data).

export type SshAuthMethod = 'password' | 'key' | 'agent'
export type SshKeyType = 'ed25519' | 'rsa' | 'ecdsa' | 'other'
export type SshConnectionStatus = 'connected' | 'disconnected' | 'error' | 'unknown'

export type PortForward =
  | {
      id: string
      type: 'local'
      label?: string
      bindHost?: string
      bindPort: number
      destHost: string
      destPort: number
    }
  | {
      id: string
      type: 'remote'
      label?: string
      bindHost?: string
      bindPort: number
      destHost: string
      destPort: number
    }
  | { id: string; type: 'dynamic'; label?: string; bindHost?: string; bindPort: number }

export interface SshHostOptions {
  keepaliveIntervalMs?: number
  compression?: boolean
  strictHostKey?: boolean
}

export interface SshHost {
  id: string
  name: string
  host: string
  port: number
  user: string
  authMethod: SshAuthMethod
  identityId?: string
  folder?: string
  tags?: string[]
  // Expose this host to session agents as an SSH tool (ADR 0064). undefined =
  // enabled (backward-compat); false = hidden from agents.
  agentEnabled?: boolean
  jumpHostId?: string
  // Ref a VpnProfile that must be up before this host is reachable (ADR 0065 P3).
  // On connect the sidecar brings the VPN up (ref-counted, shared across hosts)
  // then ssh2 reaches the host via OS routing.
  vpnId?: string
  portForwards?: PortForward[]
  options?: SshHostOptions
  connectionStatus?: SshConnectionStatus
  connectionError?: string
  lastConnectedAt?: string
  createdAt: string
  updatedAt: string
}

export interface SshIdentity {
  id: string
  name: string
  keyType?: SshKeyType
  keyPath?: string
  inlineStored: boolean
  hasPassphrase: boolean
  createdAt: string
  updatedAt: string
}

export interface SshConfigCandidate {
  alias: string
  host: string
  port: number
  user?: string
  identityFile?: string
  proxyJump?: string
}

// WRITE-ONLY credential payloads (mirror of the sidecar `ssh.setCredential`
// contract). The secret is stored in the OS keychain and never read back.
export type SshCredentialInput =
  | { scope: 'host'; id: string; mode: 'password'; password: string }
  | { scope: 'identity'; id: string; mode: 'passphrase'; passphrase: string }
  | { scope: 'identity'; id: string; mode: 'inline-key'; privateKey: string; passphrase?: string }

// Theme token per derived status — drives the card status dot + detail pill.
export const SSH_STATUS_COLORS: Record<SshConnectionStatus, string> = {
  connected: 'var(--green)',
  disconnected: 'var(--textDim)',
  error: 'var(--danger)',
  unknown: 'var(--textDim)',
}

// A stable, tasteful color per host monogram — Termius colors host/group icons so
// the list scans by hue. Generated (not a hardcoded palette) as HSL so it reads
// in both dark + light; seed by folder so a group shares a hue, else by name.
export interface HostAccent {
  fg: string
  bg: string
  border: string
}
export function hostAccent(seed: string): HostAccent {
  let h = 0
  const s = seed || 'ssh'
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  const hue = h % 360
  return {
    fg: `hsl(${hue} 62% 62%)`,
    bg: `hsl(${hue} 45% 50% / 0.16)`,
    border: `hsl(${hue} 50% 55% / 0.34)`,
  }
}

// Result of an apply-import run (mirror of the sidecar `ssh.importConfigApply`).
export type SshImportResult = { imported: number; skipped: number; ids: string[] }

// A parked host-key verification (mirror of the sidecar `ssh:host-key-prompt`
// event, ADR 0063 P2). The connect is held open until the user answers via
// `ssh.confirmHostKey`. Only non-secret material crosses the wire.
export interface SshHostKeyPrompt {
  connId: string
  host: string
  port: number
  keyType: string
  fingerprint: string
  status: 'unknown' | 'changed'
}

// Left-sidebar sections of the Termius-style SSH workspace. `vpn` is the VPN
// Manager pane (ADR 0065) — reachability tier that sits alongside the SSH sections.
export type SshSection =
  | 'hosts'
  | 'vpn'
  | 'keychain'
  | 'forwarding'
  | 'known-hosts'
  | 'snippets'
  | 'logs'

// Stable id: filename-safe + keychain account segment (mirror of SSH_ID_RE).
const SSH_ID_RE = /^[a-z0-9][a-z0-9_-]{0,120}$/

// Slugify a display name into a valid id: lowercase, collapse illegal chars to a
// dash, strip a leading non-alnum run (the regex requires a leading alnum), and
// cap the length so a collision suffix still fits.
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/, '')
    .slice(0, 110)
  return base || 'ssh'
}

// A valid, unique id for a new entity: slugify(name), then append a short numeric
// suffix (fallback random) until it doesn't collide with `existing`.
function uniqueId(name: string, existing: ReadonlySet<string>): string {
  const base = slugify(name)
  if (!existing.has(base)) return base
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`
    if (!existing.has(candidate)) return candidate
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`
}

export const useSshStore = defineStore('ssh', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const hosts = ref<SshHost[]>([])
  const identities = ref<SshIdentity[]>([])
  const loaded = ref(false)

  // --- live-connection runtime (P2) ------------------------------------------
  // A parked host-key prompt (null → none pending). The detail pane's terminal
  // is shown for `terminalHostId` (one at a time in v1). Both are driven by the
  // ssh:* event stream + the Connect action; neither is persisted.
  const pendingHostKey = ref<SshHostKeyPrompt | null>(null)
  // Which host has its terminal / SFTP browser / forward panel open in the detail
  // pane (one host per surface in v1; all read a live connId from liveConnByHost).
  const terminalHostId = ref<string | null>(null)
  const sftpHostId = ref<string | null>(null)
  const forwardHostId = ref<string | null>(null)

  // ── Termius-style workspace (ADR 0063 P6) ──────────────────────────────────
  // A top tab bar where the 'hosts' tab is the management view (left-sidebar
  // sections + host grid) and every other tab is a full-screen live terminal to a
  // host — multiple tabs MAY target the same host (Termius "ey-techs" / "ey-techs
  // (1)"). `sshSection` is the active left-sidebar section inside the hosts view.
  const terminalTabs = ref<{ id: string; hostId: string }[]>([])
  const activeTab = ref<string>('hosts')
  const sshSection = ref<SshSection>('hosts')
  let tabCounter = 0

  // SSH terminal co-pilot (ADR 0064): the docked session panel reuses ONE session
  // per host (client id from the sessions store), so toggling the panel or switching
  // tabs doesn't spawn a new chat. Renderer-only, survives panel unmount.
  const copilotSessionByHost = ref<Record<string, number>>({})
  const copilotSessionId = (hostId: string): number | undefined =>
    copilotSessionByHost.value[hostId]
  const linkCopilotSession = (hostId: string, sessionId: number): void => {
    copilotSessionByHost.value[hostId] = sessionId
  }

  // Open (or re-focus) the terminal tab for a host. ONE top-tab per host — the
  // WorkspaceTerminal inside handles multiple shells to that host via its own
  // inner tab strip, so re-connecting an already-open host just re-focuses its
  // existing tab (no duplicate "(1)"/"(2)" tabs).
  function openHostTerminal(hostId: string): string {
    const existing = terminalTabs.value.find((t) => t.hostId === hostId)
    if (existing) {
      activeTab.value = existing.id
      return existing.id
    }
    tabCounter += 1
    const id = `tab-${tabCounter}`
    terminalTabs.value.push({ id, hostId })
    activeTab.value = id
    return id
  }
  function closeTerminalTab(id: string): void {
    const idx = terminalTabs.value.findIndex((t) => t.id === id)
    if (idx < 0) return
    terminalTabs.value.splice(idx, 1)
    if (activeTab.value === id) {
      const next = terminalTabs.value[idx] ?? terminalTabs.value[idx - 1]
      activeTab.value = next ? next.id : 'hosts'
    }
  }
  function setActiveTab(id: string): void {
    activeTab.value = id
  }
  function setSection(s: SshSection): void {
    sshSection.value = s
    activeTab.value = 'hosts'
  }
  // Most-recent live connId per host (from ssh:status-changed). SFTP + port
  // forwards run over an open connection, so they read the connId from here — a
  // host with none is "not connected yet" (the UI prompts Connect first).
  const liveConnByHost = ref<Record<string, string>>({})
  // ALL live shells per host, in connect order (co-pilot terminal picker, ADR 0064).
  // A host tab can hold several shells (WorkspaceTerminal inner tabs); this lets the
  // agent be pointed at a specific one. `liveConnByHost` stays the "primary" (latest).
  const liveShellsByHost = ref<Record<string, string[]>>({})
  const shellsForHost = (hostId: string): string[] => liveShellsByHost.value[hostId] ?? []

  let unlisten: UnlistenFn | null = null

  // --- getters ---------------------------------------------------------------
  const hostById = (id: string): SshHost | undefined => hosts.value.find((h) => h.id === id)
  const identityById = (id: string): SshIdentity | undefined =>
    identities.value.find((i) => i.id === id)

  // Upsert in place (keyed by id) so a mutating RPC keeps list order stable.
  function applyHost(host: SshHost): void {
    const idx = hosts.value.findIndex((h) => h.id === host.id)
    if (idx >= 0) hosts.value[idx] = host
    else hosts.value.push(host)
  }
  function applyIdentity(identity: SshIdentity): void {
    const idx = identities.value.findIndex((i) => i.id === identity.id)
    if (idx >= 0) identities.value[idx] = identity
    else identities.value.push(identity)
  }

  // --- hydrate ---------------------------------------------------------------
  async function loadAll(): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      const res = await sc.request<{ hosts: SshHost[]; identities: SshIdentity[] }>('ssh.list')
      hosts.value = Array.isArray(res.hosts) ? res.hosts : []
      identities.value = Array.isArray(res.identities) ? res.identities : []
    } catch (err) {
      console.warn('[ssh] loadAll failed', err)
    } finally {
      loaded.value = true
      void subscribe()
    }
  }

  // --- host CRUD -------------------------------------------------------------
  // Create-or-update. On create the id is generated from the name (unique within
  // the host inventory) before the payload crosses IPC, because the caller keys a
  // subsequent `ssh.setCredential` by the SAVED id.
  async function saveHost(host: SshHost, mode: 'create' | 'update'): Promise<SshHost> {
    const payload: SshHost =
      mode === 'create' || !SSH_ID_RE.test(host.id)
        ? { ...host, id: uniqueId(host.name, new Set(hosts.value.map((h) => h.id))) }
        : host
    if (available.value) {
      const res = await sc.request<{ host: SshHost }>('ssh.upsert', { host: payload, mode })
      applyHost(res.host)
      return res.host
    }
    const now = new Date().toISOString()
    const next: SshHost = { ...payload, createdAt: payload.createdAt || now, updatedAt: now }
    applyHost(next)
    return next
  }

  async function deleteHost(id: string): Promise<void> {
    if (available.value) {
      try {
        await sc.request('ssh.delete', { id })
      } catch (err) {
        console.warn('[ssh] deleteHost failed', err)
      }
    }
    hosts.value = hosts.value.filter((h) => h.id !== id)
  }

  // --- identity CRUD ---------------------------------------------------------
  async function saveIdentity(
    identity: SshIdentity,
    mode: 'create' | 'update',
  ): Promise<SshIdentity> {
    const payload: SshIdentity =
      mode === 'create' || !SSH_ID_RE.test(identity.id)
        ? { ...identity, id: uniqueId(identity.name, new Set(identities.value.map((i) => i.id))) }
        : identity
    if (available.value) {
      const res = await sc.request<{ identity: SshIdentity }>('ssh.identityUpsert', {
        identity: payload,
        mode,
      })
      applyIdentity(res.identity)
      return res.identity
    }
    const now = new Date().toISOString()
    const next: SshIdentity = { ...payload, createdAt: payload.createdAt || now, updatedAt: now }
    applyIdentity(next)
    return next
  }

  async function deleteIdentity(id: string): Promise<void> {
    if (available.value) {
      try {
        await sc.request('ssh.identityDelete', { id })
      } catch (err) {
        console.warn('[ssh] deleteIdentity failed', err)
      }
    }
    identities.value = identities.value.filter((i) => i.id !== id)
  }

  // --- credentials (WRITE-ONLY) ----------------------------------------------
  // The secret is written to the OS keychain and never returned. Browser-dev has
  // no keychain, so this is a no-op there (nowhere to store a real secret).
  async function setCredential(input: SshCredentialInput): Promise<void> {
    if (!available.value) return
    await sc.request('ssh.setCredential', input)
  }

  // Read a stored credential back so an editor can prefill it (the user's own login,
  // shown like a password manager — see ssh.get-credential.ts for the rationale).
  // Returns {} in browser-dev / on any failure.
  async function getCredential(
    scope: 'host' | 'identity',
    id: string,
  ): Promise<{ password?: string; passphrase?: string; privateKey?: string }> {
    if (!available.value) return {}
    try {
      return await sc.request('ssh.getCredential', { scope, id })
    } catch (err) {
      console.warn('[ssh] getCredential failed', err)
      return {}
    }
  }

  // --- import from ~/.ssh/config ---------------------------------------------
  // Dry-run parse; returns the importable candidates without touching disk.
  async function importConfig(): Promise<SshConfigCandidate[]> {
    if (!available.value) return []
    const res = await sc.request<{ candidates: SshConfigCandidate[] }>('ssh.importConfig')
    return Array.isArray(res.candidates) ? res.candidates : []
  }

  // Apply the chosen aliases, then re-hydrate so the new hosts appear.
  async function importConfigApply(aliases: string[]): Promise<SshImportResult> {
    // Only the sidecar can read ~/.ssh/config, so without the bridge there is
    // nothing to import.
    if (!available.value) return { imported: 0, skipped: aliases.length, ids: [] }
    const res = await sc.request<SshImportResult>('ssh.importConfigApply', { aliases })
    await loadAll()
    return res
  }

  // --- live-connection actions (P2) ------------------------------------------
  // Which host's terminal is shown in the detail pane (v1: one at a time).
  function openTerminal(id: string): void {
    terminalHostId.value = id
  }
  function closeTerminal(): void {
    terminalHostId.value = null
  }
  function openSftp(id: string): void {
    sftpHostId.value = id
  }
  function closeSftp(): void {
    sftpHostId.value = null
  }
  function openForward(id: string): void {
    forwardHostId.value = id
  }
  function closeForward(): void {
    forwardHostId.value = null
  }

  // Answer a parked host-key prompt. Accept+remember appends the key to
  // ~/.ssh/known_hosts (sidecar-side); reject fails the pending connect cleanly.
  async function confirmHostKey(accept: boolean, remember: boolean): Promise<void> {
    const prompt = pendingHostKey.value
    pendingHostKey.value = null
    if (!prompt || !available.value) return
    try {
      await sc.request('ssh.confirmHostKey', { connId: prompt.connId, accept, remember })
    } catch (err) {
      console.warn('[ssh] confirmHostKey failed', err)
    }
  }

  const connIdForHost = (hostId: string): string | undefined => liveConnByHost.value[hostId]

  // Fold a live status change onto the matching host so the card/detail reflect
  // it without a full re-hydrate (in-place mutation is reactive on the ref array).
  // Also tracks the live connId per host so SFTP/forward panels can find it.
  function applyStatus(
    hostId: string,
    status?: SshConnectionStatus,
    error?: string,
    connId?: string,
  ): void {
    if (connId) {
      const shells = liveShellsByHost.value[hostId] ?? []
      if (status === 'connected') {
        liveConnByHost.value[hostId] = connId
        if (!shells.includes(connId)) liveShellsByHost.value[hostId] = [...shells, connId]
      } else {
        const rest = shells.filter((c) => c !== connId)
        if (rest.length) liveShellsByHost.value[hostId] = rest
        else delete liveShellsByHost.value[hostId]
        // Primary follows: drop or fall back to the newest remaining shell.
        if (liveConnByHost.value[hostId] === connId) {
          const fallback = rest[rest.length - 1]
          if (fallback) liveConnByHost.value[hostId] = fallback
          else delete liveConnByHost.value[hostId]
        }
      }
    }
    const h = hosts.value.find((x) => x.id === hostId)
    if (!h || !status) return
    h.connectionStatus = status
    if (error) h.connectionError = error
    else delete h.connectionError
    if (status === 'connected') h.lastConnectedAt = new Date().toISOString()
  }

  // --- event subscription ----------------------------------------------------
  // Two fs watchers re-hydrate the inventory on out-of-band edits; the live SSH
  // channels drive the host-key prompt + per-host status (P2). One listener.
  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (!evt) return
        if (evt.type === 'ssh-hosts.fs-changed' || evt.type === 'ssh-identities.fs-changed') {
          void loadAll()
          return
        }
        if (evt.type === 'ssh:host-key-prompt') {
          const p = evt.payload as SshHostKeyPrompt
          if (p?.connId) pendingHostKey.value = p
          return
        }
        if (evt.type === 'ssh:status-changed') {
          const p = evt.payload as {
            hostId?: string
            status?: SshConnectionStatus
            error?: string
            connId?: string
          }
          if (p?.hostId) applyStatus(p.hostId, p.status, p.error, p.connId)
        }
      })
    } catch {
      unlisten = null
    }
  }

  return {
    // state
    hosts,
    identities,
    loaded,
    available,
    pendingHostKey,
    terminalHostId,
    sftpHostId,
    forwardHostId,
    liveConnByHost,
    terminalTabs,
    activeTab,
    sshSection,
    // getters
    hostById,
    identityById,
    connIdForHost,
    shellsForHost,
    copilotSessionId,
    linkCopilotSession,
    // actions
    loadAll,
    saveHost,
    deleteHost,
    saveIdentity,
    deleteIdentity,
    setCredential,
    getCredential,
    importConfig,
    importConfigApply,
    openTerminal,
    closeTerminal,
    openSftp,
    closeSftp,
    openForward,
    closeForward,
    openHostTerminal,
    closeTerminalTab,
    setActiveTab,
    setSection,
    confirmHostKey,
  }
})
