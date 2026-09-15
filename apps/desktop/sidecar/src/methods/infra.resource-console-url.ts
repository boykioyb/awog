// `infra.resource-console-url` — deep link Console cho MỘT dòng (task 3.4).
//
// HAI TÍNH CHẤT, CẢ HAI ĐỀU CỐ Ý:
//   · KHÔNG CHẠY CLI. Đây là hàm thuần ghép chuỗi — bấm "Console ↗" không được
//     tốn một lời gọi API hay một dòng nhật ký `aws`.
//   · PROFILE CHỈ ĐỂ LẤY `sso_start_url`. Chuỗi này KHÔNG đi vào argv, nên nó
//     không phải bề mặt của cổng quyền; nhưng vì nó đọc file profile nên vẫn giới
//     hạn tên profile bằng đúng regex của tầng profiles.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listAwsProfiles } from '../infra/aws/profiles.js'
import { buildConsoleUrl } from '../infra/resources/console-url.js'
import { viewById } from '../infra/resources/registry.js'

const Context = z
  .object({
    profile: z.string().max(200).optional(),
    region: z.string().max(64).optional(),
    accountId: z.string().max(64).optional(),
  })
  .default({})

const Params = z.object({
  viewId: z.string().min(1).max(120),
  row: z.record(z.string().max(4096)).default({}),
  context: Context,
})

register('infra.resource-console-url', async (raw) => {
  const p = Params.parse(raw)
  const spec = viewById(p.viewId)
  if (!spec) return { ok: false as const, error: 'unknown view' }

  let ssoStartUrl = ''
  const name = p.context.profile ?? ''
  if (name !== '') {
    try {
      const profiles = await listAwsProfiles()
      ssoStartUrl = profiles.find((x) => x.name === name)?.ssoStartUrl ?? ''
    } catch {
      // Không đọc được file profile KHÔNG phải lý do để mất nút Console: mở đích
      // trực tiếp vẫn dùng được (chỉ là người dùng có thể phải đăng nhập tay).
      ssoStartUrl = ''
    }
  }

  const url = buildConsoleUrl({
    ...(spec.consoleUrl ? { build: spec.consoleUrl } : {}),
    row: p.row,
    region: p.context.region ?? '',
    ssoStartUrl,
  })
  if (url === null) return { ok: false as const, error: 'no console link' }
  return { ok: true as const, url }
})
