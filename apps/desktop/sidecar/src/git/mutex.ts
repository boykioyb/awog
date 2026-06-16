// Per-workspace serialization queue. Read-only fast RPCs bypass; mutate RPCs
// acquire so concurrent writers — parallel Task Engine nodes and the Git Manager
// UI on the same repo — never collide on `.git/index.lock`.
import { RpcError } from '../transport/rpc.js'
import { GIT_RPC_CODE, GitErrorCode } from './error-map.js'

interface MutexOptions {
  timeoutMs?: number
}

const DEFAULT_TIMEOUT = 5_000

const queues = new Map<string, Promise<unknown>>()

export async function withWorkspaceLock<T>(
  workspaceRoot: string,
  fn: () => Promise<T>,
  opts: MutexOptions = {},
): Promise<T> {
  const previous = queues.get(workspaceRoot) ?? Promise.resolve()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT

  // Wait for previous holder OR timeout — whichever comes first.
  let timer: NodeJS.Timeout | undefined
  const waitForSlot = new Promise<'ok' | 'timeout'>((resolveSlot) => {
    timer = setTimeout(() => resolveSlot('timeout'), timeoutMs)
    previous
      .catch(() => undefined)
      .finally(() => {
        if (timer) clearTimeout(timer)
        resolveSlot('ok')
      })
  })

  const slotResult = await waitForSlot
  if (slotResult === 'timeout') {
    throw new RpcError(GIT_RPC_CODE, 'Workspace đang busy, thử lại sau', {
      gitCode: GitErrorCode.BUSY,
    })
  }

  // Claim the slot — chain the new promise so the next waiter sees us.
  let release: () => void = () => undefined
  const slot = new Promise<void>((r) => {
    release = r
  })
  queues.set(workspaceRoot, slot)

  try {
    return await fn()
  } finally {
    release()
    // If nobody else queued behind us, clear the entry to avoid leaks.
    if (queues.get(workspaceRoot) === slot) queues.delete(workspaceRoot)
  }
}
