// infra.monitor-targets → danh mục TÀI NGUYÊN GIÁM SÁT (ECS service · ALB · RDS ·
// SQS · EC2) cho ô chọn của màn Giám sát. Toàn bộ lý do, phép cắt định danh và
// việc dựng sẵn `dimensions` của CloudWatch nằm ở `infra/monitor-targets.ts`.
//
// CHỈ CHẠY KHI NGƯỜI DÙNG BẤM. Màn Giám sát cố ý không tự đi dò tài nguyên (mỗi
// lượt dò là thêm lời gọi AWS), nên UI gọi method này theo yêu cầu và tự cache.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { listMonitorTargets, type MonitorTargets } from '../infra/monitor-targets.js'

// `surface` do người gọi truyền, hệt `infra.metrics`: lượt dò phải nằm cùng cột
// "ai" với lượt nạp metric ngay sau nó trong sổ.
const Params = z.object({
  profile: z.string().max(200).optional(),
  region: z.string().max(80).optional(),
  surface: z.enum(INFRA_SURFACES).default('explorer'),
})

register('infra.monitor-targets', async (raw): Promise<MonitorTargets> => {
  const params = Params.parse(raw)
  return listMonitorTargets(params)
})
