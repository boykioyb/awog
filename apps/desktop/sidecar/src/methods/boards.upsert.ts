import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import {
  BoardError,
  MAX_ITEM_DESC_LEN,
  MAX_ITEM_TITLE_LEN,
  addBoardItemComment,
  listBoardItems,
  upsertBoardItem,
} from '../boards/store.js'
import { MESSAGE_ID_RE } from '../sessions/ids.js'
import { listSessionSummaries } from '../sessions/store.js'
import { postSessionMessage } from '../sessions/inbox.js'
import { routeSessionForItem } from '../boards/model-route.js'
import { log } from '../util/logger.js'
import type { BoardItem } from '../types/shared.js'

// Tạo/sửa một work-item trên board của project từ UI (docs/features/session-teams.md
// §7) — nút "+" của cockpit, kéo cột, sửa title/desc/assignee/stage.
//
// Đây là đường của NGƯỜI DÙNG nên khác đường tool `team_item_update` của model ở
// hai điểm có chủ đích:
//   • `createdBy` luôn null — user path không thể mạo danh một phiên;
//   • user ĐƯỢC set `done`/`cancelled` (merge/đóng là quyết của người dùng) —
//     tool của agent bị chặn hai status đó.
//
// Còn một điểm GIỐNG tool: item được đặt vào tay một phiên (tạo có assignee ở
// todo, kéo backlog → todo, đổi chủ khi đang sống) thì phiên đó được wake —
// kéo sang "Cần làm" chính là lệnh triển khai của người dùng, không phải bấm
// thêm nút nào.
//
// Trần độ dài ở schema và ở store (cleanTitle/cleanDesc) — store vẫn chuẩn hoá
// lại vì đường tool không đi qua zod này.
const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]*$/
const SESSION_ID_RE = /^[a-z0-9-]+$/
// Spec người nhận dự kiến — khoá agent/team của UI: 'agent:global||<id>' hoặc
// 'team:project|<pid>|<id>', và 'member:<runId>|<title>' cho member spec CHƯA
// có phiên của một run đang sống (đối xứng assignee_member của board tools —
// materialize qua sessions.materializeMember). Chặt đúng hình để rác không
// lọt vào field mà cả agent tool lẫn UI đều đọc.
const ASSIGNEE_REF_RE =
  /^(agent|team):(global|project)\|[a-z0-9-]*\|[a-z0-9-]+$|^member:[a-z0-9-]+\|.{1,160}$/

const STATUS_ENUM = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'changes',
  'blocked',
  'done',
  'cancelled',
])

// Status "sống" — đổi chủ khi item đứng ở đây thì người nhận mới phải được báo
// ngay (đối xứng luật wake của team_item_*). backlog = bãi đỗ, done/cancelled
// = đã đóng nên không wake ai.
const WAKE_STATUSES = new Set(['todo', 'in_progress', 'in_review', 'changes', 'blocked'])

// Wake assignee sau một ghi thành công. Tin gửi TỪ gốc nhóm của assignee
// (teamRunId của member = phiên lead) nên đi trọn pipeline auto-deliver khi
// nhóm. Assignee là chính gốc, hoặc không thuộc nhóm nào ⇒ from=null — tin
// nguồn-user vẫn tự giao+chạy y như mọi tin hộp thư khác.
// Best-effort: board đã ghi xong, wake tắc không rollback.
async function wakeAssignee(item: BoardItem, prev: BoardItem | undefined): Promise<void> {
  const assigneeId = item.assigneeSessionId
  if (!assigneeId) return
  const assigneeChanged = assigneeId !== prev?.assigneeSessionId
  const pulledToTodo = item.status === 'todo' && prev?.status !== 'todo'
  if (!(pulledToTodo || (assigneeChanged && WAKE_STATUSES.has(item.status)))) return
  try {
    const summaries = await listSessionSummaries()
    const assignee = summaries.find((s) => s.id === assigneeId)
    if (!assignee || assignee.archived) return
    // Auto-route model/effort của phiên nhận theo tính chất item — dispatch là
    // lúc quyết lại cấu hình (model-route.ts). Gốc của một run (có member trỏ
    // về nó) giữ sàn tầm giữa của lead. Best-effort: route tắc không được làm
    // hỏng wake.
    try {
      const lead = summaries.some((s) => s.teamRunId === assignee.id)
      await routeSessionForItem(assignee, item, { lead })
    } catch (err) {
      log.warn('boards.upsert: assignee model route failed', {
        to: assigneeId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    await postSessionMessage({
      from: assignee.teamRunId ?? null,
      to: assigneeId,
      text:
        `[board] "${item.title}" (${item.id}) was assigned to you — status ${item.status}. ` +
        'Acknowledge FIRST with team_item_comment in the thread — before any other work — then call team_item_get for the full brief and move it to in_progress when you start. ' +
        'Keep the thread posted as you make progress — it is the team\'s shared view of your work.',
    })
  } catch (err) {
    log.warn('boards.upsert: assignee wake failed', {
      to: assigneeId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

// Ghi một system comment cho mỗi transition của item (assignee/status/stage) —
// thread "Trao đổi" trong item modal render chúng như vạch sự kiện giữa
// messenger, nên mới thấy "lead giao cho ai / ai nhận việc". Quy ước giống
// "Turn failed; returned to todo" trong boards/store.ts: from=null +
// fromTitle 'system', text tiếng Anh gọn. Best-effort trọn vẹn — comment đầy
// hay lookup title tắc đều không được làm hỏng upsert đã ghi xong.
async function recordTransitions(item: BoardItem, prev: BoardItem | undefined): Promise<void> {
  const parts: string[] = []
  if (item.assigneeSessionId !== prev?.assigneeSessionId) {
    if (item.assigneeSessionId) {
      try {
        const title =
          (await listSessionSummaries()).find((s) => s.id === item.assigneeSessionId)?.title ??
          item.assigneeSessionId
        parts.push(`assigned to "${title}"`)
      } catch {
        parts.push('assigned')
      }
    } else if (prev) {
      parts.push('unassigned')
    }
  }
  // Status/stage chỉ tính là transition khi item đã tồn tại — giá trị đầu lúc
  // tạo là trạng thái khởi đầu, không phải sự kiện.
  if (prev && item.status !== prev.status) parts.push(`${prev.status} → ${item.status}`)
  if (prev && item.parentId !== prev.parentId) {
    if (item.parentId) {
      let parent = item.parentId
      try {
        parent =
          (await listBoardItems(item.projectId)).find((i) => i.id === item.parentId)?.title ??
          item.parentId
      } catch {
        // Tên cha tắc tra — rơi về id, vạch vẫn ghi được.
      }
      parts.push(`moved under "${parent}"`)
    } else {
      parts.push('detached from parent')
    }
  }
  if (prev && item.stage !== prev.stage) {
    parts.push(`stage ${prev.stage ?? 'none'} → ${item.stage ?? 'none'}`)
  }
  if (!parts.length) return
  try {
    await addBoardItemComment(item.projectId, item.id, {
      from: null,
      fromTitle: 'system',
      text: parts.join(' · '),
    })
  } catch (err) {
    log.warn('boards.upsert: transition comment failed', {
      itemId: item.id,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

const Params = z.object({
  projectId: z.string().min(3).max(64).regex(PROJECT_ID_RE),
  item: z.object({
    // Có `id` = update item đó; vắng = tạo mới.
    id: z.string().max(64).regex(MESSAGE_ID_RE).optional(),
    // Store làm phẳng + cắt một dòng ở trần của nó; biên chỉ chặn payload vô lý.
    title: z.string().min(1).max(MAX_ITEM_TITLE_LEN * 4).optional(),
    desc: z.string().max(MAX_ITEM_DESC_LEN).optional(),
    // null = gỡ assignee. Vắng = giữ nguyên (khác biệt này là lý do không thể
    // gộp chung `undefined`/`null` trong một schema tuỳ ý).
    assigneeSessionId: z.string().min(1).max(64).regex(SESSION_ID_RE).nullable().optional(),
    // Giao cho một SPEC (chưa materialize) — null = gỡ ref.
    assigneeRef: z.string().max(200).regex(ASSIGNEE_REF_RE).nullable().optional(),
    // Override LLM per-slot (editor → Advanced). Key 'self'|'lead'|'member:<title>',
    // value = subset {provider,modelId,accountId}. null = xoá hẳn cả map.
    // Biên zod giữ payload sạch hình; store (cleanAssigneeConfig) chặt giá trị.
    assigneeConfig: z
      .record(
        z.string().max(180).regex(/^(self|lead|member:[^|]{1,120})$/),
        z.object({
          provider: z.enum(['anthropic', 'openai', 'google']).optional(),
          modelId: z.string().min(1).max(200).optional(),
          accountId: z.string().min(1).max(64).optional(),
          level: z.enum(['low', 'medium', 'high', 'extra-high', 'max']).optional(),
          mode: z.enum(['ask', 'accept-edits', 'plan', 'execute']).optional(),
        }),
      )
      .nullable()
      .optional(),
    status: STATUS_ENUM.optional(),
    // Khuôn Jira: loại việc + cây cha-con (null = gỡ cha) + ưu tiên/mức độ.
    type: z.enum(['epic', 'story', 'task', 'subtask', 'bug']).optional(),
    parentId: z.string().max(64).regex(MESSAGE_ID_RE).nullable().optional(),
    priority: z.enum(['urgent', 'high', 'medium', 'low']).nullable().optional(),
    severity: z.enum(['blocker', 'major', 'minor', 'trivial']).nullable().optional(),
    // null = item không còn thuộc đợt (stage) nào.
    stage: z.number().int().min(0).nullable().optional(),
  }),
})

register('boards.upsert', async (raw) => {
  const params = Params.parse(raw)
  try {
    // Chụp trạng thái TRƯỚC khi ghi — wake chỉ bắn khi có transition thật
    // (đổi chủ / kéo ra todo), lưu lại y nguyên không spam ai.
    const prev = params.item.id
      ? (await listBoardItems(params.projectId)).find((i) => i.id === params.item.id)
      : undefined
    const item = await upsertBoardItem(params.projectId, {
      ...params.item,
      // User path — xem comment đầu file.
      createdBy: null,
    })
    await wakeAssignee(item, prev)
    await recordTransitions(item, prev)
    return { item }
  } catch (err) {
    if (err instanceof BoardError) {
      throw new RpcError(err.code === 'unknown-item' ? -32004 : -32602, err.message, {
        code: err.code,
      })
    }
    throw err
  }
})
