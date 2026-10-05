import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import type { SessionAgentRef } from '~/composables/useSessionsData'

// Team (squad) specs — bản BỀN của một đội, tách khỏi cây phiên runtime
// (docs/features/session-teams.md §9). Hai tầng lưu trữ khuôn agents/workflows:
// global ~/.awog/teams/<id>.json + project {project}/.awog/teams/<id>.json.
// `teams.run` materialize spec thành PHIÊN LEAD mới mỗi lần giao việc — member
// spawn LƯỜI khi được giao một board item (assignee_member của lead, hoặc
// `member:<runId|title>` trong picker "giao cho" → sessions.materializeMember).

export type TeamMemberSpec = {
  title: string
  agent?: SessionAgentRef
}

export type TeamSpec = {
  id: string
  name: string
  desc?: string
  // Chỉ dẫn cấp đội — chỉ đưa cho lead khi materialize (khuôn Multica).
  instructions?: string
  lead?: SessionAgentRef
  members: TeamMemberSpec[]
  createdAt: string
  updatedAt: string
  // Suy ra từ vị trí file phía sidecar — chỉ đọc ở UI.
  source?: 'global' | 'project'
  projectId?: string
}

export type TeamRunResult = {
  rootId?: string
  // Danh sách member của SPEC (chưa có phiên) — mỗi người materialize khi được
  // giao việc, KHÔNG spawn sẵn ở đây. `members`/`failed` giữ cho tương thích —
  // giờ luôn rỗng vì không còn fan-out.
  roster?: { title: string; agentId: string | null }[]
  members?: { id: string; title: string }[]
  failed?: { title: string; reason: string }[]
}

export const useTeamsStore = defineStore('teams', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const teams = ref<TeamSpec[]>([])
  const loaded = ref(false)

  // Khoá tổng hợp — cùng id có thể tồn tại ở global và project tier.
  const teamKey = (t: Pick<TeamSpec, 'id' | 'source' | 'projectId'>): string =>
    `${t.source ?? 'global'}|${t.projectId ?? ''}|${t.id}`

  const teamByKey = (key: string): TeamSpec | undefined =>
    teams.value.find((t) => teamKey(t) === key)

  async function load(projectIds: string[] = []): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      const res = await sc.request<{ teams?: TeamSpec[] }>('teams.list', {
        projectIds,
      })
      teams.value = Array.isArray(res.teams) ? res.teams : []
    } catch (err) {
      console.warn('[teams] teams.list failed', err)
    } finally {
      loaded.value = true
    }
  }

  async function upsert(team: Partial<TeamSpec> & { id: string; name: string }): Promise<boolean> {
    if (!available.value) return false
    try {
      const res = await sc.request<{ team?: TeamSpec }>('teams.upsert', { team })
      if (res?.team) {
        const key = teamKey(res.team)
        teams.value = [...teams.value.filter((t) => teamKey(t) !== key), res.team].sort((a, b) =>
          a.name.localeCompare(b.name),
        )
      }
      return true
    } catch (err) {
      console.warn('[teams] teams.upsert failed', err)
      return false
    }
  }

  async function remove(
    id: string,
    source: 'global' | 'project' = 'global',
    projectId?: string,
  ): Promise<boolean> {
    if (!available.value) return false
    try {
      await sc.request('teams.delete', { id, source, ...(projectId ? { projectId } : {}) })
      teams.value = teams.value.filter(
        (t) => !(t.id === id && (t.source ?? 'global') === source && t.projectId === projectId),
      )
      return true
    } catch (err) {
      console.warn('[teams] teams.delete failed', err)
      return false
    }
  }

  // Materialize spec → phiên LEAD mới (member spawn lười khi được giao việc —
  // `roster` trong kết quả là danh sách spec để tham khảo, không phải phiên).
  // `settings` = defaults hiện tại của người dùng cho phiên gốc.
  async function run(
    team: TeamSpec,
    projectId: string | null,
    settings: { provider: string; modelId: string; level?: string; mode?: string },
  ): Promise<TeamRunResult | null> {
    if (!available.value) return null
    try {
      return await sc.request<TeamRunResult>('teams.run', {
        id: team.id,
        source: team.source ?? 'global',
        ...(team.projectId ? { teamProjectId: team.projectId } : {}),
        projectId,
        settings,
      })
    } catch (err) {
      // KHÔNG nuốt — caller (board dispatch, trang teams) toast message thật
      // qua sidecarErrorText; nuốt → return null để mất lý do fail.
      console.warn('[teams] teams.run failed', err)
      throw err
    }
  }

  // teams.draft — AI dựng/chỉnh spec từ mô tả. Roster do UI gửi kèm để model
  // chỉ bind agent thật; draft trả về KHÔNG ghi đĩa — editor áp vào form,
  // người dùng duyệt rồi upsert như thường.
  async function draft(input: {
    brief: string
    current?: Pick<TeamSpec, 'name' | 'desc' | 'instructions' | 'lead' | 'members'>
    agents: {
      id: string
      name?: string
      description?: string
      source?: 'global' | 'project'
      projectId?: string
    }[]
    settings: { provider: string; modelId: string; accountId?: string | null }
  }): Promise<Partial<TeamSpec> | null> {
    if (!available.value) return null
    try {
      const res = await sc.request<{ draft?: Partial<TeamSpec> }>('teams.draft', {
        ...input,
        // Resolver trả null khi không có account — zod chỉ nhận undefined.
        settings: {
          ...input.settings,
          accountId: input.settings.accountId ?? undefined,
        },
      })
      return res?.draft ?? null
    } catch (err) {
      // SidecarError.data mang zod issues — log kèm để thấy đúng field fail.
      // Re-throw: caller (Teams page) cần message để phân biệt lỗi auth (toast
      // kèm action mở Settings) với lỗi draft thường.
      console.warn('[teams] teams.draft failed', err, (err as { data?: unknown }).data ?? '')
      throw err
    }
  }

  // teams.instructionsDraft — AI viết lại RIÊNG ô instructions theo lời yêu
  // cầu của user (tab Instructions). Không đụng name/desc/members; trả text
  // để editor đổ vào textarea — user duyệt rồi Save như thường.
  async function draftInstructions(input: {
    prompt: string
    current?: string
    context?: { name?: string; desc?: string; members?: string[] }
    settings: { provider: string; modelId: string; accountId?: string | null }
  }): Promise<string | null> {
    if (!available.value) return null
    try {
      const res = await sc.request<{ instructions?: string }>('teams.instructionsDraft', {
        ...input,
        settings: {
          ...input.settings,
          accountId: input.settings.accountId ?? undefined,
        },
      })
      return res?.instructions ?? null
    } catch (err) {
      console.warn('[teams] teams.instructionsDraft failed', err)
      throw err
    }
  }

  return { teams, loaded, teamKey, teamByKey, load, upsert, remove, run, draft, draftInstructions }
})
