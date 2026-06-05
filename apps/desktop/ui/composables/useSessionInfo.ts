import { computed, type ComputedRef, type Ref } from 'vue'
import type { Project, Session, SessionContextFile } from '~/types'
import { LEVEL_LABEL, PROVIDER_LABEL, modelById } from '~/utils/models'
import { MODE_OPTIONS } from '~/utils/session-modes'
import { formatTime } from '~/utils/time'

// One label/value pair rendered in the Session Info "Details" section.
export interface SessionMetaRow {
  key: string
  label: string
  value: string
  // Render the value monospace (ids, paths…).
  mono?: boolean
}

export interface UseSessionInfo {
  project: ComputedRef<Project | undefined>
  projectRoot: ComputedRef<string | null>
  meta: ComputedRef<SessionMetaRow[]>
  contextFiles: ComputedRef<SessionContextFile[]>
  viewInFinder: () => Promise<void>
  revealFile: (path: string) => Promise<void>
  openFile: (path: string) => Promise<void>
}

// Derives everything the Session Info panel renders from a session: the bound
// project, a flat meta table, and the "context files" list (attachments +
// `@file` mentions across all messages). Also exposes the OS reveal/open
// actions, scoped to the bound project root via the sidecar bridge.
export const useSessionInfo = (session: Ref<Session>): UseSessionInfo => {
  const workspace = useWorkspaceStore()
  const settings = useSettingsStore()
  const sidecar = useSidecar()
  const { t: tr } = useI18n()

  const project = computed(() =>
    session.value.projectId ? workspace.projectById(session.value.projectId) : undefined,
  )
  const projectRoot = computed<string | null>(() => project.value?.path ?? null)

  const fmt = (at: string): string => formatTime(at, settings.defaults?.timezone)

  // undefined = all currently-enabled servers; [] = explicitly none; [ids] = count.
  const connectionsLabel = (ids: string[] | undefined): string => {
    if (ids === undefined) return tr('sessionInfo.meta.connections_all')
    if (ids.length === 0) return tr('sessionInfo.meta.connections_none')
    return String(ids.length)
  }

  const meta = computed<SessionMetaRow[]>(() => {
    const s = session.value
    const rows: SessionMetaRow[] = [
      { key: 'id', label: tr('sessionInfo.meta.id'), value: s.id, mono: true },
      { key: 'created', label: tr('sessionInfo.meta.created'), value: fmt(s.createdAt) },
      { key: 'updated', label: tr('sessionInfo.meta.updated'), value: fmt(s.updatedAt) },
      { key: 'messages', label: tr('sessionInfo.meta.messages'), value: String(s.messages.length) },
      {
        key: 'model',
        label: tr('sessionInfo.meta.model'),
        value: modelById(s.settings.modelId)?.label ?? s.settings.modelId,
      },
      {
        key: 'provider',
        label: tr('sessionInfo.meta.provider'),
        value: PROVIDER_LABEL[s.settings.provider] ?? s.settings.provider,
      },
      {
        key: 'mode',
        label: tr('sessionInfo.meta.mode'),
        value: MODE_OPTIONS.find((m) => m.value === s.settings.mode)?.label ?? s.settings.mode,
      },
      {
        key: 'thinking',
        label: tr('sessionInfo.meta.thinking'),
        value: LEVEL_LABEL[s.settings.level] ?? s.settings.level,
      },
      {
        key: 'connections',
        label: tr('sessionInfo.meta.connections'),
        value: connectionsLabel(s.mcpServerIds),
      },
    ]
    if (s.invitedAgentIds.length)
      rows.push({
        key: 'agents',
        label: tr('sessionInfo.meta.agents'),
        value: String(s.invitedAgentIds.length),
      })
    if (s.disabledTools?.length)
      rows.push({
        key: 'disabledTools',
        label: tr('sessionInfo.meta.disabled_tools'),
        value: String(s.disabledTools.length),
      })
    return rows
  })

  const contextFiles = computed<SessionContextFile[]>(() => {
    const out: SessionContextFile[] = []
    const seenAttachments = new Set<string>()
    const seenMentions = new Set<string>()
    session.value.messages.forEach((m) => {
      m.attachments?.forEach((a) => {
        if (seenAttachments.has(a.id)) return
        seenAttachments.add(a.id)
        out.push({
          kind: 'attachment',
          key: `att-${a.id}`,
          name: a.name,
          size: a.size,
          fileType: a.type,
          attachment: a,
        })
      })
      m.mentions?.forEach((mn) => {
        if (mn.kind !== 'file' || !mn.targetId || seenMentions.has(mn.targetId)) return
        seenMentions.add(mn.targetId)
        out.push({
          kind: 'mention',
          key: `mention-${mn.targetId}`,
          name: mn.targetId.split('/').pop() || mn.targetId,
          path: mn.targetId,
        })
      })
    })
    return out
  })

  // All three reveal/open the path inside the bound project; the sidecar
  // validates it stays inside that root and silently no-ops when unbound.
  const viewInFinder = async (): Promise<void> => {
    const root = projectRoot.value
    if (!root) return
    try {
      await sidecar.revealPath(root, '.')
    } catch {
      // sidecar unavailable / path missing — ignore.
    }
  }
  const revealFile = async (path: string): Promise<void> => {
    const root = projectRoot.value
    if (!root) return
    try {
      await sidecar.revealPath(root, path)
    } catch {
      // ignore
    }
  }
  const openFile = async (path: string): Promise<void> => {
    const root = projectRoot.value
    if (!root) return
    try {
      await sidecar.openPath(root, path)
    } catch {
      // ignore
    }
  }

  return { project, projectRoot, meta, contextFiles, viewInFinder, revealFile, openFile }
}
