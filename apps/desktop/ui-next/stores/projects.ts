import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { primeProjectsCache } from '~/composables/useWorkspaceData'
import type { Project, ProjectsListResponse } from '~/types'

// Projects store (ui-next) — dual-path live. The project entity is the registered
// local folder roster persisted by the sidecar (~/.awog/projects/<id>.json).
// When the Electron bridge is available `hydrate()` loads the real list over IPC
// and every action round-trips to the sidecar; browser-dev seeds INITIAL_PROJECTS
// and mutates locally. Mirrors stores/skills.ts dual-path pattern (the reference
// store), trimmed to the single global project namespace projects use.
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

// Browser-dev seed so the page is browsable without an Electron shell. Mirrors
// the old UI INITIAL_PROJECTS shape (apps/desktop/ui/utils/initial-data.ts).
function mockProjects(): Project[] {
  return [
    {
      id: 'awog',
      name: 'awog',
      path: '~/KyroTech/Projects/awog',
      description: 'Artifact Workflow Orchestrate Guild — local-first AI Team OS.',
      gitRemote: 'git@github.com:awog/awog.git',
      gitBranch: 'main',
      language: 'TypeScript',
      createdAt: '2025-01-04T09:00:00.000Z',
    },
    {
      id: 'vbsec',
      name: 'vbsec',
      path: '~/KyroTech/Projects/vbsec',
      description: 'Vulnerability rule catalog for AWOG security audits.',
      gitRemote: 'git@github.com:tanviet12/vbsec.git',
      gitBranch: 'main',
      language: 'Markdown',
      createdAt: '2025-02-11T10:30:00.000Z',
    },
    {
      id: 'spacelinks-web',
      name: 'spacelinks-web',
      path: '~/work/spacelinks-web',
      description: 'Spacelinks marketing site + API.',
      gitRemote: '',
      gitBranch: 'main',
      language: 'Vue',
      createdAt: '2025-03-20T08:15:00.000Z',
    },
  ]
}

export const useProjectsStore = defineStore('projects', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const projects = ref<Project[]>(sc.available ? [] : mockProjects())
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

  // Load the registered project roster. Browser-dev keeps the mock seed. After a
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
    linkProject,
    cloneProject,
    updateProject,
    deleteProject,
  }
})
