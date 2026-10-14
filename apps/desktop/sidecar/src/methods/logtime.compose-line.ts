import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import {
  buildLineSummarySystemPrompt,
  buildLineSummaryUserPrompt,
  buildSessionDigest,
  parseLineSummary,
  scrubInternalDetail,
} from '../logtime/compose.js'
import { loadSession } from '../sessions/store.js'
import { loadTask } from '../tasks/store.js'
import { loadSettings } from '../logtime/store.js'
import { fetchGhRefTitle } from '../github/ref-title.js'
import { complete } from '../runtime/complete.js'

// Tóm tắt MỘT gợi ý thành note tiếng Việt khi người dùng bấm "Đưa vào form". Rẻ hơn
// `logtime.compose` (cả ngày) vì chỉ một dòng; gọi mỗi lần bấm nên dùng model nhanh.
//
// KHÔNG ghi gì: chỉ trả chữ note để UI đổ vào form nhanh; người dùng chốt giờ rồi mới
// "Thêm dòng" qua cổng `addEntry`. Link/issue đã biết ở gợi ý nên không cần model rút.
const Params = z.object({
  title: z.string().min(1).max(2000),
  projectLabel: z.string().min(1).max(200).optional(),
  // projectKey → resolve link.githubRepo để fetch tiêu đề thật của issue/PR — nguồn
  // duy nhất nói việc là TÍNH NĂNG gì (title phiên thường chỉ là URL).
  projectKey: z.string().min(1).max(120).optional(),
  issue: z.number().int().positive().optional(),
  pr: z.number().int().positive().optional(),
  kind: z.enum(['session', 'task']),
  // id phiên/tác vụ để đọc NỘI DUNG thực → note cụ thể (không chỉ diễn giải tiêu đề).
  refId: z.string().min(1).max(200).optional(),
  // Nháp người dùng gõ ("Sửa bằng AI") — model khai thác theo hướng đó.
  seed: z.string().max(2000).optional(),
  accountId: z.string().min(1).max(120).optional(),
  modelId: z.string().min(1).max(200).optional(),
})

// Trích nội dung thực để model viết note cụ thể. Phiên → digest (hỏi đầu + kết quả
// cuối); tác vụ → mô tả. Đọc hỏng/không có ⇒ undefined, model lùi về chỉ-tiêu-đề.
async function loadDetail(kind: 'session' | 'task', refId: string): Promise<string | undefined> {
  try {
    if (kind === 'session') {
      const s = await loadSession(refId)
      if (!s) return undefined
      const digest = buildSessionDigest(s.messages)
      return digest ? scrubInternalDetail(digest) || undefined : undefined
    }
    const task = await loadTask(refId)
    const desc = task?.description?.trim()
    return desc ? scrubInternalDetail(desc.slice(0, 2000)) || undefined : undefined
  } catch {
    return undefined
  }
}

register('logtime.composeLine', async (raw) => {
  const { title, projectLabel, projectKey, issue, pr, kind, refId, seed, accountId, modelId } = Params.parse(raw)
  const model = modelId ?? 'claude-haiku-4-5'
  const detail = refId ? await loadDetail(kind, refId) : undefined
  // Tiêu đề thật của issue/PR — đưa vào detail dưới dạng dòng "Việc:" để model viết
  // note theo TÍNH NĂNG, không theo quy trình kiểm tra.
  let refTitle: string | undefined
  if (projectKey) {
    const link = (await loadSettings()).links.find((l) => l.projectKey === projectKey)
    if (link?.githubRepo && (issue !== undefined || pr !== undefined)) {
      // PR trước — PR mang tên tính năng; hỏng thì rơi về issue, rồi không-có-title.
      refTitle =
        (pr !== undefined ? await fetchGhRefTitle(link.githubRepo, 'pull', pr) : null) ??
        (issue !== undefined ? await fetchGhRefTitle(link.githubRepo, 'issue', issue) : null) ??
        undefined
    }
  }
  const seedTrim = seed?.trim()
  log.info('logtime.composeLine', {
    model,
    kind,
    hasIssue: issue !== undefined,
    hasPr: pr !== undefined,
    hasDetail: detail !== undefined,
    hasSeed: !!seedTrim,
  })

  const text = await complete({
    ...(accountId ? { accountId } : {}),
    modelId: model,
    systemPrompt: buildLineSummarySystemPrompt(),
    prompt: buildLineSummaryUserPrompt({
      title,
      ...(projectLabel ? { projectLabel } : {}),
      ...(issue !== undefined ? { issue } : {}),
      ...(pr !== undefined ? { pr } : {}),
      kind,
      // "Việc:" đứng trước digest để model đọc tính năng trước, rồi mới tới quy trình.
      ...(refTitle || detail
        ? {
            detail: [refTitle ? `Việc: ${refTitle}` : '', detail ?? ''].filter(Boolean).join('\n'),
          }
        : {}),
      ...(seedTrim ? { seed: seedTrim } : {}),
    }),
  })

  const note = parseLineSummary(text)
  if (!note) throw new RpcError(-32021, 'Model returned an empty summary')
  return { note }
})
