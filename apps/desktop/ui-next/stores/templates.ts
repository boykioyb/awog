import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'

// Project Templates store — dual-path live (ADR 0036). Bundles of project-tier
// config (agents/skills/hooks/rules/commands — NO MCP) the user exports from a
// project and installs into another. Wraps the `templates.*` RPC; without the
// bridge it degrades to an empty in-memory list (no seed data).
//
// Mirrors the ui-next reference store (stores/skills.ts): inline slice types,
// readonly-state + named async actions.

// The 5 config-entity kinds a template can bundle (NO MCP, ADR 0036).
export type ConfigKind = 'agent' | 'skill' | 'hook' | 'rule' | 'command'

// Canonical kind order — drives the include checklist + detail grouping.
export const KIND_ORDER: readonly ConfigKind[] = ['agent', 'skill', 'hook', 'rule', 'command']

// One bundled entity inside a template (kind + slug + file path in the bundle).
export type TemplateEntityRef = {
  kind: ConfigKind
  id: string
  file: string
}

// A saved template bundle (mirror of sidecar ProjectTemplate). The store owns
// its own minimal slice — NOT imported from the sidecar package.
//
// `version`/`sourceUrl`/`sourceRef`/`installedAt` only exist on bundles fetched
// from a source (WP10): they come from the bundle's `.install.json` and are what
// makes a template a re-installable plugin. A locally exported bundle has none.
export type ProjectTemplate = {
  id: string
  name: string
  description: string
  createdAt: string
  sourceProjectId?: string
  version?: string
  sourceUrl?: string
  sourceRef?: string
  installedAt?: string
  entities: TemplateEntityRef[]
}

// ─── Update from source (WP10) ───────────────────────────────────────────────

// Per-entity verdict of `templates.checkUpdate`, comparing the source against the
// baseline recorded at install time:
//   status        — what the SOURCE did (added / changed / removed / unchanged)
//   localModified — the user edited this entity after installing
//   conflict      — both at once; the engine refuses to overwrite without a choice
export type TemplateEntityStatus = 'added' | 'changed' | 'removed' | 'unchanged'

export type TemplateEntityDiff = {
  kind: ConfigKind
  id: string
  status: TemplateEntityStatus
  localModified: boolean
  conflict: boolean
}

export type TemplateUpdateCheck = {
  id: string
  hasRemote: boolean
  hasUpdate: boolean
  conflicts: number
  currentVersion?: string
  remoteVersion?: string
  sourceUrl?: string
  sourceRef?: string
  installedAt?: string
  checkedAt: string
  entities: TemplateEntityDiff[]
}

export type ConflictChoice = 'keepLocal' | 'takeRemote'

export type TemplateUpdateResolution = { kind: ConfigKind; id: string; choice: ConflictChoice }

export type TemplateEntityChange = {
  kind: ConfigKind
  id: string
  action: 'added' | 'updated' | 'removed' | 'keptLocal'
}

export type TemplateUpdateResult =
  | { status: 'no-remote' }
  | { status: 'up-to-date' }
  | { status: 'conflicts'; conflicts: TemplateEntityDiff[] }
  | { status: 'updated'; version?: string; applied: TemplateEntityChange[] }

// One entity selected for a new template — kind + id + tier metadata.
export type TemplateEntitySpec = {
  kind: ConfigKind
  id: string
  source: 'global' | 'project'
  projectId?: string
}

// Install report (installed/skipped per kind).
export type TemplateInstallResult = {
  installed: { kind: ConfigKind; id: string }[]
  skipped: { kind: ConfigKind; id: string; reason: string }[]
}

// Remote-fetch report (imported bundles + skipped ids).
export type TemplateFetchResult = {
  imported: ProjectTemplate[]
  skipped: { id: string; reason: string }[]
}

type TemplatesListResponse = { templates: ProjectTemplate[] }
type TemplateGetResponse = { template: ProjectTemplate }
type TemplateCreateResponse = { template: ProjectTemplate }
type TemplateInstallResponse = { result: TemplateInstallResult }
type TemplateCheckUpdateResponse = { check: TemplateUpdateCheck }
type TemplateUpdateResponse = { result: TemplateUpdateResult }

// Entity-list RPCs share the `{ projectIds }` param + `{ <kind>s }` response,
// each item carrying `source` + `projectId`. We resolve a source project's
// project-tier entities directly here (the sibling stores are owned by other
// features — we never import them).
type EntityListItem = { id: string; source: 'global' | 'project'; projectId?: string }

export const useTemplatesStore = defineStore('templates', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const templates = ref<ProjectTemplate[]>([])
  const loaded = ref(false)

  const templateById = (id: string): ProjectTemplate | undefined =>
    templates.value.find((tpl) => tpl.id === id)

  // Pull the full template list from the sidecar. Sidecar offline → mark loaded,
  // keep whatever is already in memory.
  async function loadTemplates(): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      const res = await sc.request<TemplatesListResponse>('templates.list', {})
      templates.value = Array.isArray(res.templates) ? res.templates : []
    } catch (err) {
      console.warn('[templates] loadTemplates failed', err)
    } finally {
      loaded.value = true
    }
  }

  // Re-fetch a single template and merge into the list (after install/edit).
  async function get(id: string): Promise<ProjectTemplate | undefined> {
    if (!available.value) return templateById(id)
    try {
      const res = await sc.request<TemplateGetResponse>('templates.get', { id })
      const idx = templates.value.findIndex((tpl) => tpl.id === res.template.id)
      if (idx >= 0) templates.value[idx] = res.template
      else templates.value.unshift(res.template)
      return res.template
    } catch (err) {
      console.warn('[templates] get failed', err)
      return templateById(id)
    }
  }

  // Export a new template from a project's project-tier entities. The sidecar
  // copies each entity file into the bundle + writes the manifest; the created
  // template is unshifted onto the local list.
  async function create(params: {
    name: string
    description: string
    sourceProjectId?: string
    entities: TemplateEntitySpec[]
  }): Promise<ProjectTemplate> {
    if (!available.value) {
      // Browser-dev: synthesize a local-only template so the flow is testable.
      const tpl: ProjectTemplate = {
        id: `tpl-${Date.now()}`,
        name: params.name,
        description: params.description,
        createdAt: new Date().toISOString(),
        ...(params.sourceProjectId ? { sourceProjectId: params.sourceProjectId } : {}),
        entities: params.entities.map<TemplateEntityRef>((e) => ({
          kind: e.kind,
          id: e.id,
          file: `${e.kind}s/${e.id}`,
        })),
      }
      templates.value.unshift(tpl)
      return tpl
    }
    const res = await sc.request<TemplateCreateResponse>('templates.create', params)
    templates.value.unshift(res.template)
    return res.template
  }

  // Install a template into a target project's `project` tier. Returns the
  // install report (installed/skipped). Conflict policy defaults to 'skip'.
  async function install(params: {
    templateId: string
    targetProjectId: string
    conflictPolicy?: 'skip' | 'overwrite'
  }): Promise<TemplateInstallResult> {
    if (!available.value) return { installed: [], skipped: [] }
    const res = await sc.request<TemplateInstallResponse>('templates.install', params)
    return res.result
  }

  // Import template bundle(s) from a public GitHub folder (ADR 0037). Imported
  // bundles are merged to the front of the local list (replacing any same-id
  // entry). Requires the sidecar — there is no browser-dev network path.
  async function fetchRemote(url: string, overwrite = false): Promise<TemplateFetchResult> {
    if (!available.value) {
      throw new Error('Fetching from GitHub requires the desktop app (sidecar offline)')
    }
    const res = await sc.request<TemplateFetchResult>('templates.fetchRemote', { url, overwrite })
    for (const tpl of res.imported) {
      const idx = templates.value.findIndex((t) => t.id === tpl.id)
      if (idx >= 0) templates.value.splice(idx, 1)
      templates.value.unshift(tpl)
    }
    return res
  }

  // Ask a bundle's source whether it has a newer version (WP10). Content is
  // compared by hash, so a source that forgot to bump its version label is still
  // detected. Never writes anything.
  async function checkUpdate(id: string): Promise<TemplateUpdateCheck> {
    if (!available.value) {
      return {
        id,
        hasRemote: false,
        hasUpdate: false,
        conflicts: 0,
        checkedAt: new Date().toISOString(),
        entities: [],
      }
    }
    const res = await sc.request<TemplateCheckUpdateResponse>('templates.checkUpdate', { id })
    return res.check
  }

  // Re-install a bundle from its source. Entities the user edited locally that
  // the source also touched need an explicit `keepLocal`/`takeRemote` choice —
  // without one the engine writes nothing and answers `status: 'conflicts'`.
  async function update(
    id: string,
    resolutions: TemplateUpdateResolution[] = [],
  ): Promise<TemplateUpdateResult> {
    if (!available.value) return { status: 'no-remote' }
    const res = await sc.request<TemplateUpdateResponse>('templates.update', { id, resolutions })
    if (res.result.status === 'updated') await get(id)
    return res.result
  }

  async function remove(id: string): Promise<void> {
    // Optimistic local removal.
    templates.value = templates.value.filter((tpl) => tpl.id !== id)
    if (!available.value) return
    try {
      await sc.request('templates.delete', { id })
    } catch (err) {
      console.warn('[templates] remove failed', err)
    }
  }

  // Resolve a source project's project-tier entities (all 5 kinds) via the
  // entity-list RPCs. Used by the Save-as dialog to build the include checklist.
  // Browser-dev returns an empty bundle (no live entity stores to read).
  async function resolveProjectEntities(projectId: string): Promise<TemplateEntitySpec[]> {
    if (!available.value || !projectId) return []
    const out: TemplateEntitySpec[] = []
    const kinds: { kind: ConfigKind; method: string; key: string }[] = [
      { kind: 'agent', method: 'agents.list', key: 'agents' },
      { kind: 'skill', method: 'skills.list', key: 'skills' },
      { kind: 'hook', method: 'hooks.list', key: 'hooks' },
      { kind: 'rule', method: 'rules.list', key: 'rules' },
      { kind: 'command', method: 'commands.list', key: 'commands' },
    ]
    await Promise.all(
      kinds.map(async ({ kind, method, key }) => {
        try {
          const res = await sc.request<Record<string, EntityListItem[]>>(method, {
            projectIds: [projectId],
          })
          const items = Array.isArray(res[key]) ? res[key] : []
          for (const it of items) {
            if (it.source === 'project' && it.projectId === projectId) {
              out.push({ kind, id: it.id, source: 'project', projectId })
            }
          }
        } catch (err) {
          console.warn(`[templates] resolveProjectEntities ${method} failed`, err)
        }
      }),
    )
    return out
  }

  return {
    // state
    templates,
    loaded,
    available,
    // getters
    templateById,
    // actions
    loadTemplates,
    get,
    create,
    install,
    fetchRemote,
    checkUpdate,
    update,
    remove,
    resolveProjectEntities,
  }
})
