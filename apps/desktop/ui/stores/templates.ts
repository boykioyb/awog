import { defineStore, acceptHMRUpdate } from 'pinia'
import type { ConfigKind, ProjectTemplate, TemplateEntityRef, TemplateInstallResult } from '~/types'

// Project Templates (ADR 0036). A bounded context wrapping the `templates.*`
// RPC: bundles of project-tier config (agents/skills/hooks/rules/commands) that
// the user can export from one project and install into another.
//
// Browser-dev fallback: with no sidecar the store degrades to an in-memory list
// so the /templates page stays browsable (mirrors stores/workflows.ts).

// One entity selected for a new template — kind + id + which tier it lives in.
export type TemplateEntitySpec = {
  kind: ConfigKind
  id: string
  source: 'global' | 'project'
  projectId?: string
}

export const useTemplatesStore = defineStore('templates', () => {
  const templates = ref<ProjectTemplate[]>([])
  const hydrated = ref(false)

  const templateById = (id: string): ProjectTemplate | undefined =>
    templates.value.find((tpl) => tpl.id === id)

  // Pull the full template list from the sidecar. Idempotent — guarded so repeat
  // page mounts don't re-fetch. Sidecar offline → mark hydrated, keep whatever is
  // already in memory.
  async function hydrate(): Promise<void> {
    if (hydrated.value) return
    const sidecar = useSidecar()
    if (!sidecar.available) {
      hydrated.value = true
      return
    }
    try {
      const res = await sidecar.request<{ templates: ProjectTemplate[] }>('templates.list')
      templates.value = res.templates ?? []
      hydrated.value = true
    } catch (err) {
      console.warn('[templates] hydrate failed', err)
    }
  }

  // Re-fetch unconditionally (manual refresh button / after install or delete).
  async function refresh(): Promise<void> {
    hydrated.value = false
    await hydrate()
  }

  async function get(id: string): Promise<ProjectTemplate | undefined> {
    const sidecar = useSidecar()
    if (!sidecar.available) return templateById(id)
    try {
      const res = await sidecar.request<{ template: ProjectTemplate }>('templates.get', { id })
      const idx = templates.value.findIndex((tpl) => tpl.id === res.template.id)
      if (idx >= 0) templates.value[idx] = res.template
      else templates.value.unshift(res.template)
      return res.template
    } catch (err) {
      console.warn('[templates] get failed', err)
      return templateById(id)
    }
  }

  // Export a new template from a project's entities. The sidecar copies each
  // entity file into the bundle + writes the manifest; the created template is
  // pushed onto the local list so the page reflects it immediately.
  async function create(params: {
    name: string
    description: string
    sourceProjectId?: string
    entities: TemplateEntitySpec[]
  }): Promise<ProjectTemplate> {
    const sidecar = useSidecar()
    if (!sidecar.available) {
      // Browser-dev: synthesize a local-only template so the UI flow is testable.
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
    const res = await sidecar.request<{ template: ProjectTemplate }>('templates.create', params)
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
    const sidecar = useSidecar()
    if (!sidecar.available) {
      return { installed: [], skipped: [] }
    }
    const res = await sidecar.request<{ result: TemplateInstallResult }>(
      'templates.install',
      params,
    )
    return res.result
  }

  async function remove(id: string): Promise<void> {
    const sidecar = useSidecar()
    templates.value = templates.value.filter((tpl) => tpl.id !== id)
    if (!sidecar.available) return
    try {
      await sidecar.request('templates.delete', { id })
    } catch (err) {
      console.warn('[templates] delete failed', err)
    }
  }

  return {
    templates,
    hydrated,
    templateById,
    hydrate,
    refresh,
    get,
    create,
    install,
    remove,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTemplatesStore, import.meta.hot))
}
