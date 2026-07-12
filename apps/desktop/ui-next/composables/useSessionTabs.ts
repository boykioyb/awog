// Presentational view over the sessions store's project-tab state. The store owns
// the source of truth (openProjectTabs / activeTab / per-tab memory + all the
// open/close/activate logic); this composable only derives what SessionTabBar binds:
// the ordered tab list with labels/colors/counts and the set of projects still
// openable via the "+" picker. SoC: no state of its own, no IPC.
import { computed } from 'vue'
import { useI18n } from './useI18n'
import { useProjects } from './useProjects'
import { PROJECT_COLOR_DEFAULT, useProjectColors } from './useProjectColors'
import { useSessionsStore } from '~/stores/sessions'

export type SessionTab = {
  id: string // engine projectId; '' = the Default tab
  name: string
  color: string
  unread: number // sessions needing attention (unread / awaiting) — drives the amber badge
  running: boolean // a session in this project is actively streaming — drives the live dot pulse
  active: boolean
  closable: boolean // the Default tab is not user-closable
}

export function useSessionTabs() {
  const { t } = useI18n()
  const store = useSessionsStore()
  const { projects, projectName, projectPath } = useProjects()
  const { colorOf } = useProjectColors()

  // Attention (unread / awaiting) count per project, for the tab badge. Matches the
  // NavRail sessions badge (unread OR parked on a gate) so the two surfaces agree.
  const unreadByProject = computed<Record<string, number>>(() => {
    const out: Record<string, number> = {}
    for (const s of store.sessions) {
      if (s.unread || s.status === 'awaiting') out[s.project] = (out[s.project] ?? 0) + 1
    }
    return out
  })

  // Projects with at least one actively streaming session — drives the live pulse on
  // the tab dot, so a background project working is visible even when its tab isn't
  // active. Only 'streaming' counts as running ('awaiting' is already the amber badge).
  const runningByProject = computed<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {}
    for (const s of store.sessions) {
      if (s.status === 'streaming') out[s.project] = true
    }
    return out
  })

  const tabs = computed<SessionTab[]>(() =>
    store.openProjectTabs.map((id) => ({
      id,
      name: id === '' ? t('sessions.defaultProject') : projectName(id),
      color: id === '' ? PROJECT_COLOR_DEFAULT : colorOf(id),
      unread: unreadByProject.value[id] ?? 0,
      running: runningByProject.value[id] ?? false,
      active: id === store.activeTab,
      closable: id !== '',
    })),
  )

  // Projects that can still be opened as a tab (every known project not already
  // open), plus a synthetic "Default" entry when unassigned sessions exist and the
  // Default tab isn't open yet.
  const openableProjects = computed<{ id: string; name: string }[]>(() => {
    const open = new Set(store.openProjectTabs)
    const out: { id: string; name: string }[] = []
    if (!open.has('') && store.sessions.some((s) => !s.project)) {
      out.push({ id: '', name: t('sessions.defaultProject') })
    }
    for (const p of projects.value) if (!open.has(p.id)) out.push(p)
    return out
  })

  return {
    tabs,
    openableProjects,
    projectPath,
    setActiveTab: store.setActiveTab,
    closeTab: store.closeTab,
    openTab: store.openTab,
  }
}
