import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'

// Commands store — dual-path live slash-command library (2-tier per-file
// Markdown, ADR 0034/0035). When the Electron bridge is available `loadCommands()`
// scans the user/global tier + every passed project tier over IPC, and a
// `commands.fs-changed` subscription re-hydrates when files are touched outside
// the app; without the bridge the list stays empty (no seed data). Mirrors
// stores/skills.ts (the reference) dual-path pattern: inline slice types,
// readonly-state + named async actions.

export type CommandSource = 'global' | 'project'

// Command entity (mirror of sidecar Command — apps/desktop/sidecar/src/types/shared.ts).
// NOT imported from the sidecar package; the store owns its own minimal slice.
// `body` is the prompt template, with `$ARGUMENTS` / `$1`…`$9` substituted on send.
export type Command = {
  // Slug = the name typed after `/` (subdir namespacing uses ':').
  id: string
  name: string
  description: string
  // Prompt template; `$ARGUMENTS` / `$1`…`$9` substituted on send.
  body: string
  // Optional Claude-Code frontmatter passthrough.
  argumentHint?: string
  allowedTools?: string
  model?: string
  enabled: boolean
  // Location tags — set by the sidecar on list/load; default to global tier.
  source?: CommandSource
  projectId?: string
  // Imported Claude Code command: editable in-app, flagged for the Lock badge.
  readOnly?: boolean
}

// Per-tier scan report (1 entry per scanned dir). Surfaces resolved paths +
// counts so a misconfigured HOME / missing dir is diagnosable.
export type CommandScanReport = {
  dir: string
  source: CommandSource
  found: number
  projectId?: string
}

// Draft a save accepts — the full Command shape.
export type CommandInput = Command

type CommandsListResponse = { commands: Command[]; reports?: CommandScanReport[] }
type CommandUpsertResponse = { command: Command }
// commands.generate returns a content-only draft (no storage metadata).
type CommandGenerateResponse = {
  command: { name: string; description: string; argumentHint?: string; body: string }
}

// Composite identity — a command is keyed by (source, projectId, id) so a project
// command and a global command can share an id without colliding.
const matchKey = (
  c: Command,
  t: { source?: CommandSource; projectId?: string; id: string },
): boolean =>
  (c.source ?? 'global') === (t.source ?? 'global') &&
  (c.projectId ?? undefined) === (t.projectId ?? undefined) &&
  c.id === t.id

export const useCommandsStore = defineStore('commands', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const commands = ref<Command[]>([])
  const scanReports = ref<CommandScanReport[]>([])
  const loaded = ref(false)

  let unlisten: UnlistenFn | null = null

  // Stable composite key for list selection / dedupe.
  const commandKey = (c: Pick<Command, 'id' | 'source' | 'projectId'>): string =>
    `${c.source ?? 'global'}|${c.projectId ?? ''}|${c.id}`

  const commandByKey = (key: string): Command | undefined =>
    commands.value.find((c) => commandKey(c) === key)

  // Scan the user/global tier + every passed project tier. Default scope is the
  // global tier only (the page passes projectIds when it has a project roster).
  async function loadCommands(projectIds?: string[]): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      // Pass an explicit object (never `undefined`) — the IPC boundary maps
      // undefined params → null and the sidecar zod schema rejects null.
      const ids = projectIds ?? []
      const params = ids.length > 0 ? { projectIds: ids } : {}
      const res = await sc.request<CommandsListResponse>('commands.list', params)
      commands.value = Array.isArray(res.commands) ? res.commands : []
      scanReports.value = Array.isArray(res.reports) ? res.reports : []
    } catch (err) {
      console.warn('[commands] loadCommands failed', err)
    } finally {
      loaded.value = true
      void subscribe()
    }
  }

  // Create-or-update. The (source, projectId, id) triple is the identity; an
  // existing match → update mode. Returns the persisted command. Browser-dev
  // mutates the local list only.
  async function saveCommand(data: CommandInput): Promise<Command> {
    const source = data.source ?? 'global'
    const targetKey = { source, projectId: data.projectId, id: data.id }
    const existing = commands.value.find((c) => matchKey(c, targetKey))
    const isUpdate = !!existing
    const payload: Command = { ...data, source }

    if (available.value) {
      const res = await sc.request<CommandUpsertResponse>('commands.upsert', {
        command: payload,
        mode: isUpdate ? 'update' : 'create',
      })
      const hit = commands.value.find((c) => matchKey(c, res.command))
      if (hit) Object.assign(hit, res.command)
      else commands.value.push(res.command)
      return res.command
    }

    // No bridge: keep the change in memory only.
    if (existing) Object.assign(existing, payload)
    else commands.value.push({ ...payload })
    return payload
  }

  async function deleteCommand(
    id: string,
    source?: CommandSource,
    projectId?: string,
  ): Promise<void> {
    const target = commands.value.find((c) => c.id === id)
    const src = source ?? target?.source ?? 'global'
    const pid = projectId ?? target?.projectId
    // Optimistic local removal (re-hydrate corrects it on fs-changed).
    commands.value = commands.value.filter((c) => !matchKey(c, { id, source: src, projectId: pid }))
    if (!available.value) return
    try {
      const params: Record<string, unknown> = { id, source: src }
      if (pid) params.projectId = pid
      await sc.request('commands.delete', params)
    } catch (err) {
      console.warn('[commands] deleteCommand failed', err)
    }
  }

  // Flip the enabled flag. Optimistic; persists the new state. Imported (readOnly)
  // commands can't be toggled — the caller guards this, but it's a no-op here too.
  async function toggleCommand(
    id: string,
    source?: CommandSource,
    projectId?: string,
  ): Promise<void> {
    const src = source ?? 'global'
    const c = commands.value.find((x) => matchKey(x, { id, source: src, projectId }))
    if (!c || c.readOnly) return
    c.enabled = !c.enabled
    if (!available.value) return
    try {
      const params: Record<string, unknown> = {
        id,
        source: c.source ?? 'global',
        enabled: c.enabled,
      }
      if (c.projectId) params.projectId = c.projectId
      await sc.request('commands.toggle', params)
    } catch (err) {
      console.warn('[commands] toggleCommand failed', err)
    }
  }

  // Duplicate a command into a new slug (`-copy` suffix, deduped). Same tier. The
  // copy is created via saveCommand in create mode.
  async function duplicateCommand(source: Command): Promise<Command> {
    const base = `${source.id}-copy`
    let candidate = base
    let n = 2
    while (
      commands.value.some((c) =>
        matchKey(c, {
          source: source.source ?? 'global',
          projectId: source.projectId,
          id: candidate,
        }),
      )
    ) {
      candidate = `${base}-${n}`
      n += 1
    }
    const copy: CommandInput = {
      ...source,
      id: candidate,
      name: `${source.name}-copy`,
      readOnly: false,
    }
    return saveCommand(copy)
  }

  // One-shot LLM draft from a natural-language prompt (commands.generate). Returns
  // a content-only draft (no source/projectId — the editor picks the tier). When
  // `current` is passed the model REVISES that command. Throws on failure so the
  // caller can surface the error.
  async function generateCommand(
    prompt: string,
    accountId: string,
    current?: { name: string; description: string; argumentHint?: string; body: string },
  ): Promise<{ name: string; description: string; argumentHint: string; body: string }> {
    const params: Record<string, unknown> = { prompt, accountId }
    if (current) params.currentCommand = current
    const res = await sc.request<CommandGenerateResponse>('commands.generate', params)
    return {
      name: res.command.name,
      description: res.command.description ?? '',
      argumentHint: res.command.argumentHint ?? '',
      body: res.command.body,
    }
  }

  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (!evt || evt.type !== 'commands.fs-changed') return
        // Re-hydrate against the same project scope we last loaded. Project ids
        // are derived from the current list so the scan stays consistent.
        const ids = Array.from(
          new Set(commands.value.filter((c) => c.projectId).map((c) => c.projectId as string)),
        )
        void loadCommands(ids)
      })
    } catch {
      unlisten = null
    }
  }

  return {
    // state
    commands,
    scanReports,
    loaded,
    available,
    // getters
    commandKey,
    commandByKey,
    // actions
    loadCommands,
    saveCommand,
    deleteCommand,
    toggleCommand,
    duplicateCommand,
    generateCommand,
  }
})
