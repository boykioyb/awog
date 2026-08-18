import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { primeProjectsCache } from '~/composables/useWorkspaceData'
import type { Project, ProjectLlmDefaults, ProjectsListResponse, ProviderName } from '~/types'

// Projects store (ui-next) — dual-path live. The project entity is the registered
// local folder roster persisted by the sidecar (~/.awog/projects/<id>.json).
// When the Electron bridge is available `hydrate()` loads the real list over IPC
// and every action round-trips to the sidecar; without it the list stays EMPTY (no
// seed data — an invented project reads as one the user linked). Mirrors
// stores/skills.ts dual-path pattern (the reference store), trimmed to the single
// global project namespace projects use.
//
// COMPAT: useProjects() (the Sessions/library config helper) + the git store both
// read the projects.list contract — this store owns the Project entity but never
// changes that wire shape. After every hydrate it primes the shared
// useWorkspaceData cache so name→path resolution stays consistent across surfaces.

// Draft accepted by linkProject — an existing local folder registered as a project.
export interface LinkProjectInput {
  name: string
  path: string
  description: string
  language: string
  gitRemote: string
  gitBranch: string
}

// Draft accepted by cloneProject — clone a git remote into destPath, then register.
export interface CloneProjectInput {
  name: string
  destPath: string
  gitRemote: string
  description: string
  language: string
}

interface ProjectUpsertResponse {
  project: Project
}
interface ProjectCloneResponse {
  project: Project
}

// Best-effort folder inspection used to pre-fill the new-project form.
export interface ProjectInspectResult {
  name: string
  description: string
  language: string
  gitRemote: string
  gitBranch: string
  path: string
}

// Best-effort git-remote inspection (clone form pre-fill). `detected` is true only
// when repo metadata (language/description) was actually resolved via gh; false →
// name-only (non-GitHub remote, or gh unavailable / no access).
export interface RemoteInspectResult {
  name: string
  language: string
  description: string
  defaultBranch: string
  detected: boolean
}

// A sidecar-safe project id: lowercase alphanumeric + hyphens, 3–64 chars
// (matches projects.upsert ProjectIdSchema). Derive from the name, then guarantee
// uniqueness within the current roster.
function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return base.length >= 3 ? base.slice(0, 64) : `prj-${base}`.slice(0, 64)
}

function nowIso(): string {
  return new Date().toISOString()
}

export const useProjectsStore = defineStore('projects', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const projects = ref<Project[]>([])
  const loaded = ref(false)

  // Make a unique sidecar-safe id from a project name against the current roster.
  function uniqueId(name: string): string {
    const base = slugifyName(name)
    if (!projects.value.some((p) => p.id === base)) return base
    let n = 2
    let candidate = `${base}-${n}`.slice(0, 64)
    while (projects.value.some((p) => p.id === candidate)) {
      n += 1
      candidate = `${base}-${n}`.slice(0, 64)
    }
    return candidate
  }

  const projectById = (id: string): Project | undefined => projects.value.find((p) => p.id === id)

  // Load the registered project roster. No bridge → stays empty. After a
  // successful live load we prime the shared useWorkspaceData cache so name→path
  // resolution stays in sync for git / sessions / workspace tabs.
  async function hydrate(): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      const res = await sc.request<ProjectsListResponse>('projects.list', {})
      projects.value = Array.isArray(res.projects) ? res.projects : []
      primeProjectsCache(projects.value.map((p) => ({ id: p.id, name: p.name, path: p.path })))
    } catch (err) {
      console.warn('[projects] hydrate failed', err)
    } finally {
      loaded.value = true
    }
  }

  // Inspect a local folder for new-project form pre-fill (best-effort). Returns
  // null in browser-dev or on failure so the caller falls back to manual entry.
  async function inspectPath(path: string): Promise<ProjectInspectResult | null> {
    if (!available.value || !path) return null
    try {
      return await sc.request<ProjectInspectResult>('projects.inspect', { path })
    } catch (err) {
      console.warn('[projects] inspect failed', err)
      return null
    }
  }

  // Inspect a git REMOTE (clone form pre-fill): repo name always, + language /
  // description / default branch for GitHub repos via `gh repo view`. Best-effort:
  // null in browser-dev or on failure so the caller falls back to name-only.
  async function inspectRemote(gitRemote: string): Promise<RemoteInspectResult | null> {
    if (!available.value || !gitRemote.trim()) return null
    try {
      return await sc.request<RemoteInspectResult>('projects.inspectRemote', { gitRemote })
    } catch (err) {
      console.warn('[projects] inspectRemote failed', err)
      return null
    }
  }

  // AI-generate a one-line project description (clone/link form). Returns the
  // generated text, or null in browser-dev / on failure so the UI keeps the field.
  async function generateDescription(input: {
    name: string
    language?: string
    gitRemote?: string
    hint?: string
  }): Promise<string | null> {
    if (!available.value || !input.name.trim()) return null
    const res = await sc.request<{ description: string }>('projects.generateDescription', {
      name: input.name,
      ...(input.language ? { language: input.language } : {}),
      ...(input.gitRemote ? { gitRemote: input.gitRemote } : {}),
      ...(input.hint ? { hint: input.hint } : {}),
    })
    return res.description
  }

  // Register an existing local folder as a project. The sidecar validates the
  // path exists + is a directory; it throws an Error the caller surfaces.
  async function linkProject(input: LinkProjectInput): Promise<Project> {
    // Dedup by PATH: if this folder is already registered, reuse that project instead
    // of minting a suffixed id ("…-2") for the same folder. Without this, re-linking a
    // folder split it into two same-named projects — the original kept the sessions
    // while the duplicate's Sessions tab looked empty (only the overview's name-match
    // borrowed the original's sessions). Trailing slash normalized so "/x" == "/x/".
    const norm = (p: string) => p.replace(/\/+$/, '')
    const existing = projects.value.find((p) => norm(p.path) === norm(input.path))
    if (existing) return existing

    const draft: Project = {
      id: uniqueId(input.name),
      name: input.name,
      path: input.path,
      description: input.description,
      gitRemote: input.gitRemote,
      gitBranch: input.gitBranch,
      language: input.language,
      createdAt: nowIso(),
    }
    if (available.value) {
      const res = await sc.request<ProjectUpsertResponse>('projects.upsert', {
        project: draft,
        mode: 'create',
      })
      projects.value = [res.project, ...projects.value]
      primeProjectsCache(projects.value.map((p) => ({ id: p.id, name: p.name, path: p.path })))
      return res.project
    }
    projects.value = [draft, ...projects.value]
    return draft
  }

  // Clone a git remote into destPath, then register the result. The sidecar runs
  // git clone with an arg array (no shell), enforces a remote-scheme allowlist,
  // and rejects when destPath already exists. Throws on failure.
  async function cloneProject(input: CloneProjectInput): Promise<Project> {
    const id = uniqueId(input.name)
    const createdAt = nowIso()
    if (available.value) {
      const res = await sc.request<ProjectCloneResponse>('projects.clone', {
        id,
        name: input.name,
        gitRemote: input.gitRemote,
        destPath: input.destPath,
        description: input.description,
        language: input.language,
        createdAt,
      })
      projects.value = [res.project, ...projects.value]
      primeProjectsCache(projects.value.map((p) => ({ id: p.id, name: p.name, path: p.path })))
      return res.project
    }
    // Browser-dev: pretend the clone succeeded.
    const local: Project = {
      id,
      name: input.name,
      path: input.destPath,
      description: input.description,
      gitRemote: input.gitRemote,
      gitBranch: 'main',
      language: input.language,
      createdAt,
    }
    projects.value = [local, ...projects.value]
    return local
  }

  // Update an existing project record. Replace the array element wholesale (not
  // Object.assign) so a removed optional field — e.g. clearing `llmDefaults` on
  // "reset to app default" — actually disappears from the store, not just disk.
  async function updateProject(project: Project): Promise<Project> {
    const apply = (saved: Project) => {
      const idx = projects.value.findIndex((p) => p.id === saved.id)
      if (idx >= 0) projects.value[idx] = saved
    }
    if (available.value) {
      const res = await sc.request<ProjectUpsertResponse>('projects.upsert', {
        project,
        mode: 'update',
      })
      apply(res.project)
      primeProjectsCache(projects.value.map((p) => ({ id: p.id, name: p.name, path: p.path })))
      return res.project
    }
    apply(project)
    return project
  }

  async function deleteProject(id: string): Promise<void> {
    projects.value = projects.value.filter((p) => p.id !== id)
    if (!available.value) return
    try {
      await sc.request('projects.delete', { id })
      primeProjectsCache(projects.value.map((p) => ({ id: p.id, name: p.name, path: p.path })))
    } catch (err) {
      console.warn('[projects] delete failed', err)
    }
  }

  // Bulk-set the default model on EVERY project's llmDefaults (Settings →
  // Defaults → "model for all projects"). Overwrites each project's
  // provider/model with the chosen pair; drops accountId (falls to the
  // provider's active account, since the provider may change) but preserves
  // provider-agnostic per-project choices (MCP whitelist, response style, and
  // an explicitly pinned thinking level). Thinking level is NOT frozen from the
  // global here — it keeps following the global default unless the project pinned
  // its own.
  //
  // RESILIENT: `projects.upsert` re-validates the project's path exists on disk,
  // so a project whose folder was moved/deleted throws. We DON'T let one bad
  // project abort the whole batch — catch per project, tally ok/failed, and
  // return the first error so the caller can surface it when nothing applied.
  async function applyModelToAllProjects(input: {
    provider: ProviderName
    modelId: string
  }): Promise<{ ok: number; failed: number; firstError?: string }> {
    let ok = 0
    let failed = 0
    let firstError: string | undefined
    // Snapshot first — updateProject replaces entries in `projects` in place.
    for (const p of [...projects.value]) {
      const prev = p.llmDefaults
      const llmDefaults: ProjectLlmDefaults = {
        provider: input.provider,
        modelId: input.modelId,
      }
      // Thinking level follows the GLOBAL default unless the project explicitly
      // pinned its own — carry an existing pin forward, but never freeze the global
      // level in (that's the bug that stopped a later global change from
      // propagating). Re-running this therefore also strips a previously frozen
      // level, doubling as a one-click remediation.
      if (prev?.level !== undefined) llmDefaults.level = prev.level
      if (prev?.mcpServerIds !== undefined) llmDefaults.mcpServerIds = prev.mcpServerIds
      if (prev?.responseStyle !== undefined) llmDefaults.responseStyle = prev.responseStyle
      if (prev?.responseStyleNoMarkdown !== undefined)
        llmDefaults.responseStyleNoMarkdown = prev.responseStyleNoMarkdown
      try {
        await updateProject({ ...p, llmDefaults })
        ok += 1
      } catch (err) {
        failed += 1
        const msg = err instanceof Error ? err.message : String(err)
        if (!firstError) firstError = msg
        console.warn('[projects] applyModelToAllProjects: skipped', p.id, msg)
      }
    }
    return { ok, failed, firstError }
  }

  return {
    // state
    projects,
    loaded,
    available,
    // getters
    projectById,
    // actions
    hydrate,
    inspectPath,
    inspectRemote,
    generateDescription,
    linkProject,
    cloneProject,
    updateProject,
    applyModelToAllProjects,
    deleteProject,
  }
})
