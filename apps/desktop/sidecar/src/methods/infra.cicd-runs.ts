// `infra.cicd-runs` — nạp bảng xuyên nguồn của màn Triển khai (Mốc 4, task 4.2/4.6).
//
// Bề mặt của CON NGƯỜI, và là một lời gọi ĐẮT: nguồn AWS tốn nhiều lệnh `aws` (mỗi
// lệnh là một tiến trình), nguồn GitHub tốn một `gh run list` cho mỗi dự án. Vì thế
// UI chỉ gọi nó khi mở tab hoặc khi người dùng bấm ↻ — không có `watch`, không có
// nhịp tự làm mới (cùng luật với màn Logs và Explorer).
//
// `sources`/`projects` do UI chọn (nó biết người dùng đang xem dự án nào), nhưng
// MỌI giá trị đi vào argv đều được TRA LẠI ở sidecar: `projectId` → `project.path`
// từ đĩa, và `aws` argv ghép trong `cicd/aws.ts`. Renderer không gửi đường dẫn.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { isValidGhLogin } from '../github/runner.js'
import { CICD_SOURCES, MAX_LIMIT, listCicdRuns } from '../infra/cicd/index.js'

const Context = z
  .object({
    profile: z.string().max(200).optional(),
    region: z.string().max(64).optional(),
    accountId: z.string().max(64).optional(),
  })
  .default({})

const ProjectRef = z
  .object({
    projectId: z.string().min(1).max(200),
    repoPath: z.string().max(500).optional(),
    // '' = tài khoản gh đang active; login lạ bị từ chối TRƯỚC khi vào runner.
    account: z.string().max(60).optional(),
  })
  .superRefine((p, ctx) => {
    const a = p.account ?? ''
    if (a !== '' && !isValidGhLogin(a)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['account'], message: 'invalid gh account' })
    }
  })

const Params = z.object({
  sources: z.array(z.enum(CICD_SOURCES)).max(4).default([...CICD_SOURCES]),
  projects: z.array(ProjectRef).max(24).default([]),
  branch: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(15),
  context: Context,
  surface: z.enum(INFRA_SURFACES).default('pipeline'),
  /** Vé duyệt theo từng nguồn (chỉ có khi ma trận siết nhịp ĐỌC). */
  tickets: z.record(z.enum(CICD_SOURCES), z.string().max(100)).optional(),
  sessionId: z.string().max(200).optional(),
  messageId: z.string().max(200).optional(),
})

register('infra.cicd-runs', async (raw) => {
  const p = Params.parse(raw)
  const results = await listCicdRuns({
    sources: p.sources,
    projects: p.projects,
    limit: p.limit,
    context: p.context,
    surface: p.surface,
    ...(p.branch !== undefined ? { branch: p.branch } : {}),
    ...(p.tickets !== undefined ? { tickets: p.tickets } : {}),
    ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
    ...(p.messageId !== undefined ? { messageId: p.messageId } : {}),
  })
  return { results }
})
