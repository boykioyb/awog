// Khoá liên-tiến-trình cho pipeline build sidecar (`scripts/build.mjs`).
//
// VÌ SAO CẦN: build ghi vào hai vùng dùng chung mà không có gì trọng tài —
// `apps/desktop/sidecar/dist/` (bị `rm -rf` rồi dựng lại từ đầu) và
// `node_modules` của workspace (`pnpm deploy` bày thư mục tạm ở đó). Hai build
// chạy song song là hỏng thật, đã quan sát được: `pnpm build` chết với
// `ENOENT … node_modules/zod_tmp_42817_8` vì thư mục tạm của `pnpm` biến mất
// giữa lúc `cp` đang chép cây deploy chưa settle. Máy này thường xuyên có nhiều
// phiên agent cùng làm việc trên repo, nên đây không phải trường hợp hiếm.
//
// NGUYÊN TẮC THIẾT KẾ SỐ MỘT: khoá KHÔNG BAO GIỜ được wedge vĩnh viễn. Một khoá
// sót lại từ tiến trình bị `Ctrl+C`/kill mà bắt người ta đi xoá tay là một khoá
// người ta sẽ vô hiệu hoá. Vì thế bản ghi khoá mang PID + host + mốc thời gian,
// và khoá chết bị thu hồi tự động theo hai tiêu chí độc lập:
//   1. tiến trình giữ khoá không còn sống (`kill(pid, 0)`), hoặc
//   2. khoá quá già so với trần tuổi (build thật ~1 phút, trần 15 phút).
// Tiêu chí (2) là lưới an toàn cho các trường hợp (1) không kết luận được: máy
// sập rồi PID được cấp lại cho tiến trình khác, hoặc lock file đến từ host khác.
//
// Module này KHÔNG import gì từ `src/` một cách cố ý: `build.mjs` chạy TRƯỚC khi
// tsc sinh ra `dist/`, nên mọi thứ nó cần phải là JS thuần chạy ngay.

import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { hostname } from 'node:os'
import process from 'node:process'

// Build thật mất khoảng một phút. Trần tuổi rộng gấp ~15 lần để không bao giờ
// cướp khoá của một build chậm nhưng lành mạnh, mà vẫn tự thoát nếu khoá chết.
export const DEFAULT_STALE_AFTER_MS = 15 * 60_000

// Chờ có trần: xem ghi chú "CHỜ HAY THẤT BẠI" ở `acquireBuildLock`.
export const DEFAULT_TIMEOUT_MS = 3 * 60_000
export const DEFAULT_POLL_INTERVAL_MS = 500

// Nhắc lại "vẫn đang chờ" theo nhịp này để người ngồi trước terminal biết build
// còn sống chứ không treo.
export const NOTICE_INTERVAL_MS = 15_000

// Lock file được tạo bằng `open(wx)` (nguyên tử) rồi mới ghi nội dung, nên có
// một khe cực hẹp đọc trúng file rỗng. Coi bản ghi hỏng là chết sau khe này.
export const MALFORMED_GRACE_MS = 5_000

export class BuildLockTimeoutError extends Error {
  constructor(message, holder) {
    super(message)
    this.name = 'BuildLockTimeoutError'
    this.holder = holder
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))
const defaultLog = (msg) => console.error(msg)

// `kill(pid, 0)` không gửi tín hiệu, chỉ hỏi "PID này còn không".
// EPERM = có tồn tại nhưng thuộc user khác ⇒ vẫn tính là còn sống.
export function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM'
  }
}

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m`
}

// Đọc chủ khoá hiện tại. Trả về null nếu khoá vừa biến mất (chủ nhả xong).
function readHolder(lockPath) {
  let raw
  try {
    raw = readFileSync(lockPath, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed?.startedAt !== 'number') throw new Error('missing startedAt')
    return { pid: parsed.pid ?? null, host: parsed.host ?? null, startedAt: parsed.startedAt }
  } catch {
    // Rỗng hoặc rác: không biết ai giữ. Lấy mtime làm tuổi và để
    // MALFORMED_GRACE_MS quyết định — đừng để một file hỏng khoá cứng repo.
    // (Tuổi ở nhánh này đo bằng đồng hồ của filesystem, nên `now` tiêm vào phải
    // là giờ thật chứ không phải một mốc bịa.)
    let mtimeMs = 0
    try {
      mtimeMs = statSync(lockPath).mtimeMs
    } catch (err) {
      if (err?.code === 'ENOENT') return null
      throw err
    }
    return { pid: null, host: null, startedAt: mtimeMs, malformed: true }
  }
}

// Vì sao khoá này chết — trả về chuỗi lý do (để in ra), hoặc null nếu còn sống.
export function staleReason(holder, { at, staleAfterMs, host, isAlive }) {
  const age = Math.max(0, at - holder.startedAt)
  if (holder.malformed) {
    return age >= MALFORMED_GRACE_MS ? `lock file is unreadable and ${formatMs(age)} old` : null
  }
  // PID chỉ có ý nghĩa trên chính máy đã ghi khoá.
  if (holder.host === host && !isAlive(holder.pid)) {
    return `pid ${holder.pid} is gone`
  }
  if (age >= staleAfterMs) {
    return `held for ${formatMs(age)}, past the ${formatMs(staleAfterMs)} ceiling`
  }
  return null
}

function sameHolder(a, b) {
  return Boolean(a && b && a.pid === b.pid && a.host === b.host && a.startedAt === b.startedAt)
}

// Tạo khoá nguyên tử. `wx` = fail nếu đã tồn tại, nên chỉ một tiến trình thắng.
function tryCreate(lockPath, record) {
  let fd
  try {
    fd = openSync(lockPath, 'wx')
  } catch (err) {
    if (err?.code === 'EEXIST') return false
    throw err
  }
  try {
    writeSync(fd, `${JSON.stringify(record)}\n`)
  } finally {
    closeSync(fd)
  }
  return true
}

// Thu hồi khoá chết. Đọc lại ngay trước khi xoá và chỉ xoá đúng bản ghi vừa kết
// luận là chết — nếu một waiter khác đã thu hồi và đặt khoá mới của nó vào chỗ
// đó thì ta không được xoá nhầm. Khe TOCTOU còn lại chỉ dài bằng một lần đọc +
// một lần unlink, và kẻ thắng cuối cùng vẫn do `open(wx)` nguyên tử quyết định.
function reclaim(lockPath, holder) {
  const current = readHolder(lockPath)
  if (!current || !sameHolder(current, holder)) return
  try {
    unlinkSync(lockPath)
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err
  }
}

/**
 * Giành khoá build. Trả về handle có `release()` (đồng bộ, idempotent).
 *
 * CHỜ HAY THẤT BẠI NGAY: chờ, nhưng CÓ TRẦN (mặc định 3 phút ≈ hai build xếp
 * hàng). Thất bại ngay sẽ phá cách dùng phổ biến nhất — người gõ `pnpm build`
 * trong khi một phiên agent đang build — biến một lần chờ 40 giây thành một lỗi
 * phải xử lý tay. Còn chờ vô hạn thì đúng cái tệ hơn báo lỗi trong CI/agent:
 * job treo tới lúc bị timeout ở tầng ngoài, không ai biết vì sao. Trần thời gian
 * lấy được cả hai: hàng đợi bình thường thì trôi, còn kẹt thật thì bỏ cuộc với
 * thông báo nêu đích danh PID đang giữ. `AWOG_BUILD_LOCK_TIMEOUT_MS=0` cho CI
 * muốn fail ngay.
 */
export async function acquireBuildLock(options = {}) {
  const {
    lockPath,
    pid = process.pid,
    host = hostname(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    now = Date.now,
    isAlive = processIsAlive,
    sleep = defaultSleep,
    log = defaultLog,
    proc = process,
    installExitHandlers = true,
  } = options
  if (!lockPath) throw new Error('acquireBuildLock: lockPath is required')

  const waitStartedAt = now()
  let announced = false
  let lastNoticeAt = 0

  for (;;) {
    const record = { pid, host, startedAt: now() }
    if (tryCreate(lockPath, record)) {
      return createHandle({ lockPath, record, log, proc, installExitHandlers })
    }

    const holder = readHolder(lockPath)
    if (holder) {
      const reason = staleReason(holder, { at: now(), staleAfterMs, host, isAlive })
      if (reason) {
        log(`[build] reclaiming stale lock at ${lockPath} (${reason})`)
        reclaim(lockPath, holder)
        continue
      }
    }

    const waited = now() - waitStartedAt
    if (waited >= timeoutMs) {
      throw new BuildLockTimeoutError(
        `[build] gave up after ${formatMs(waited)} waiting for the build lock at ${lockPath}` +
          `${describeHolder(holder, now())}. Wait for it to finish, raise` +
          ' AWOG_BUILD_LOCK_TIMEOUT_MS, or delete the file if that process is gone.',
        holder,
      )
    }

    // Không bao giờ chờ im lặng: nói ai đang giữ và ta đang chờ bao lâu nữa.
    if (!announced) {
      log(
        `[build] build lock is held${describeHolder(holder, now())} — waiting up to` +
          ` ${formatMs(timeoutMs)}`,
      )
      announced = true
      lastNoticeAt = now()
    } else if (now() - lastNoticeAt >= NOTICE_INTERVAL_MS) {
      log(`[build] still waiting for the build lock (${formatMs(waited)} so far)`)
      lastNoticeAt = now()
    }
    await sleep(pollIntervalMs)
  }
}

function describeHolder(holder, at) {
  if (!holder) return ''
  if (holder.malformed)
    return ` by an unreadable lock file (${formatMs(at - holder.startedAt)} old)`
  return ` by pid ${holder.pid} on ${holder.host} (${formatMs(at - holder.startedAt)} ago)`
}

function createHandle({ lockPath, record, log, proc, installExitHandlers }) {
  let released = false

  // Đồng bộ để dùng được trong handler 'exit' của Node (async không chạy ở đó).
  const release = () => {
    if (released) return
    released = true
    if (installExitHandlers) {
      proc.removeListener('exit', onExit)
      for (const sig of SIGNALS) proc.removeListener(sig, handlers[sig])
    }
    const current = readHolder(lockPath)
    if (!current) return
    if (!sameHolder(current, record)) {
      // Khoá của ta đã bị thu hồi (ta chạy quá trần tuổi) và người khác đang
      // giữ. Xoá bây giờ là cướp khoá của họ.
      log(`[build] build lock was taken over by pid ${current.pid} — leaving it alone`)
      return
    }
    try {
      unlinkSync(lockPath)
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err
    }
  }

  const onExit = () => release()
  const handlers = {}
  const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']
  if (installExitHandlers) {
    // Nhả trên MỌI đường thoát. 'exit' bắt cả `process.exit(1)` ở nhánh lỗi của
    // build.mjs lẫn uncaughtException; tín hiệu thì phải bắt tay vì hành vi mặc
    // định là chết ngay, không chạy 'exit'. Sau khi nhả, thoát bằng mã 128+n —
    // đúng quy ước shell cho "bị tín hiệu giết", và tất định hơn re-raise.
    for (const sig of SIGNALS) {
      handlers[sig] = () => {
        release()
        proc.exit(sig === 'SIGINT' ? 130 : sig === 'SIGHUP' ? 129 : 143)
      }
      proc.on(sig, handlers[sig])
    }
    proc.on('exit', onExit)
  }

  return { path: lockPath, record, release }
}

/** Chạy `fn` dưới khoá build và nhả khoá kể cả khi `fn` ném. */
export async function withBuildLock(fn, options = {}) {
  const lock = await acquireBuildLock(options)
  try {
    return await fn(lock)
  } finally {
    lock.release()
  }
}
