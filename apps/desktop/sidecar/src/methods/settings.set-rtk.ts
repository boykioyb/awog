import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { setRtkEnabled, getRtkStatus } from '../runtime/tools/rtk.js'

// Push the user's RTK toggle (ADR 0031) from the UI settings store down to the
// engine. The bundled binary path is fixed at engine spawn (AWOG_RTK_BIN); this
// only carries the on/off flag. Returns the live status so the UI can show
// whether the bundled binary loaded on this platform and its version.

const Params = z.object({
  enabled: z.boolean(),
})

register(
  'settings.set-rtk',
  async (raw): Promise<{ enabled: boolean; available: boolean; version?: string }> => {
    const params = Params.parse(raw)
    setRtkEnabled(params.enabled)
    return getRtkStatus()
  },
)
