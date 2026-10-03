import { ZodError } from 'zod'
import { log } from '../util/logger.js'

export type Handler = (params: unknown) => Promise<unknown> | unknown

export class RpcError extends Error {
  public readonly code: number

  public readonly data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    if (data !== undefined) this.data = data
  }
}

const registry = new Map<string, Handler>()

export function register(method: string, handler: Handler): void {
  if (registry.has(method)) {
    throw new Error(`RPC method already registered: ${method}`)
  }
  registry.set(method, handler)
}

// Names of every registered RPC method. The Remote Gateway (Electron main) calls
// `system.methods` at boot to validate its static allowlist against reality —
// catching a typo'd method name (e.g. hyphen vs camelCase) as a fail-fast rather
// than a silent fail-open. Registry is module-private, so this is the only way out.
export function listMethods(): string[] {
  return [...registry.keys()]
}

export async function dispatch(method: string, params: unknown): Promise<unknown> {
  const handler = registry.get(method)
  if (!handler) {
    throw new RpcError(-32601, `Method not found: ${method}`)
  }
  try {
    // Wire form "no params" is `params: null` (ui's useSidecar sends null when the
    // caller omits the arg), but handler schemas express it as `.optional()` —
    // zod's optional accepts `undefined`, NOT null. Normalize at the boundary so
    // every method sees "absent"; a top-level `null` is never a meaningful value
    // (all real nulls live in nested fields like `agent: .nullable()`).
    return await handler(params ?? undefined)
  } catch (err) {
    if (err instanceof RpcError) throw err
    if (err instanceof ZodError) {
      // Surface WHICH params failed — 'Invalid params' alone is undebuggable
      // (client banner shows only message; issues stay in `data` for detail).
      log.warn('rpc invalid params', { method, issues: err.issues })
      const summary = err.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join(' · ')
      throw new RpcError(-32602, `Invalid params — ${summary}`, { issues: err.issues })
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new RpcError(-32603, 'Internal error', { message })
  }
}
