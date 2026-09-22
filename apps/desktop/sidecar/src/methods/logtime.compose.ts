import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { listSessionSummaries, loadSession } from '../sessions/store.js'
import { listTasks, loadTask } from '../tasks/store.js'
import { loadSettings, loadMonth, monthOf } from '../logtime/store.js'
import { loadSourceById } from '../sources/store.js'
import { buildLogtimeSuggestions } from '../logtime/suggestions.js'
import {
  buildComposeContext,
  buildComposeSystemPrompt,
  buildComposeUserPrompt,
  buildSessionDigest,
  formatElapsed,
  parseComposeLines,
  type ComposeContextItem,
  type ComposeLoggedItem,
  type ComposeProject,
  type ComposePromptInput,
} from '../logtime/compose.js'
import { completePi } from '../runtime/complete.js'

// "Soạn bằng AI" — model soạn dòng công nháp cho một ngày từ việc AWOG đo được.
//
// KHÔNG ghi gì: chỉ TRẢ VỀ đề xuất + khối context đã chèn (để modal hiện đúng như bản
// phác). Người dùng bấm "Nhận" thì UI mới thêm từng dòng qua cổng `addEntry` (một
// đường ghi duy nhất, có trần giờ), và đẩy PMS vẫn là bước riêng có xác nhận.
const Params = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accountId: z.string().min(1).max(120).optional(),
  modelId: z.string().min(1).max(200).optional(),
})

register('logtime.compose', async (raw) => {
  const { date, accountId, modelId } = Params.parse(raw)
  const [sessions, tasks, settings] = await Promise.all([
    listSessionSummaries(),
    listTasks(),
    loadSettings(),
  ])

  const links = settings.links.filter((l) => !!l.pmsProjectId)
  const trackedKeys = new Set(links.map((l) => l.projectKey))
  if (trackedKeys.size === 0) {
    throw new RpcError(-32602, 'No PMS-linked project — link one in Setup first')
  }
  const labelOf = (key: string): string => {
    const link = links.find((l) => l.projectKey === key)
    return link?.pmsProjectName || link?.label || key
  }

  // Dùng lại đúng bộ lọc của panel gợi ý: chỉ dự án đã nối, khử trùng phiên↔task.
  const { suggestions } = buildLogtimeSuggestions({
    date,
    sessions,
    tasks,
    trackedProjectKeys: trackedKeys,
  })

  // Thời lượng để model tham khảo: phiên = updatedAt − createdAt; task không có
  // trường thời lượng nên để trống.
  const sessionSpan = new Map<string, number>()
  for (const s of sessions) {
    const span = Date.parse(s.updatedAt) - Date.parse(s.createdAt)
    if (Number.isFinite(span) && span > 0) sessionSpan.set(s.id, span)
  }

  // Gán TAG cho từng dự án CÓ việc trong ngày (P1, P2…) — model tham chiếu bằng tag,
  // KHÔNG bằng projectKey thật (id `prj-…` model chưa từng thấy). `tagToKey` map ngược.
  const keysInPlay = [...new Set(suggestions.map((s) => s.projectKey))]
  const projects: ComposeProject[] = keysInPlay.map((key, i) => ({
    tag: `P${i + 1}`,
    key,
    label: labelOf(key),
  }))
  const keyToTag = new Map(projects.map((p) => [p.key, p.tag]))
  const tagToKey = new Map(projects.map((p) => [p.tag, p.key]))

  // Trích NỘI DUNG thực từng việc để model viết note cụ thể (không chỉ diễn giải tiêu
  // đề). Cả ngày = nhiều phiên ⇒ giới hạn số việc được đọc digest + digest NGẮN hơn
  // bản một-dòng để giữ prompt gọn/rẻ; đọc SONG SONG. Quá `MAX_DIGEST` việc thì các
  // việc sau chỉ có tiêu đề (hiếm khi một ngày > 12 việc đo được).
  const MAX_DIGEST = 12
  const DIGEST_CAP = 600
  const details = await Promise.all(
    suggestions.map(async (s, i) => {
      if (i >= MAX_DIGEST) return undefined
      try {
        if (s.kind === 'session') {
          const sess = await loadSession(s.refId)
          return sess ? buildSessionDigest(sess.messages, DIGEST_CAP) || undefined : undefined
        }
        const task = await loadTask(s.refId)
        const desc = task?.description?.trim()
        return desc ? desc.slice(0, DIGEST_CAP) : undefined
      } catch {
        return undefined
      }
    }),
  )

  const items: ComposeContextItem[] = suggestions.map((s, i) => ({
    kind: s.kind,
    projectTag: keyToTag.get(s.projectKey) ?? 'P1',
    projectLabel: labelOf(s.projectKey),
    title: s.title,
    elapsedLabel: s.kind === 'session' ? formatElapsed(sessionSpan.get(s.refId) ?? 0) : '—',
    ...(s.issue !== undefined ? { issue: s.issue } : {}),
    ...(s.pr !== undefined ? { pr: s.pr } : {}),
    ...(details[i] ? { detail: details[i] } : {}),
  }))

  if (items.length === 0) {
    throw new RpcError(-32602, 'Nothing measured for this day to compose from')
  }

  // Dòng đã khai của ngày (không soạn trùng).
  const month = await loadMonth(monthOf(date))
  const logged: ComposeLoggedItem[] = (month.days[date]?.entries ?? []).map((e) => ({
    projectLabel: labelOf(e.projectKey),
    note: e.note,
    hours: e.hours,
  }))

  // Nhãn nguồn cho dòng "dự án ... (đã nối X)". Rút gọn: tên nguồn PHÂN BIỆT của các
  // dự án đang có việc. Không có tên thì bỏ qua, không dừng cả lượt vì cosmetic.
  const sourceIds = [
    ...new Set(
      keysInPlay
        .map((key) => links.find((l) => l.projectKey === key)?.sourceId)
        .filter((id): id is string => !!id),
    ),
  ]
  const sourceNames: string[] = []
  for (const id of sourceIds) {
    // eslint-disable-next-line no-await-in-loop -- vài nguồn, tuần tự cho gọn
    const src = await loadSourceById(id)
    if (src?.name) sourceNames.push(src.name)
  }

  const promptInput: ComposePromptInput = {
    date,
    budgetHours: settings.dailyHours,
    roundStep: settings.roundStep,
    items,
    logged,
    projects,
    sourceName: sourceNames.join(' · ') || 'PMS',
  }

  const model = modelId ?? 'claude-haiku-4-5'
  log.info('logtime.compose', { model, date, items: items.length, logged: logged.length })

  const text = await completePi({
    ...(accountId ? { accountId } : {}),
    modelId: model,
    systemPrompt: buildComposeSystemPrompt(),
    prompt: buildComposeUserPrompt(promptInput),
  })

  const { lines, parsed } = parseComposeLines(text.trim(), tagToKey)
  if (!parsed) throw new RpcError(-32021, 'Model did not return a usable worklog draft')

  return {
    // Khối context để modal hiện "AWOG chèn sẵn ngữ cảnh vào phiên" như bản phác.
    context: buildComposeContext(promptInput),
    lines,
    budget: settings.dailyHours,
    modelUsed: model,
  }
})
