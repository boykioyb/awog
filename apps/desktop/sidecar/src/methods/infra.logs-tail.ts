// `infra.logs-tail` — đọc các DÒNG LOG mới nhất của một (vài) nhóm log qua
// `filter-log-events` (Mốc 2 việc 2.9, bề mặt CON NGƯỜI).
//
// VÌ SAO TÁCH KHỎI INSIGHTS. `filter-log-events` KHÔNG tính tiền theo GB quét như
// Insights — nó là read thường theo số request. Nhờ vậy màn Logs được phép TỰ CHẠY
// lệnh này ngay khi người dùng bấm vào một nhóm log để xem dòng mới nhất, mà không
// phá luật "không tự chạy Insights" (luật đó chỉ áp cho `start-query`).
//
// Cú bấm của người dùng CHÍNH LÀ sự cho phép: `tailWindow` chạy với
// `decision: 'approved'` + `actor: 'human'`, và `runInfra` đã redact stdout TRƯỚC
// khi nó rời tiến trình — nên dòng log hiện trên màn đều đã qua lớp lọc (invariant #1).
// Method này KHÔNG tự redact lại.
//
// Bề mặt của CON NGƯỜI. AgentTool `logs_tail_window` (infra-tools.ts) đi đường
// riêng với cổng quyền `sensitive`; method này không dành cho agent.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { tailWindow } from '../infra/aws/logs.js'

const Params = z.object({
  logGroups: z.array(z.string().min(1).max(512)).min(1).max(25),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  filterPattern: z.string().max(1024).optional(),
  logStreamName: z.string().min(1).max(512).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  /** Token trang kế của lượt trước. Có ⇒ đọc TIẾP thay vì đọc lại từ đầu. */
  nextToken: z.string().min(1).max(8192).optional(),
  profile: z.string().min(1).max(128).optional(),
  region: z.string().min(1).max(64).optional(),
  surface: z.enum(INFRA_SURFACES).default('logs'),
})

register('infra.logs-tail', async (raw) => {
  const p = Params.parse(raw)
  const result = await tailWindow({
    logGroups: p.logGroups,
    startMs: p.startMs,
    endMs: p.endMs,
    surface: p.surface,
    actor: 'human',
    ...(p.filterPattern !== undefined ? { filterPattern: p.filterPattern } : {}),
    ...(p.logStreamName !== undefined ? { logStreamName: p.logStreamName } : {}),
    ...(p.limit !== undefined ? { limit: p.limit } : {}),
    ...(p.nextToken !== undefined ? { nextToken: p.nextToken } : {}),
    ...(p.profile !== undefined ? { profile: p.profile } : {}),
    ...(p.region !== undefined ? { region: p.region } : {}),
  })
  // Lỗi CLI (quyền thiếu, region sai, hết phiên SSO) là KẾT QUẢ hợp lệ, không phải
  // sự cố RPC: UI phải hiện được câu của AWS thay vì "Internal error".
  if (!result.ok) return { ok: false as const, error: result.error }
  return {
    ok: true as const,
    events: result.value.events,
    truncated: result.value.truncated,
    nextToken: result.value.nextToken,
  }
})
