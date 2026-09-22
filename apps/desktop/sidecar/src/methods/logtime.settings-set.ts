import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { saveSettings } from '../logtime/store.js'

const Link = z.object({
  projectKey: z.string().min(1),
  label: z.string().optional(),
  sourceId: z.string().min(1),
  pmsProjectId: z.string(),
  pmsProjectName: z.string().optional(),
  githubRepo: z.string().optional(),
  color: z.string().optional(),
})

const Params = z.object({
  dailyHours: z.number().optional(),
  roundStep: z.number().optional(),
  remindAt: z.string().max(5).optional(),
  remindEnabled: z.boolean().optional(),
  // Phải khai ở đây: zod `.parse` BỎ QUA key không khai, nên thiếu dòng này thì
  // `sourceIds` lặng lẽ không bao giờ tới được `saveSettings`.
  sourceIds: z.array(z.string().min(1)).max(50).optional(),
  links: z.array(Link).max(200).optional(),
})

register('logtime.settings-set', async (raw) => ({
  settings: await saveSettings(Params.parse(raw ?? {})),
}))
