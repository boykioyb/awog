// `infra.logs-streams` — liệt kê các LOG STREAM của một group (tầng giữa của
// CloudWatch: group → stream → event, Mốc 2 việc 2.9, bề mặt CON NGƯỜI).
//
// VÌ SAO RẺ + ĐƯỢC TỰ CHẠY. `describe-log-streams` là đọc METADATA thuần (tên +
// mốc thời gian + dung lượng), KHÔNG tính tiền theo GB quét như Insights — cùng
// hạng với `describe-log-groups`. Nên màn Logs được phép chạy ngay khi người dùng
// bấm vào một group để lộ danh sách stream, không phá luật "không tự chạy Insights".
//
// Bề mặt của CON NGƯỜI: chạy với `decision: 'approved'` + `actor: 'human'`. Kết quả
// chỉ là tên stream (không phải nội dung log) nhưng vẫn đi qua `runInfra` đã redact.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { listLogStreams } from '../infra/aws/logs.js'

const Params = z.object({
  logGroup: z.string().min(1).max(512),
  limit: z.number().int().positive().max(50).optional(),
  profile: z.string().min(1).max(128).optional(),
  region: z.string().min(1).max(64).optional(),
  surface: z.enum(INFRA_SURFACES).default('logs'),
})

register('infra.logs-streams', async (raw) => {
  const p = Params.parse(raw)
  const result = await listLogStreams({
    logGroup: p.logGroup,
    surface: p.surface,
    actor: 'human',
    ...(p.limit !== undefined ? { limit: p.limit } : {}),
    ...(p.profile !== undefined ? { profile: p.profile } : {}),
    ...(p.region !== undefined ? { region: p.region } : {}),
  })
  // Lỗi CLI (quyền thiếu, region sai, hết phiên SSO) là KẾT QUẢ hợp lệ, không phải
  // sự cố RPC: UI phải hiện được câu của AWS thay vì "Internal error".
  if (!result.ok) return { ok: false as const, error: result.error }
  return { ok: true as const, streams: result.value.streams, truncated: result.value.truncated }
})
