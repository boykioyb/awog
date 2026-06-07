import { z } from 'zod'
import { register } from '../transport/rpc.js'
import {
  getPermissionSuggestions,
  resolvePermissionRequest,
} from '../sessions/permissions.js'
import { log } from '../util/logger.js'
import type { PermissionResult } from '../runtime/permission-types.js'

const Params = z.object({
  requestId: z.string().min(1),
  decision: z.enum(['allow', 'deny']),
  alwaysAllow: z.boolean().optional(),
  updatedInput: z.record(z.unknown()).optional(),
})

// Resolves a parked canUseTool promise with the user's choice from the UI.
// Idempotent: if the request was already handled (race with cancel), returns
// `{ resolved: false }` so the UI knows the prompt is stale and can dismiss it.
register('sessions.permission', async (raw) => {
  const params = Params.parse(raw)

  let result: PermissionResult
  if (params.decision === 'allow') {
    const allowed: PermissionResult = { behavior: 'allow' }
    if (params.updatedInput !== undefined) allowed.updatedInput = params.updatedInput
    if (params.alwaysAllow) {
      const suggestions = getPermissionSuggestions(params.requestId) ?? []
      if (suggestions.length > 0) allowed.updatedPermissions = suggestions
    }
    result = allowed
  } else {
    result = { behavior: 'deny', message: 'User denied via UI' }
  }

  const resolved = resolvePermissionRequest(params.requestId, result)
  log.info('sessions.permission', {
    requestId: params.requestId,
    decision: params.decision,
    alwaysAllow: params.alwaysAllow === true,
    resolved,
  })
  return { resolved }
})
