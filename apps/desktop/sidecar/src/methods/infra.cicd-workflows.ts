// `infra.cicd-workflows` — danh sách workflow của một dự án, cho form "kích hoạt
// chạy mới" (task 4.4: `gh workflow run` cần tên file workflow).
//
// Một lời gọi ĐỌC rẻ (`gh workflow list`), chỉ chạy khi người dùng mở form. Trả về
// `path` (tên file) chứ không phải argv: form gửi lại `workflow` + `ref`, và
// `workflowRefOk()` trong `cicd/github.ts` mới là chỗ kiểm hình dạng trước khi vào
// `gh workflow run`.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { isValidGhLogin } from '../github/runner.js'
import { listGithubWorkflows } from '../infra/cicd/index.js'

const Params = z
  .object({
    projectId: z.string().min(1).max(200),
    repoPath: z.string().max(500).optional(),
    account: z.string().max(60).optional(),
  })
  .superRefine((p, ctx) => {
    const a = p.account ?? ''
    if (a !== '' && !isValidGhLogin(a)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['account'], message: 'invalid gh account' })
    }
  })

register('infra.cicd-workflows', async (raw) => {
  const p = Params.parse(raw)
  return listGithubWorkflows({
    projectId: p.projectId,
    ...(p.repoPath !== undefined ? { repoPath: p.repoPath } : {}),
    ...(p.account !== undefined ? { account: p.account } : {}),
  })
})
