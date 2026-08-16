import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { getModels } from '@earendil-works/pi-ai/compat'
import type { Api, Model } from '@earendil-works/pi-ai'
import { register, RpcError } from '../transport/rpc.js'
import { emit } from '../transport/stdio.js'
import { loginCodex } from '../auth/openai-codex-oauth.js'
import { putFlow, removeFlow } from '../auth/oauth-flow-store.js'
import { loadCredentials, saveCredentials, toSafe } from '../credentials/store.js'
import { log } from '../util/logger.js'
import type { AccountRecord, PiOAuthCredentials } from '../types/shared.js'

// Connect a ChatGPT Plus/Pro subscription via the OpenAI Codex browser (loopback)
// OAuth flow (ADR 0029). LONG-LIVED RPC: it returns ONLY after the user authorizes
// in their browser (pi's localhost callback captures the redirect) or the flow is
// cancelled. While waiting it emits an `auth.oauth-url` event carrying the
// authorize URL so the UI can open it. On success it persists an oauth
// AccountRecord carrying the raw pi credential blob (piOAuth) and returns the safe
// view.
//
// Cancel path: the UI calls `auth.cancelOAuth` with the same flowId → the
// AbortController fires → loginCodex's onManualCodeInput lever rejects → pi
// cancels its wait and throws → this RPC throws CANCELED.

const Params = z.object({
  // Echoed in events so the UI can correlate (and cancel) this specific flow.
  flowId: z.string().min(1),
  label: z.string().trim().min(1).optional(),
})

function newAccountId(): string {
  return `acc_${randomBytes(8).toString('hex')}`
}

// Codex subscription model ids surfaced to the agent/session model picker via
// account.models (reuses the custom-endpoint pattern). Best-effort: an empty
// list just means the picker falls back to whatever it knows. Never throws.
function codexModelIds(): string[] {
  try {
    return (getModels('openai-codex') as readonly Model<Api>[]).map((m) => m.id)
  } catch (err) {
    log.warn('list codex models failed', {
      err: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

register('auth.startOAuthCodex', async (raw) => {
  const params = Params.parse(raw)

  const controller = new AbortController()
  putFlow(params.flowId, controller)

  log.info('codex oauth flow started', { flowId: params.flowId })

  let creds: PiOAuthCredentials
  try {
    creds = await loginCodex((info) => {
      // Surface the authorize URL to the UI. No secret here — just the public
      // OAuth authorize URL (+ a human hint) the UI opens in the browser.
      emit('auth.oauth-url', {
        provider: 'openai',
        flowId: params.flowId,
        url: info.url,
        instructions: info.instructions,
      })
    }, controller.signal)
  } catch (err) {
    if (controller.signal.aborted) {
      throw new RpcError(-32023, 'CANCELED')
    }
    const message = err instanceof Error ? err.message : String(err)
    // Token/blob never appear in login errors, but keep the surface minimal.
    throw new RpcError(-32002, `codex login failed: ${message}`)
  } finally {
    removeFlow(params.flowId)
  }

  const models = codexModelIds()
  const record: AccountRecord = {
    id: newAccountId(),
    label: params.label ?? 'ChatGPT subscription',
    authMode: 'oauth',
    piOAuth: creds,
    version: 0,
    createdAt: new Date().toISOString(),
  }
  if (models.length) record.models = models

  const data = await loadCredentials()
  data.providers.openai.accounts.push(record)
  if (data.providers.openai.activeAccountId === null) {
    data.providers.openai.activeAccountId = record.id
  }
  await saveCredentials(data)

  log.info('codex oauth account added', { accountId: record.id, models: models.length })

  return toSafe(record)
})
