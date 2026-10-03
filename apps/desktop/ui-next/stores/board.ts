import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar, sidecarErrorText, type UnlistenFn } from '~/composables/useSidecar'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useSessionsStore } from '~/stores/sessions'
import { useAgentsStore } from '~/stores/agents'
import { useTeamsStore } from '~/stores/teams'
import { dispatchRunSettings } from '~/composables/useProjectLlmDefaults'
import type { SessionAgentRef, SessionLlmOverride } from '~/composables/useSessionsData'

// Board + channel store của "session teams" (docs/features/session-teams.md §7).
// Board thuộc PROJECT (~/.awog/boards/<projectId>.json — xoá nhóm không mất
// backlog); channel thuộc GỐC NHÓM (~/.awog/groups/<rootId>/channel.jsonl —
// chết theo nhóm). Store này là cửa ngõ renderer của hai thứ đó cộng các hành
// động cockpit (memberDiff / integrateMember / setAgent).
//
// Mirrors sidecar types/shared.ts — KHÔNG import chéo package; các shape dưới
// đây là bản sao có chủ đích của BoardItem/BoardItemStatus/TeamChannelEntry/
// SessionAgentRef (SessionAgentRef tái dùng từ useSessionsData, nơi nó đã được
// mirror cho Session.agent).

export type BoardItemStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'changes'
  | 'blocked'
  | 'done'
  | 'cancelled'

export type BoardItemComment = {
  id: string
  at: string
  // sessionId của member/lead viết, hoặc null khi NGƯỜI DÙNG viết từ UI.
  from: string | null
  fromTitle: string
  text: string
}

export type BoardItem = {
  id: string
  projectId: string
  title: string
  desc?: string
  // sessionId của member được giao; vắng mặt = chưa ai nhận.
  assigneeSessionId?: string | null
  // Spec người nhận DỰ KIẾN ('agent:<key>'/'team:<key>') — chỉ sống khi item
  // đỗ backlog chưa materialize; kéo ra status sống ⇒ spawn rồi field xoá.
  assigneeRef?: string | null
  // Override LLM per-slot của người dùng (editor → Advanced). Key 'self' |
  // 'lead' | 'member:<title>' — mirrors sidecar BoardItem.assigneeConfig.
  assigneeConfig?: Record<string, SessionLlmOverride>
  status: BoardItemStatus
  stage?: number
  // sessionId của bên tạo, hoặc null khi người dùng tạo từ UI.
  createdBy: string | null
  createdAt: string
  updatedAt: string
  mergedBranch?: string
  comments: BoardItemComment[]
}

export type TeamChannelKind = 'chat' | 'status' | 'note' | 'eval' | 'system'

export type TeamChannelEntry = {
  id: string
  at: string
  // sessionId của bên post; null = người dùng ('system' cũng dùng from=null).
  from: string | null
  fromTitle: string
  kind: TeamChannelKind
  text: string
  // sessionId của member được @-mention (được wake qua hộp thư).
  mentions?: string[]
}

// Kết quả `sessions.memberDiff` — diff bounded của branch member so với baseRef.
// `stat` linh hoạt: sidecar có thể trả chuỗi tóm tắt hoặc object đếm; roster chỉ
// cần hiện "±n files" nên cả hai dạng đều đọc được.
export type MemberDiffResult = {
  stat?: string | { files?: number; additions?: number; deletions?: number } | null
  diff?: string
  files?: { path: string; additions?: number; deletions?: number }[]
}

// Thứ tự cột trên board — đúng thứ tự pipeline: bãi đỗ và việc đã xếp lên
// đầu, trạng thái sống ở giữa, kết thúc ở đuôi. Giữ đồng bộ với
// boards/store.ts bên sidecar (cùng một thứ tự cho mọi bề mặt).
export const BOARD_STATUS_ORDER: readonly BoardItemStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'changes',
  'blocked',
  'done',
  'cancelled',
]

// Status "sống" — mirror WAKE_STATUSES của boards.upsert bên sidecar: item
// đứng vào các cột này nghĩa là việc đang chạy. backlog = bãi đỗ, done/
// cancelled = đóng — kéo vào đó KHÔNG spawn ai kể cả khi item mang spec chờ.
export const ACTIVE_BOARD_STATUSES: ReadonlySet<BoardItemStatus> = new Set([
  'todo',
  'in_progress',
  'in_review',
  'changes',
  'blocked',
])

// 'agent:<source|projectId|id>' / 'team:<source|projectId|id>' / 'member:<runId|title>'
// — cùng sentinel của picker "giao cho" trong editor. `member:` là đường
// dispatch-lười cho member spec chưa có phiên của một run đang sống.
export function isSpecAssignee(ref: string | null | undefined): ref is string {
  return !!ref && (ref.startsWith('agent:') || ref.startsWith('team:') || ref.startsWith('member:'))
}

export const useBoardStore = defineStore('board', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  // Board theo project + channel theo gốc nhóm. Cả hai nạp lười (tab Nhóm mở
  // mới list) rồi sống tiếp nhờ event `board.changed` / `channel.appended`.
  const itemsByProject = ref<Record<string, BoardItem[]>>({})
  const channelByGroup = ref<Record<string, TeamChannelEntry[]>>({})
  // Cache memberDiff theo engineId của member — null = đã hỏi, không có diff
  // (chưa có worktree / branch chưa rẽ). Roster đọc thẳng từ đây.
  const diffBySession = ref<Record<string, MemberDiffResult | null>>({})
  // integrateMember đang chạy trên member nào — chống double-click nút Merge.
  const mergingSession = ref<string | null>(null)

  let unlisten: UnlistenFn | null = null

  // ── Getters ──
  const itemsFor = (projectId: string): BoardItem[] => itemsByProject.value[projectId] ?? []
  const channelFor = (rootId: string): TeamChannelEntry[] => channelByGroup.value[rootId] ?? []
  const diffFor = (engineId: string): MemberDiffResult | null | undefined =>
    diffBySession.value[engineId]

  // Gom item theo status theo BOARD_STATUS_ORDER — trả đủ 8 cột (kể cả rỗng) để
  // UI vẽ khung đều; cột rỗng có thể tự giấu.
  function columnsFor(projectId: string): { status: BoardItemStatus; items: BoardItem[] }[] {
    const items = itemsFor(projectId)
    return BOARD_STATUS_ORDER.map((status) => ({
      status,
      items: items.filter((i) => i.status === status),
    }))
  }

  // ── RPC wrappers — mọi lỗi nuốt thành console.warn + giá trị trống, không ──
  // ── bao giờ ném ra UI (cockpit phải chịu được sidecar chưa có method).     ──

  async function listBoard(projectId: string): Promise<BoardItem[]> {
    if (!available.value || !projectId) return []
    try {
      const res = await sc.request<{ items?: BoardItem[] }>('boards.list', { projectId })
      const items = Array.isArray(res.items) ? res.items : []
      itemsByProject.value = { ...itemsByProject.value, [projectId]: items }
      return items
    } catch (err) {
      console.warn('[board] boards.list failed', err)
      return itemsFor(projectId)
    }
  }

  // Gộp một item đã lưu vào cache local. Trả undefined = item không hợp lệ.
  function mergeItem(projectId: string, item: BoardItem | undefined): void {
    if (!item || typeof item.id !== 'string') return
    const list = [...itemsFor(projectId)]
    const idx = list.findIndex((i) => i.id === item.id)
    if (idx >= 0) list[idx] = item
    else list.push(item)
    itemsByProject.value = { ...itemsByProject.value, [projectId]: list }
  }

  // Patch của người dùng: giống schema `boards.upsert` của sidecar — assignee
  // null = gỡ người nhận, stage null = gỡ khỏi đợt (vắng mặt = giữ nguyên).
  async function upsertItem(
    projectId: string,
    item: Partial<Omit<BoardItem, 'stage' | 'assigneeConfig'>> & {
      title: string
      stage?: number | null
      // null = gỡ hẳn map override (sidecar hiểu null của assigneeConfig là
      // xoá key — cùng luật assigneeSessionId/assigneeRef).
      assigneeConfig?: Record<string, SessionLlmOverride> | null
    },
  ): Promise<BoardItem | null> {
    if (!available.value || !projectId) return null
    try {
      const res = await sc.request<{ item?: BoardItem }>('boards.upsert', { projectId, item })
      if (res?.item) mergeItem(projectId, res.item)
      else void listBoard(projectId) // phản hồi không mang item ⇒ nạp lại cho chắc
      return res?.item ?? null
    } catch (err) {
      console.warn('[board] boards.upsert failed', err)
      return null
    }
  }

  // Materialize spec người nhận thành phiên thật trên project đích của item —
  // teams.run → phiên gốc nhóm, agents.run → phiên lone-agent (title phiên =
  // title việc). Rethrow: caller toast message thật qua sidecarErrorText.
  //
  // `config` = map override LLM per-slot của editor (Advanced):
  //   • 'agent:' → slot 'self' merge vào settings spawn + ghi llmOverride lên
  //     phiên mới (agent bind pin provider/model ở lượt — chỉ llmOverride mới
  //     đè được nó).
  //   • 'team:' → slot 'lead' cho phiên gốc; các slot 'member:*' NẰM LẠI trên
  //     item (assigneeConfig) — sidecar tra chúng lúc materialize lười member.
  //   • 'member:' → slot 'member:<title>' truyền thẳng qua RPC.
  async function materializeRef(
    ref: string,
    projectId: string,
    title?: string,
    itemId?: string,
    config?: Record<string, SessionLlmOverride>,
  ): Promise<string> {
    const agentsStore = useAgentsStore()
    const teamsStore = useTeamsStore()
    // Settings hiệu dụng của project đích (llmDefaults → global) — phiên board
    // chạy đúng account mà project đã ghim. Ghim của spec agent áp thêm ở
    // nhánh 'agent:' bên dưới.
    if (ref.startsWith('member:')) {
      // Member spec chưa có phiên của một RUN đang sống — materialize lười
      // qua sessions.materializeMember (đường user, đối xứng assignee_member
      // mà lead dùng trong team_item_*). Tin đầu inbox của phiên mới chính là
      // lời giao việc (title/id item); member đã sống ⇒ RPC tái dùng phiên.
      const sep = ref.indexOf('|')
      const runId = ref.slice(7, sep)
      const memberTitle = ref.slice(sep + 1)
      const ov = config?.[`member:${memberTitle}`]
      const res = await sc.request<{ sessionId?: string }>('sessions.materializeMember', {
        rootId: runId,
        member: memberTitle,
        ...(title ? { itemTitle: title } : {}),
        ...(itemId ? { itemId } : {}),
        ...(ov ? { llmOverride: ov } : {}),
      })
      if (!res?.sessionId) throw new Error('sessions.materializeMember returned no session')
      return res.sessionId
    }
    if (ref.startsWith('team:')) {
      const team = teamsStore.teamByKey(ref.slice(5))
      if (!team) throw new Error(`Team spec no longer exists: ${ref}`)
      const leadOv = config?.lead
      const res = await teamsStore.run(team, projectId || null, {
        ...dispatchRunSettings(projectId),
        ...(leadOv?.provider ? { provider: leadOv.provider } : {}),
        ...(leadOv?.modelId ? { modelId: leadOv.modelId } : {}),
        ...(leadOv?.accountId ? { accountId: leadOv.accountId } : {}),
      })
      if (!res?.rootId) throw new Error('teams.run returned no root session')
      // Pin của agent LEAD (nếu spec bind agent có provider/model/account) đè
      // settings ở lượt — llmOverride là tầng duy nhất thắng được nó.
      if (leadOv) await setLlmOverride(res.rootId, leadOv)
      return res.rootId
    }
    const agent = agentsStore.agentByKey(ref.slice(6))
    if (!agent) throw new Error(`Agent spec no longer exists: ${ref}`)
    const selfOv = config?.self
    // origin:'board' đánh dấu phiên này xuất phát từ board — danh sách session
    // ẩn nó (việc ê-kíp sống trong board UI, không phải inbox chat).
    const res = await agentsStore.runAgent(
      agent,
      projectId || null,
      dispatchRunSettings(projectId, {
        provider: selfOv?.provider ?? agent.provider,
        model: selfOv?.modelId ?? agent.model,
        accountId: selfOv?.accountId ?? agent.accountId,
      }),
      title,
      'board',
    )
    if (!res?.sessionId) throw new Error('agents.run returned no session')
    if (selfOv) await setLlmOverride(res.sessionId, selfOv)
    return res.sessionId
  }

  // Đổi status một item — điểm tụ của kéo-cột kanban, bulk status và (gián
  // tiếp) ô status của editor. Item còn `assigneeRef` (spec chờ) mà bị đưa
  // sang cột sống ⇒ materialize spec TRƯỚC rồi ghi một nhát {status +
  // assigneeSessionId + assigneeRef:null}: wakeAssignee của boards.upsert
  // thấy transition sẽ tự bắn tin giao việc vào inbox phiên mới. Materialize
  // hỏng ⇒ item ở yên cột cũ + toast lý do (không spawn phiên phí nào).
  async function applyStatus(it: BoardItem, status: BoardItemStatus): Promise<BoardItem | null> {
    const patch: Parameters<typeof upsertItem>[1] = { id: it.id, title: it.title, status }
    if (
      it.assigneeRef &&
      !it.assigneeSessionId &&
      it.status !== status &&
      ACTIVE_BOARD_STATUSES.has(status)
    ) {
      try {
        patch.assigneeSessionId = await materializeRef(
          it.assigneeRef,
          it.projectId,
          it.title,
          it.id,
          // Override đặt sẵn ở Advanced đi cùng lần materialize này (kéo cột =
          // bốc việc thật — "đổi account hết token" phải có hiệu lực ngay).
          it.assigneeConfig,
        )
        patch.assigneeRef = null
      } catch (err) {
        useToast().add({
          title: useI18n().t('board.agent.runFailed'),
          description: sidecarErrorText(err),
          color: 'error',
        })
        return null
      }
    }
    return upsertItem(it.projectId, patch)
  }

  // Nhãn của spec người nhận cho card/list — '⚡ <agent>' / '⛁ <team>' /
  // '◌ <member title>'. Spec đã bị xoá ⇒ rơi về đuôi khoá cho vẫn đọc được
  // thay vì trống.
  function specLabel(ref: string): string {
    const agentsStore = useAgentsStore()
    const teamsStore = useTeamsStore()
    if (ref.startsWith('member:')) {
      return `◌ ${ref.slice(ref.indexOf('|') + 1)}`
    }
    const key = ref.startsWith('team:') ? ref.slice(5) : ref.slice(6)
    const tail = key.split('|').pop() ?? ref
    if (ref.startsWith('team:')) {
      return `⛁ ${teamsStore.teamByKey(key)?.name ?? tail}`
    }
    return `⚡ ${agentsStore.agentByKey(key)?.name ?? tail}`
  }

  // boards.draft — one-shot LLM sinh title/desc từ brief (nút "Dựng bằng AI" của
  // editor, mode tạo mới). Rethrow để editor phân biệt auth/quota/parse (toast
  // kèm action mở Settings khi credential hỏng — xem pages/teams.vue).
  async function draftItem(input: {
    projectId: string
    brief: string
    current?: { title?: string; desc?: string }
    settings: { provider: string; modelId: string; accountId?: string | null }
  }): Promise<{ title: string; desc?: string }> {
    const res = await sc.request<{ draft?: { title?: string; desc?: string } }>('boards.draft', {
      ...input,
      settings: { ...input.settings, accountId: input.settings.accountId ?? undefined },
    })
    return {
      title: typeof res?.draft?.title === 'string' ? res.draft.title : '',
      ...(typeof res?.draft?.desc === 'string' ? { desc: res.draft.desc } : {}),
    }
  }

  async function deleteItem(projectId: string, itemId: string): Promise<boolean> {
    if (!available.value || !projectId) return false
    try {
      await sc.request('boards.delete', { projectId, itemId })
      itemsByProject.value = {
        ...itemsByProject.value,
        [projectId]: itemsFor(projectId).filter((i) => i.id !== itemId),
      }
      return true
    } catch (err) {
      console.warn('[board] boards.delete failed', err)
      return false
    }
  }

  // Kết quả báo của wake assignee (sidecar `boards.comment` trả kèm) — thread
  // dùng để hiện "đã chuyển / xếp hàng / không ai nhận" ngay sau khi gửi.
  // 'none' = item chưa giao hoặc phiên nhận đã đóng: comment lưu lại nhưng
  // không ai được báo — trạng thái "chờ phản hồi" của thread vẫn tự suy ra từ
  // comments + session live, nên store chỉ giữ wake CUỐI CÙNG per item để UI
  // phân biệt ngay-lúc-gửi.
  const lastWake = ref<Record<string, 'delivered' | 'queued' | 'none' | 'failed' | undefined>>({})

  async function commentItem(
    projectId: string,
    itemId: string,
    text: string,
  ): Promise<'delivered' | 'queued' | 'none' | 'failed' | false> {
    if (!available.value || !projectId || !text.trim()) return false
    try {
      const res = await sc.request<{
        item?: BoardItem
        wake?: 'delivered' | 'queued' | 'none' | 'failed'
      }>('boards.comment', {
        projectId,
        itemId,
        text: text.trim(),
      })
      if (res?.item) mergeItem(projectId, res.item)
      else void listBoard(projectId)
      const wake = res?.wake ?? 'none'
      lastWake.value[itemId] = wake
      return wake
    } catch (err) {
      console.warn('[board] boards.comment failed', err)
      return false
    }
  }

  // ── Channel ──

  async function listChannel(rootId: string, limit?: number): Promise<TeamChannelEntry[]> {
    if (!available.value || !rootId) return []
    try {
      const res = await sc.request<{ entries?: TeamChannelEntry[] }>('team.channelList', {
        rootId,
        ...(typeof limit === 'number' ? { limit } : {}),
      })
      const entries = Array.isArray(res.entries) ? res.entries : []
      channelByGroup.value = { ...channelByGroup.value, [rootId]: entries }
      return entries
    } catch (err) {
      console.warn('[board] team.channelList failed', err)
      return channelFor(rootId)
    }
  }

  async function postChannel(
    rootId: string,
    text: string,
    kind: TeamChannelKind = 'chat',
    mentions?: string[],
  ): Promise<boolean> {
    if (!available.value || !rootId || !text.trim()) return false
    try {
      const res = await sc.request<{ entry?: TeamChannelEntry }>('team.channelPost', {
        rootId,
        text: text.trim(),
        kind,
        ...(mentions?.length ? { mentions } : {}),
      })
      // Entry trả về append lạc quan ngay; event `channel.appended` có thể tới
      // sau — dedupe theo id ở subscribe() nên không có bản đôi.
      if (res?.entry && typeof res.entry.id === 'string') {
        const list = channelFor(rootId)
        if (!list.some((e) => e.id === res.entry!.id)) {
          channelByGroup.value = { ...channelByGroup.value, [rootId]: [...list, res.entry] }
        }
      } else {
        void listChannel(rootId)
      }
      return true
    } catch (err) {
      console.warn('[board] team.channelPost failed', err)
      return false
    }
  }

  // ── Roster actions (diff / merge / agent) ──

  async function memberDiff(engineId: string): Promise<MemberDiffResult | null> {
    if (!available.value || !engineId) return null
    try {
      const res = await sc.request<MemberDiffResult>('sessions.memberDiff', { id: engineId })
      diffBySession.value = { ...diffBySession.value, [engineId]: res ?? null }
      return res ?? null
    } catch (err) {
      console.warn('[board] sessions.memberDiff failed', err)
      diffBySession.value = { ...diffBySession.value, [engineId]: null }
      return null
    }
  }

  // Merge branch của member về base — hành động của NGƯỜI DÙNG. KHÔNG nuốt lỗi
  // conflict: trả về { error } để roster hiện inline thay vì toast trôi qua.
  async function integrateMember(
    engineId: string,
    itemId?: string,
  ): Promise<{ merged: boolean; commit?: string; error?: string }> {
    if (!available.value || !engineId) return { merged: false }
    mergingSession.value = engineId
    try {
      const res = await sc.request<{ merged?: boolean; commit?: string }>(
        'sessions.integrateMember',
        { id: engineId, ...(itemId ? { itemId } : {}) },
      )
      return { merged: res?.merged === true, commit: res?.commit }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[board] sessions.integrateMember failed', err)
      return { merged: false, error: message }
    } finally {
      mergingSession.value = null
    }
  }

  // Gắn/gỡ agent AWOG cho một phiên trong nhóm (vai "có thật"). Session state
  // sống ở sessions store nên ủy quyền lạc quan qua nó — y hệt khuôn
  // setSpawnConfig.
  async function setAgent(engineId: string, agent: SessionAgentRef | null): Promise<boolean> {
    if (!available.value || !engineId) return false
    const sessions = useSessionsStore()
    const s = sessions.byEngineId(engineId)
    const prev = s?.agent
    if (s) s.agent = agent ?? undefined
    try {
      await sc.request('sessions.setAgent', { id: engineId, agent })
      return true
    } catch (err) {
      console.warn('[board] sessions.setAgent failed', err)
      if (s) s.agent = prev
      return false
    }
  }

  // Đặt/gỡ override LLM trên một phiên ĐANG SỐNG — "đổi account khi hết token"
  // của board item → Advanced. `null` = gỡ hẳn. Lạc quan trên session state,
  // rollback khi RPC fail — y hệt setAgent ở trên.
  async function setLlmOverride(
    engineId: string,
    override: SessionLlmOverride | null,
  ): Promise<boolean> {
    if (!available.value || !engineId) return false
    const sessions = useSessionsStore()
    const s = sessions.byEngineId(engineId)
    const prev = s?.llmOverride
    if (s) s.llmOverride = override ?? undefined
    try {
      await sc.request('sessions.setLlmOverride', { id: engineId, override })
      return true
    } catch (err) {
      console.warn('[board] sessions.setLlmOverride failed', err)
      if (s) s.llmOverride = prev
      return false
    }
  }

  // ── Events: board.changed ⇒ refetch board; channel.appended ⇒ append feed ──
  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (evt.type === 'board.changed') {
          const p = evt.payload as { projectId?: unknown } | null
          if (typeof p?.projectId === 'string') void listBoard(p.projectId)
          return
        }
        if (evt.type === 'channel.appended') {
          const p = evt.payload as { rootId?: unknown; entry?: unknown } | null
          const entry = p?.entry as TeamChannelEntry | undefined
          if (typeof p?.rootId !== 'string' || !entry || typeof entry.id !== 'string') return
          const list = channelFor(p.rootId)
          if (!list.some((e) => e.id === entry.id)) {
            channelByGroup.value = { ...channelByGroup.value, [p.rootId]: [...list, entry] }
          }
          return
        }
      })
    } catch {
      // Không có bridge: không có gì để nghe.
      unlisten = null
    }
  }

  // Singleton app-lifetime — subscribe ngay khi store được dựng (giống sessions).
  if (sc.available) void subscribe()

  return {
    // state
    itemsByProject,
    channelByGroup,
    diffBySession,
    mergingSession,
    available,
    // getters
    itemsFor,
    columnsFor,
    channelFor,
    diffFor,
    // actions
    listBoard,
    upsertItem,
    materializeRef,
    applyStatus,
    specLabel,
    draftItem,
    deleteItem,
    commentItem,
    lastWake,
    listChannel,
    postChannel,
    memberDiff,
    integrateMember,
    setAgent,
    setLlmOverride,
  }
})
