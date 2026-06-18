// Per-workspace serialization queue. Read-only fast RPCs bypass; mutate RPCs
// acquire so concurrent writers — parallel Task Engine nodes and the Git Manager
// UI on the same repo — never collide on `.git/index.lock`.
//
// Claim is SYNCHRONOUS: an uncontended lock flips `held` before `acquire`
// returns, so a sibling RPC entering in the same tick (e.g. "stage all" firing N
// `git.stageFile` calls back-to-back) observes the lock held and queues instead
// of racing. A timed-out waiter is removed from the queue without acquiring, so
// it never breaks the chain — the real holder still hands off to the next live
// waiter on release.
import { RpcError } from '../transport/rpc.js'
import { GIT_RPC_CODE, GitErrorCode } from './error-map.js'

interface MutexOptions {
  timeoutMs?: number
}

const DEFAULT_TIMEOUT = 5_000

type Waiter = {
  grant: () => void
  timer: NodeJS.Timeout
  // Guards the race between release() handing off and the timeout firing.
  done: boolean
}

type LockState = {
  held: boolean
  waiters: Waiter[]
}

const locks = new Map<string, LockState>()

function busyError(): RpcError {
  return new RpcError(GIT_RPC_CODE, 'Workspace đang busy, thử lại sau', {
    gitCode: GitErrorCode.BUSY,
  })
}

// Resolves when the caller owns the lock; rejects with BUSY if the wait exceeds
// `timeoutMs`. Uncontended path claims synchronously (no await before `held`).
function acquire(workspaceRoot: string, timeoutMs: number): Promise<void> {
  let state = locks.get(workspaceRoot)
  if (!state) {
    state = { held: false, waiters: [] }
    locks.set(workspaceRoot, state)
  }
  const lock = state
  if (!lock.held) {
    lock.held = true
    return Promise.resolve()
  }
  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      done: false,
      grant: resolve,
      timer: setTimeout(() => {
        if (waiter.done) return
        waiter.done = true
        const idx = lock.waiters.indexOf(waiter)
        if (idx >= 0) lock.waiters.splice(idx, 1)
        reject(busyError())
      }, timeoutMs),
    }
    lock.waiters.push(waiter)
  })
}

// Hand off to the next live waiter (skipping any that already timed out), or
// mark the lock free and drop the entry if nobody is queued.
function release(workspaceRoot: string): void {
  const lock = locks.get(workspaceRoot)
  if (!lock) return
  let next = lock.waiters.shift()
  while (next && next.done) next = lock.waiters.shift()
  if (next) {
    next.done = true
    clearTimeout(next.timer)
    next.grant() // lock stays held; ownership transfers to `next`
    return
  }
  lock.held = false
  if (lock.waiters.length === 0) locks.delete(workspaceRoot)
}

export async function withWorkspaceLock<T>(
  workspaceRoot: string,
  fn: () => Promise<T>,
  opts: MutexOptions = {},
): Promise<T> {
  await acquire(workspaceRoot, opts.timeoutMs ?? DEFAULT_TIMEOUT)
  try {
    return await fn()
  } finally {
    release(workspaceRoot)
  }
}
