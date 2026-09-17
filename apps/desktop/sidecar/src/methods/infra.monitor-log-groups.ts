// `infra.monitor-log-groups` → nhóm log của tài nguyên đang xem ở màn Giám sát.
// Toàn bộ lý do + hai mức tin cậy (`exact` / `guess`) ở `infra/monitor-log-groups.ts`.
//
// CHỈ CHẠY KHI NGƯỜI DÙNG BẤM, và nó là bước RẺ đứng trước bước đắt: người dùng
// thấy nhóm log rồi mới quyết có chạy Insights (tính tiền theo GB quét) hay không.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { MONITOR_KINDS } from '../infra/monitor-targets.js'
import { monitorLogGroups, type MonitorLogGroups } from '../infra/monitor-log-groups.js'

const Params = z.object({
  kind: z.enum(MONITOR_KINDS),
  name: z.string().min(1).max(512),
  cluster: z.string().min(1).max(512).optional(),
  profile: z.string().max(200).optional(),
  region: z.string().max(80).optional(),
  surface: z.enum(INFRA_SURFACES).default('explorer'),
})

register('infra.monitor-log-groups', async (raw): Promise<MonitorLogGroups> => {
  const p = Params.parse(raw)
  return monitorLogGroups({
    kind: p.kind,
    name: p.name,
    ...(p.cluster !== undefined ? { cluster: p.cluster } : {}),
    ...(p.profile ? { profile: p.profile } : {}),
    ...(p.region ? { region: p.region } : {}),
    surface: p.surface,
  })
})
