import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'

// Hooks store — dual-path live (execution-engine hooks, ADR 0032). When the
// Electron bridge is available `loadHooks()` scans the user/global tier + every
// passed project tier over IPC; a `hooks.fs-changed` subscription re-hydrates
// when files are touched outside the app, and a live `hook.run` event prepends a
// run record to the matching hook's audit list. Without the bridge the list stays
// empty (no seed data). Mirrors stores/skills.ts (the reference) + stores/rules.ts
// dual-path pattern.
//
// Richer than skills: each hook has an `enabled` toggle, a run-once action, an
// editable script file, a recentRuns audit, and a project-tier TRUST gate
// (ADR 0032 D-8) — project hooks never spawn until the user grants trust.

export type HookSource = 'global' | 'project'

export type HookEvent =
  | 'task.before-start'
  | 'task.after-complete'
  | 'phase.before-run'
  | 'phase.after-run'
  | 'phase.before-approve'
  | 'phase.after-approve'
  | 'artifact.before-write'
  | 'artifact.after-write'
  | 'agent.before-prompt'
  | 'agent.after-response'
  | 'tool.before-call'
  | 'tool.after-call'
  | 'mcp.server-error'
  | 'session.reset'

export type HookRunMode = 'blocking' | 'background'

// One audit entry from a hook spawn (live `hook.run` event or `hooks.run-once`).
export type HookRunRecord = {
  at: string
  durationMs: number
  exitCode: number
  stderr?: string
}

// Hook entity (mirror of sidecar Hook — apps/desktop/sidecar/src/hooks). NOT
// imported from the sidecar package; the store owns its own minimal slice.
export type Hook = {
  id: string
  name: string
  description: string
  event: HookEvent
  matcher: Record<string, string>
  command: string
  cwd: string
  timeoutMs: number
  runMode: HookRunMode
  enabled: boolean
  env?: Record<string, string>
  // Location tags — set by the sidecar on list/load; default to the global tier.
  source?: HookSource
  projectId?: string
  // Trust gate (ADR 0032 D-8): global = always true; project-tier = false until
  // the user grants trust. Untrusted hooks never spawn.
  trusted?: boolean
  // Imported Claude Code hook (claude-*): not editable in AWOG.
  readOnly?: boolean
  recentRuns: HookRunRecord[]
}

// Per-tier scan report (1 entry per scanned dir). Surfaces resolved paths +
// counts so a misconfigured HOME / missing dir is diagnosable.
export type HookScanReport = {
  dir: string
  source: HookSource
  found: number
  projectId?: string
}

// The script file a hook command runs (e.g. format-after-edit.sh).
export type HookScriptInfo = { path: string; content: string; exists: boolean }

// Shape the LLM config generator returns (subset of Hook content fields).
export type HookConfig = {
  name: string
  description: string
  event: HookEvent
  matcher: Record<string, string>
  command: string
  cwd: string
  timeoutMs: number
  runMode: HookRunMode
}

type HooksListResponse = { hooks: Hook[]; reports?: HookScanReport[] }

// Composite identity — a hook is keyed by (source, projectId, id) so a project
// hook and a global hook (or imported CC hooks across projects) can share an id
// without colliding.
const matchKey = (a: Hook, b: { source?: HookSource; projectId?: string; id: string }): boolean =>
  a.id === b.id &&
  (a.source ?? 'global') === (b.source ?? 'global') &&
  (a.projectId ?? undefined) === (b.projectId ?? undefined)

export const useHooksStore = defineStore('hooks', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const hooks = ref<Hook[]>([])
  const scanReports = ref<HookScanReport[]>([])
  const loaded = ref(false)

  let unlisten: UnlistenFn | null = null

  // Stable composite key for list selection / dedupe.
  const hookKey = (h: Pick<Hook, 'id' | 'source' | 'projectId'>): string =>
    `${h.source ?? 'global'}|${h.projectId ?? ''}|${h.id}`

  const hookByKey = (key: string): Hook | undefined => hooks.value.find((h) => hookKey(h) === key)

  // Match by the full (id, source, projectId) — project-tier ids collide across
  // projects (imported CC hooks), so id-only would find the wrong instance.
  const findHook = (hook: Pick<Hook, 'id' | 'source' | 'projectId'>): Hook | undefined =>
    hooks.value.find((h) => matchKey(h, hook))

  // Scan the user/global tier + every passed project tier. Default scope is the
  // global tier only (the page passes projectIds from its project roster).
  async function loadHooks(projectIds?: string[]): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      // Pass an explicit object (never `undefined`) — the IPC boundary maps
      // undefined params → null and the sidecar zod schema rejects null.
      const ids = projectIds ?? []
      const params = ids.length > 0 ? { projectIds: ids } : {}
      const res = await sc.request<HooksListResponse>('hooks.list', params)
      hooks.value = Array.isArray(res.hooks) ? res.hooks : []
      scanReports.value = Array.isArray(res.reports) ? res.reports : []
    } catch (err) {
      console.warn('[hooks] loadHooks failed', err)
    } finally {
      loaded.value = true
      void subscribe()
    }
  }

  // Create-or-update. The composite key decides create vs update (tier can't be
  // moved on an existing hook, so there is no rename path like skills' slug).
  async function saveHook(data: Hook): Promise<Hook> {
    const source = data.source ?? 'global'
    const incoming: Hook = { ...data, source, recentRuns: data.recentRuns ?? [] }
    const existing = findHook(incoming)
    const isUpdate = !!existing

    // Optimistic local update (also the browser-dev path).
    if (existing) Object.assign(existing, incoming)
    else hooks.value.push(incoming)

    if (!available.value) return incoming
    try {
      await sc.request('hooks.upsert', {
        hook: { ...data, source },
        mode: isUpdate ? 'update' : 'create',
      })
    } catch (err) {
      console.warn('[hooks] saveHook failed', err)
    }
    return incoming
  }

  async function deleteHook(id: string, source?: HookSource, projectId?: string): Promise<void> {
    const target = hooks.value.find((h) => h.id === id)
    const src = source ?? target?.source ?? 'global'
    const pid = projectId ?? target?.projectId
    // Optimistic local removal (re-hydrate corrects it on fs-changed).
    hooks.value = hooks.value.filter((h) => !matchKey(h, { id, source: src, projectId: pid }))
    if (!available.value) return
    try {
      const params: Record<string, unknown> = { id, source: src }
      if (pid) params.projectId = pid
      await sc.request('hooks.delete', params)
    } catch (err) {
      console.warn('[hooks] deleteHook failed', err)
    }
  }

  // Flip the enabled flag. Optimistic; the sidecar persists the new state.
  async function toggleHook(hook: Hook): Promise<void> {
    const h = findHook(hook)
    if (!h) return
    h.enabled = !h.enabled
    if (!available.value) return
    try {
      const params: Record<string, unknown> = {
        id: h.id,
        source: h.source ?? 'global',
        enabled: h.enabled,
      }
      if (h.projectId) params.projectId = h.projectId
      await sc.request('hooks.toggle', params)
    } catch (err) {
      console.warn('[hooks] toggleHook failed', err)
    }
  }

  // Spawn the hook once now (smoke test). Prepends the resulting run record to the
  // audit list (cap 20). Browser-dev simulates a successful run.
  async function runHookOnce(hook: Hook): Promise<void> {
    const h = findHook(hook)
    if (!h) return
    if (!available.value) {
      h.recentRuns.unshift({ at: 'Just now', durationMs: 300, exitCode: 0 })
      h.recentRuns = h.recentRuns.slice(0, 20)
      return
    }
    try {
      const params: Record<string, unknown> = { id: h.id, source: h.source ?? 'global' }
      if (h.projectId) params.projectId = h.projectId
      const res = await sc.request<{ record: HookRunRecord }>('hooks.run-once', params)
      if (res.record) {
        h.recentRuns.unshift(res.record)
        h.recentRuns = h.recentRuns.slice(0, 20)
      }
    } catch (err) {
      console.warn('[hooks] runHookOnce failed', err)
      throw err
    }
  }

  // Read the script file a hook command runs (e.g. format-after-edit.sh) so the
  // editor can edit its content. Returns null when the command references no
  // editable script (or it's outside the allowed hook dirs / no bridge).
  async function readHookScript(
    hook: Pick<Hook, 'command' | 'source' | 'projectId'>,
  ): Promise<HookScriptInfo | null> {
    if (!available.value) return null
    try {
      const params: Record<string, unknown> = {
        command: hook.command,
        source: hook.source ?? 'global',
      }
      if (hook.projectId) params.projectId = hook.projectId
      const res = await sc.request<{ script: HookScriptInfo | null }>('hooks.read-script', params)
      return res.script ?? null
    } catch (err) {
      console.warn('[hooks] readHookScript failed', err)
      return null
    }
  }

  async function writeHookScript(
    hook: Pick<Hook, 'command' | 'source' | 'projectId'>,
    content: string,
  ): Promise<void> {
    if (!available.value) return
    try {
      const params: Record<string, unknown> = {
        command: hook.command,
        source: hook.source ?? 'global',
        content,
      }
      if (hook.projectId) params.projectId = hook.projectId
      await sc.request('hooks.write-script', params)
    } catch (err) {
      console.warn('[hooks] writeHookScript failed', err)
      throw err
    }
  }

  // Grant trust to project-tier hooks (ADR 0032 D-8) so they may spawn.
  async function trustHooks(projectId: string, hookIds: string[]): Promise<void> {
    // Optimistic local flip (also the browser-dev path).
    hooks.value.forEach((h) => {
      if (h.projectId === projectId && hookIds.includes(h.id)) h.trusted = true
    })
    if (!available.value) return
    try {
      await sc.request('hooks.trust', { projectId, hookIds })
    } catch (err) {
      console.warn('[hooks] trustHooks failed', err)
    }
  }

  // One-shot LLM config draft (hooks.generate). `currentHook` revises an existing
  // hook; omitting it drafts from scratch. Throws so callers can fall back.
  async function generateHook(
    prompt: string,
    accountId: string,
    currentHook?: Pick<
      Hook,
      'name' | 'description' | 'event' | 'matcher' | 'command' | 'cwd' | 'timeoutMs' | 'runMode'
    >,
  ): Promise<HookConfig> {
    const params: Record<string, unknown> = { prompt, accountId }
    if (currentHook) params.currentHook = currentHook
    const res = await sc.request<{ hook: HookConfig }>('hooks.generate', params)
    return res.hook
  }

  // One-shot LLM script draft (hooks.generate-script) — writes/revises the raw
  // code of the file a hook runs. Throws so callers can fall back.
  async function generateHookScript(
    prompt: string,
    accountId: string,
    opts: { command?: string; currentScript?: string } = {},
  ): Promise<string> {
    const params: Record<string, unknown> = { prompt, accountId }
    if (opts.command) params.command = opts.command
    if (opts.currentScript) params.currentScript = opts.currentScript
    const res = await sc.request<{ content: string }>('hooks.generate-script', params)
    return res.content
  }

  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (!evt) return
        if (evt.type === 'hooks.fs-changed') {
          // Re-hydrate against the same project scope we last loaded.
          const ids = Array.from(
            new Set(hooks.value.filter((h) => h.projectId).map((h) => h.projectId as string)),
          )
          void loadHooks(ids)
          return
        }
        // Live hook-run audit (ADR 0032): prepend the record to the matching
        // hook's recentRuns so the detail view updates without a refetch.
        if (evt.type === 'hook.run') {
          const p = evt.payload as {
            hookId?: string
            source?: HookSource
            projectId?: string
            record?: HookRunRecord
          }
          if (typeof p.hookId !== 'string' || !p.record) return
          const hook = findHook({
            id: p.hookId,
            source: p.source ?? 'global',
            projectId: p.projectId,
          })
          if (!hook) return
          hook.recentRuns.unshift(p.record)
          hook.recentRuns = hook.recentRuns.slice(0, 20)
        }
      })
    } catch {
      unlisten = null
    }
  }

  return {
    // state
    hooks,
    scanReports,
    loaded,
    available,
    // getters
    hookKey,
    hookByKey,
    findHook,
    // actions
    loadHooks,
    saveHook,
    deleteHook,
    toggleHook,
    runHookOnce,
    readHookScript,
    writeHookScript,
    trustHooks,
    generateHook,
    generateHookScript,
  }
})
