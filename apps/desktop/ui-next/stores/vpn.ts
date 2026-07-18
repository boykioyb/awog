import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'

// VPN Manager store — dual-path live over the `vpn.*` RPC surface (ADR 0065).
// One file-per-entity inventory lives on disk (parallel to SSH hosts):
//   ~/.awog/vpn-profiles/<id>.json  — VpnProfile
//
// The file NEVER holds a secret. VPN credentials (username / password / key
// passphrase) live ONLY in the OS keychain, written through `vpn.setCredential`
// (WRITE-ONLY — the secret is never returned, never read back). `configPath` is a
// filesystem path to the .ovpn file, not a secret, so it round-trips as plaintext.
//
// P0 is CRUD + credentials only: there is no live tunnel process yet, so the store
// subscribes just to the one fs-changed channel (re-hydrate on out-of-band edits).
// The persisted `status` is rendered as a small badge but there is no up/down
// control (that is P1). Browser-dev (no Electron shell) seeds a small in-memory
// mock so the card UI works offline.

export type VpnType = 'openvpn'
export type VpnAuthMode = 'none' | 'user-pass'
export type VpnStatus = 'up' | 'connecting' | 'down' | 'error'

export interface VpnProfile {
  id: string
  name: string
  type: VpnType
  configPath: string
  authMode: VpnAuthMode
  // UI hints only — hydrated from the keychain at list time (never the secret).
  hasUserPass: boolean
  hasKeyPassphrase: boolean
  keepalive: boolean
  autoDown: boolean
  folder?: string
  tags?: string[]
  status?: VpnStatus
  statusError?: string
  lastUpAt?: string
  createdAt: string
  updatedAt: string
}

// WRITE-ONLY credential payload (mirror of the sidecar `vpn.setCredential`
// contract). At least one field must be present; the secret is stored in the OS
// keychain and never read back.
export interface VpnCredentialInput {
  id: string
  username?: string
  password?: string
  keyPassphrase?: string
}

// Live runtime state (P1) — the wire shape of `vpn.status` + the
// `vpn:status-changed` event. NEVER carries ports / pw-file paths / secrets.
export interface VpnRuntimeState {
  id: string
  status: VpnStatus
  refCount: number
  pid?: number
  upAt?: number
  error?: string
}

// Theme token per persisted status — drives the card status dot. A missing status
// is treated as idle/down (this is last-known only when there's no live record).
export const VPN_STATUS_COLORS: Record<VpnStatus, string> = {
  up: 'var(--green)',
  connecting: 'var(--accent)',
  down: 'var(--textDim)',
  error: 'var(--danger)',
}

// A stable, tasteful color per profile monogram (mirror of hostAccent) — seeds by
// folder so a group shares a hue, else by name. Generated HSL, theme-safe.
export interface VpnAccent {
  fg: string
  bg: string
  border: string
}
export function vpnAccent(seed: string): VpnAccent {
  let h = 0
  const s = seed || 'vpn'
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  const hue = h % 360
  return {
    fg: `hsl(${hue} 62% 62%)`,
    bg: `hsl(${hue} 45% 50% / 0.16)`,
    border: `hsl(${hue} 50% 55% / 0.34)`,
  }
}

// Stable id: filename-safe + keychain account segment (mirror of VPN_ID_RE).
const VPN_ID_RE = /^[a-z0-9][a-z0-9_-]{0,120}$/

// Slugify a display name into a valid id: lowercase, collapse illegal chars to a
// dash, strip a leading non-alnum run, and cap the length so a collision suffix
// still fits.
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/, '')
    .slice(0, 110)
  return base || 'vpn'
}

// A valid, unique id for a new profile: slugify(name), then append a short numeric
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

export const useVpnStore = defineStore('vpn', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const profiles = ref<VpnProfile[]>(sc.available ? [] : mockProfiles())
  const loaded = ref(false)

  // Live runtime status keyed by profile id (seeded by vpn.status, kept current by
  // the vpn:status-changed event). Takes precedence over the profile's persisted
  // status while a tunnel has a live record on the sidecar.
  const runtime = ref<Record<string, VpnRuntimeState>>({})

  let unlisten: UnlistenFn | null = null

  // --- getters ---------------------------------------------------------------
  const profileById = (id: string): VpnProfile | undefined =>
    profiles.value.find((p) => p.id === id)

  // Effective status: live runtime record wins over the profile's persisted status,
  // which wins over 'down' (a profile never brought up this session).
  const statusOf = (id: string): VpnStatus =>
    runtime.value[id]?.status ?? profileById(id)?.status ?? 'down'
  const errorOf = (id: string): string | undefined =>
    runtime.value[id]?.error ?? profileById(id)?.statusError
  const isUp = (id: string): boolean => statusOf(id) === 'up'
  const isBusy = (id: string): boolean => statusOf(id) === 'connecting'

  function applyRuntime(state: VpnRuntimeState): void {
    runtime.value = { ...runtime.value, [state.id]: state }
  }

  // Upsert in place (keyed by id) so a mutating RPC keeps list order stable.
  function applyProfile(profile: VpnProfile): void {
    const idx = profiles.value.findIndex((p) => p.id === profile.id)
    if (idx >= 0) profiles.value[idx] = profile
    else profiles.value.push(profile)
  }

  // --- hydrate ---------------------------------------------------------------
  async function loadAll(): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      const res = await sc.request<{ profiles: VpnProfile[] }>('vpn.list')
      profiles.value = Array.isArray(res.profiles) ? res.profiles : []
    } catch (err) {
      console.warn('[vpn] loadAll failed', err)
    } finally {
      loaded.value = true
      void subscribe()
      void refreshStatus()
    }
  }

  // --- CRUD ------------------------------------------------------------------
  // Create-or-update. On create the id is generated from the name (unique within
  // the inventory) before the payload crosses IPC, because the caller keys a
  // subsequent `vpn.setCredential` by the SAVED id.
  async function saveProfile(profile: VpnProfile, mode: 'create' | 'update'): Promise<VpnProfile> {
    const payload: VpnProfile =
      mode === 'create' || !VPN_ID_RE.test(profile.id)
        ? { ...profile, id: uniqueId(profile.name, new Set(profiles.value.map((p) => p.id))) }
        : profile
    if (available.value) {
      const res = await sc.request<{ profile: VpnProfile }>('vpn.upsert', {
        profile: payload,
        mode,
      })
      applyProfile(res.profile)
      return res.profile
    }
    const now = new Date().toISOString()
    const next: VpnProfile = { ...payload, createdAt: payload.createdAt || now, updatedAt: now }
    applyProfile(next)
    return next
  }

  async function deleteProfile(id: string): Promise<void> {
    if (available.value) {
      try {
        await sc.request('vpn.delete', { id })
      } catch (err) {
        console.warn('[vpn] deleteProfile failed', err)
        throw err
      }
    }
    profiles.value = profiles.value.filter((p) => p.id !== id)
  }

  // --- live control (P1) -----------------------------------------------------
  // Seed the live runtime map from the sidecar (called after loadAll). Merges
  // persisted-only profiles server-side, so this is the source of truth on load.
  async function refreshStatus(): Promise<void> {
    if (!available.value) return
    try {
      const res = await sc.request<{ states: VpnRuntimeState[] }>('vpn.status')
      const next: Record<string, VpnRuntimeState> = {}
      for (const s of res.states) next[s.id] = s
      runtime.value = next
    } catch (err) {
      console.warn('[vpn] refreshStatus failed', err)
    }
  }

  // Bring a tunnel up. Parks on the OS admin prompt + readiness (seconds), so the
  // caller should show a busy affordance; the vpn:status-changed event flips the
  // card to 'connecting' immediately. Throws on prompt-cancel / auth-fail so the
  // caller can surface it. Browser-dev just flips the mock status.
  async function up(id: string): Promise<void> {
    if (!available.value) {
      applyRuntime({ id, status: 'up', refCount: 0, upAt: Date.now() })
      return
    }
    applyRuntime({ id, status: 'connecting', refCount: runtime.value[id]?.refCount ?? 0 })
    try {
      const res = await sc.request<{ status: VpnStatus }>('vpn.up', { id })
      applyRuntime({ id, status: res.status, refCount: runtime.value[id]?.refCount ?? 0 })
    } catch (err) {
      // The manager already emitted error/down via the event; only backstop a
      // stuck 'connecting' if no event arrived.
      if (runtime.value[id]?.status === 'connecting') {
        applyRuntime({
          id,
          status: 'error',
          refCount: 0,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      throw err
    }
  }

  // Tear a tunnel down (SIGTERM via the management socket, sidecar-side).
  async function down(id: string): Promise<void> {
    if (!available.value) {
      applyRuntime({ id, status: 'down', refCount: 0 })
      return
    }
    try {
      await sc.request('vpn.down', { id })
    } finally {
      applyRuntime({ id, status: 'down', refCount: 0 })
    }
  }

  // --- credentials (WRITE-ONLY) ----------------------------------------------
  // The secret is written to the OS keychain and never returned. Browser-dev has
  // no keychain, so this is a no-op there (the mock UI can't store a real secret).
  async function setCredential(input: VpnCredentialInput): Promise<void> {
    if (!available.value) return
    await sc.request('vpn.setCredential', input)
  }

  // --- event subscription ----------------------------------------------------
  // One fs watcher re-hydrates the inventory on out-of-band edits. One listener.
  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (!evt) return
        if (evt.type === 'vpn-profiles.fs-changed') {
          void loadAll()
          return
        }
        if (evt.type === 'vpn:status-changed') {
          const p = evt.payload as VpnRuntimeState
          if (p?.id) applyRuntime(p)
        }
      })
    } catch {
      unlisten = null
    }
  }

  return {
    // state
    profiles,
    loaded,
    available,
    runtime,
    // getters
    profileById,
    statusOf,
    errorOf,
    isUp,
    isBusy,
    // actions
    loadAll,
    saveProfile,
    deleteProfile,
    setCredential,
    refreshStatus,
    up,
    down,
  }
})

// ── Browser-dev mocks ─────────────────────────────────────────────────────────
function mockProfiles(): VpnProfile[] {
  const now = new Date().toISOString()
  return [
    {
      id: 'office-vpn',
      name: 'Office VPN',
      type: 'openvpn',
      configPath: '~/vpn/office.ovpn',
      authMode: 'user-pass',
      hasUserPass: true,
      hasKeyPassphrase: false,
      keepalive: true,
      autoDown: false,
      folder: 'work',
      tags: ['office'],
      status: 'down',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'home-lab',
      name: 'Home Lab',
      type: 'openvpn',
      configPath: '~/vpn/homelab.ovpn',
      authMode: 'none',
      hasUserPass: false,
      hasKeyPassphrase: true,
      keepalive: true,
      autoDown: true,
      status: 'up',
      createdAt: now,
      updatedAt: now,
    },
  ]
}
