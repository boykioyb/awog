// `infra.profile-secrets` — nạp BA khoá TĨNH của một profile vào form SỬA
// (2026-09-14, yêu cầu: "hiển thị value luôn khi edit lại").
//
// Vì sao có RPC riêng thay vì nhét vào `infra.contexts`: đường LIỆT KÊ profile
// phải tiếp tục không bao giờ chạm secret (invariant #1, ADR 0088 §1) — một
// danh sách 20 profile không được kéo theo 20 cặp khoá vào bộ nhớ renderer.
// Ở đây là đúng MỘT profile, theo TÊN, do người dùng mở form.
//
// Bề mặt của CON NGƯỜI: không AgentTool nào gọi method này (cùng luật với
// `infra.profile-save`: agent không có đường đọc/ghi credential). Method cũng
// không nằm trong catalogue của Remote Gateway nên không ra khỏi máy.
//
// Một dòng nhật ký cho mỗi lần đọc: đây là hành động lấy credential ra khỏi
// `~/.aws`, cùng loại với "xuất kèm khoá" (A6) — câu hỏi "tuần trước cái gì đã
// đọc khoá của tôi" phải trả lời được. `argv` chỉ có TÊN profile.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { recordInfraAction } from '../infra/audit/store.js'
import { throwProfileRpcError } from '../infra/aws/profile-ops.js'
import { readStaticSecrets, type AwsStaticSecrets } from '../infra/aws/secret-read.js'

const Params = z.object({
  name: z.string().min(1).max(128),
})

register('infra.profile-secrets', async (raw): Promise<AwsStaticSecrets> => {
  const p = Params.parse(raw)
  try {
    const secrets = await readStaticSecrets(p.name)
    await recordInfraAction({
      actor: 'human',
      surface: 'settings',
      tool: 'profile_secrets',
      argv: ['read-secrets', p.name],
      context: {},
      class: 'read',
      decision: 'approved',
      result: { summary: 'loaded static keys into the profile editor' },
    })
    return secrets
  } catch (err) {
    throwProfileRpcError(err)
  }
})
