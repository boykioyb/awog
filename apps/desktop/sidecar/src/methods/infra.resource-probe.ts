// `infra.resource-probe` — dò quyền ghi lúc mở màn (task 3.3).
//
// Kết cục `unknown` là kết cục THẬT và thường gặp (`iam:SimulatePrincipalPolicy`
// không nằm trong policy thông dụng). UI phải xử nó như "không biết", tức vẫn
// hiện nút ghi kèm hộp duyệt — không được coi `unknown` là `denied` rồi giấu nút
// của người dùng có quyền.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { probePermissions } from '../infra/resources/probe.js'
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
  context: Context,
  surface: z.enum(INFRA_SURFACES).default('explorer'),
})

register('infra.resource-probe', async (raw) => {
  const p = Params.parse(raw)
  const spec = viewById(p.viewId)
  if (!spec?.probe) return { verdict: 'unknown' as const, deniedActions: [] }
  return probePermissions({
    actions: spec.probe.actions,
    context: p.context,
    surface: p.surface,
  })
})
