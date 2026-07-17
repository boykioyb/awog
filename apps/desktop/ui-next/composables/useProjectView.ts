import { computed, type ComputedRef } from 'vue'
import { useProjectsStore } from '~/stores/projects'
import { useSessionsStore } from '~/stores/sessions'
import { useTasksStore } from '~/stores/tasks'
import { useAgentsStore } from '~/stores/agents'
import { useGitStore } from '~/stores/git'
import { githubSlugFromRemote, type ProjectRepo, type ProjectView } from '~/components/project/data'

// Derive the compact overview view-model (`ProjectView`) for a project id from the
// live stores (entity + git repos + agents/sessions/tasks). Shared single source so
// both the /projects page-controller (useProjectsPage) and the session-side Project
// quick-view modal (useProjectModal) render the same overview. Read-only: it never
// re-points the git store (that would disturb the Git page's active project) — dirty
// /ahead numbers surface only for the project the Git page already tracks.
export function useProjectView(getProjectId: () => string | null): ComputedRef<ProjectView | null> {
  const projectsStore = useProjectsStore()
  const sessionsStore = useSessionsStore()
  const tasksStore = useTasksStore()
  const agentsStore = useAgentsStore()
  const gitStore = useGitStore()

  return computed<ProjectView | null>(() => {
    const id = getProjectId()
    if (!id) return null
    const p = projectsStore.projectById(id)
    if (!p) return null

    const ghSlug = githubSlugFromRemote(p.gitRemote)

    // Single-repo derivation from the entity. Dirty/ahead are surfaced only when
    // the Git page already tracks this project (no cross-page mutation here).
    const repos: ProjectRepo[] = []
    if (p.gitRemote || p.gitBranch) {
      const tracksThis = gitStore.currentProjectId === p.id
      const repo: ProjectRepo = {
        n: p.name,
        br: tracksThis && gitStore.branch ? gitStore.branch : p.gitBranch || 'main',
      }
      if (ghSlug) repo.gh = ghSlug
      if (tracksThis) {
        const dirty = gitStore.staged.length + gitStore.unstaged.length
        if (dirty > 0) repo.dirty = dirty
        if (gitStore.ahead > 0) repo.ahead = gitStore.ahead
      }
      repos.push(repo)
    }

    const projectAgents = agentsStore.agents
      .filter((a) => a.source === 'project' && a.projectId === p.id)
      .map((a) => a.name || a.id)

    // Match sessions to this project by its canonical id, plus a fallback by NAME for
    // legacy sessions that stored the name as projectId — but ONLY when the name
    // uniquely identifies a project. Otherwise two same-named projects would each
    // "borrow" the other's sessions in the overview while the Sessions tab (strict id)
    // showed them empty — the split-project bug. (linkProject now dedups by path too.)
    const nameUnique = projectsStore.projects.filter((x) => x.name === p.name).length === 1
    const sessions = sessionsStore.sessions.filter(
      (s) => s.project === p.id || (nameUnique && s.project === p.name),
    )
    const ses = sessions.slice(0, 6).map((s) => ({ id: s.id, t: s.title, w: s.when }))
    const anyRunning = sessions.some((s) => s.status === 'streaming' || s.status === 'awaiting')

    const tasks = tasksStore.tasks
      .filter((task) => task.projectId === p.id)
      .filter((task) => task.status === 'running' || task.status === 'waiting_approval')
      .slice(0, 6)
      .map((task) => ({ t: task.title, s: task.status }))

    return {
      id: p.id,
      name: p.name,
      path: p.path,
      status: anyRunning || tasks.length > 0 ? 'active' : 'idle',
      gh: ghSlug,
      repos,
      agents: projectAgents,
      ses,
      tasks,
    }
  })
}
