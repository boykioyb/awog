// Cổng duyệt ĐIỀU PHỐI — popover "mở phiên con" của tool `create_session` và
// popover "bật tự-giao nhóm" của tool `arm_group` (block cuối file).
//
// Bản chất giống hệt questions.ts / permission.ts: lời gọi tool park một Promise
// ở đây, popover cấu hình trên renderer trả lời qua RPC `sessions.spawnResolve`,
// promise héo cho tool chạy tiếp — hoặc trả kết quả "người dùng không duyệt".
//
// Vì sao là CỔNG RIÊNG chứ không đi nhờ thẻ duyệt quyền chung: người dùng không
// chỉ duyệt có/không — họ còn SỬA được danh sách phiên con và chọn cấu hình
// (account/model/level/style/mode) trước khi đồng ý, kèm lựa chọn "nhớ cho cả
// nhóm". Thẻ quyền chung không mang được payload đó, và một lượt duyệt ở đây
// còn chính là lần duyệt duy nhất của cả workflow khi `groupSpawnConfig` được ghi.
//
// Park diễn ra TRONG thân tool (không ở cổng quyền). Popover này LÀ cổng người
// duy nhất của spawn, nên nó đứng yên trên mọi mode ngoại trừ **execute** —
// bypass theo nguyên tắc "duyệt một lần rồi cứ chạy": phiên execute gọi
// create_session đẻ thẳng (session-tools.ts, đoạn nhánh execute trước chỗ gọi
// hàm này), và cổng DENY / chặn cứng plan mode ở permission.ts không đổi.

import { randomBytes } from 'node:crypto'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { MAX_TEXT_LEN } from './inbox.js'
import type { SpawnChildSpec, SpawnSessionConfig } from '../types/shared.js'

// Những gì người dùng quyết trong popover.
export interface SpawnResolution {
  approved: boolean
  // Danh sách phiên con SAU KHI chỉnh trong popover (bỏ bớt/sửa tên/vai/việc).
  // Vắng mặt = nguyên bản model đề xuất.
  children?: SpawnChildSpec[]
  // Cấu hình CHUNG người dùng chọn — đè lên settings kế thừa của phiên cha.
  config?: SpawnSessionConfig
  // "Nhớ cho cả nhóm" — RPC `sessions.spawnResolve` ghi nó lên gốc nhóm thành
  // `groupSpawnConfig` TRƯỚC khi request héo, nên lần đẻ sau bỏ qua popover.
  remember?: boolean
  // Lời từ chối tự do, trả lại cho model đọc.
  message?: string
  // Request chết vì lượt bị huỷ, không phải người dùng bấm Từ chối.
  aborted?: boolean
}

interface ParkedSpawn {
  sessionId: string
  // Gốc của nhóm chứa phiên đang gọi — chỗ `groupSpawnConfig`/`groupAutoDeliver`
  // được ghi khi người dùng duyệt (RPC sessions.spawnResolve đọc nó qua peek).
  rootId: string
  resolve: (res: SpawnResolution) => void
  // Listener abort của lượt — gỡ khi request tan theo ĐƯỜNG THƯỜNG (resolve),
  // để signal của lượt không giữ một closure chết tới hết lượt.
  onAbort?: () => void
  signal?: AbortSignal
}

const PENDING = new Map<string, ParkedSpawn>()

// Phát `session.spawn-request` rồi park cho tới khi có quyết định. `sessionId`
// trong payload là phiên ĐANG GỌI (cha) — cổng sở hữu của renderer lọc theo nó,
// nên popover chỉ mở ở đúng cửa sổ đang lái phiên cha.
//
// `signal` là abort của LƯỢT: người dùng bấm Dừng giữa lúc popover mở thì
// request tan đi theo, phiên con không được tạo, và renderer được báo để đóng
// hộp thoại (`session.spawn-closed`) — nếu không nó treo mở vô hạn.
export function requestSpawnApproval(input: {
  sessionId: string
  rootId: string
  children: SpawnChildSpec[]
  // `goal` = mục tiêu người dùng mà model trích ra — popover đổ sẵn vào ô
  // "Yêu cầu" (nếu model không gửi, renderer tự suy ra từ bản đề xuất).
  goal?: string
  signal?: AbortSignal
}): Promise<SpawnResolution> {
  // Lượt đã bị huỷ TRƯỚC khi tool tới được đây — listener gắn sau khi abort sẽ
  // không bao giờ chạy (AbortSignal không phát lại), nên phải tự xét ngay.
  if (input.signal?.aborted) {
    return Promise.resolve({ approved: false, aborted: true })
  }
  const requestId = `spawn-${randomBytes(6).toString('hex')}`
  emit('session.spawn-request', {
    requestId,
    sessionId: input.sessionId,
    rootId: input.rootId,
    children: input.children,
    ...(input.goal ? { goal: input.goal.slice(0, MAX_TEXT_LEN / 10) } : {}),
  })
  return new Promise<SpawnResolution>((resolve) => {
    const parked: ParkedSpawn = { sessionId: input.sessionId, rootId: input.rootId, resolve }
    if (input.signal) {
      parked.signal = input.signal
      parked.onAbort = (): void => {
        if (!PENDING.delete(requestId)) return
        emit('session.spawn-closed', { requestId, sessionId: input.sessionId })
        resolve({ approved: false, aborted: true })
      }
      input.signal.addEventListener('abort', parked.onAbort, { once: true })
    }
    PENDING.set(requestId, parked)
  })
}

// Nhìn request đang park MÀ KHÔNG héo nó — `sessions.spawnResolve` cần `rootId`
// để ghi cờ nhóm TRƯỚC khi tool chạy tiếp (thứ tự: cờ trên đĩa → resolve →
// runner đẻ phiên → inbox event tới renderer đã bật tự giao).
export function peekSpawnRequest(
  requestId: string,
): { sessionId: string; rootId: string } | undefined {
  const parked = PENDING.get(requestId)
  return parked ? { sessionId: parked.sessionId, rootId: parked.rootId } : undefined
}

// RPC `sessions.spawnResolve` trả lời request đang park. Idempotent theo
// requestId: một cú bấm trễ (sau huỷ lượt / reload) trả false thay vì treo.
export function resolveSpawnRequest(requestId: string, res: SpawnResolution): boolean {
  const parked = PENDING.get(requestId)
  if (!parked) return false
  PENDING.delete(requestId)
  if (parked.onAbort) parked.signal?.removeEventListener('abort', parked.onAbort)
  parked.resolve(res)
  log.info('spawn request resolved', {
    requestId,
    approved: res.approved,
    children: res.children?.length,
  })
  return true
}

// ─── Cổng duyệt ARM nhóm (tool `arm_group`) ──────────────────────────────────
// Cùng khuôn park ở trên nhưng cho một quyết định nhẹ hơn nhiều: model xin bật
// `groupAutoDeliver` trên gốc nhóm — không kèm danh sách con hay cấu hình.
// Request park trong thân tool `arm_group` (session-tools.ts); renderer hiện
// popover `session.arm-request` và trả lời qua RPC `sessions.armResolve`.
// Cờ được ghi TRONG RPC handler (trước khi request héo) nên cùng luật thứ tự
// với cổng spawn: đĩa + event arm đi trước, tool tiếp tục sau.

export interface ArmResolution {
  approved: boolean
  message?: string
  aborted?: boolean
}

interface ParkedArm {
  sessionId: string
  rootId: string
  resolve: (res: ArmResolution) => void
  onAbort?: () => void
  signal?: AbortSignal
}

const PENDING_ARM = new Map<string, ParkedArm>()

// Phát `session.arm-request` rồi park tới khi người dùng quyết. `sessionId` là
// phiên ĐANG GỌI (để cổng sở hữu đẩy popover về đúng cửa sổ lái nó); `rootId`
// là gốc nhóm sẽ được arm — RPC đọc nó qua peek để ghi cờ.
// `reason` là câu model tự giải thích "vì sao cần nhóm tự chạy" — hiện trong
// popover để người dùng duyệt một cú mà không phải đoán.
export function requestArmApproval(input: {
  sessionId: string
  rootId: string
  reason?: string
  signal?: AbortSignal
}): Promise<ArmResolution> {
  if (input.signal?.aborted) {
    return Promise.resolve({ approved: false, aborted: true })
  }
  const requestId = `arm-${randomBytes(6).toString('hex')}`
  emit('session.arm-request', {
    requestId,
    sessionId: input.sessionId,
    rootId: input.rootId,
    ...(input.reason ? { reason: input.reason.slice(0, MAX_TEXT_LEN / 10) } : {}),
  })
  return new Promise<ArmResolution>((resolve) => {
    const parked: ParkedArm = { sessionId: input.sessionId, rootId: input.rootId, resolve }
    if (input.signal) {
      parked.signal = input.signal
      parked.onAbort = (): void => {
        if (!PENDING_ARM.delete(requestId)) return
        emit('session.arm-closed', { requestId, sessionId: input.sessionId })
        resolve({ approved: false, aborted: true })
      }
      input.signal.addEventListener('abort', parked.onAbort, { once: true })
    }
    PENDING_ARM.set(requestId, parked)
  })
}

export function peekArmRequest(
  requestId: string,
): { sessionId: string; rootId: string } | undefined {
  const parked = PENDING_ARM.get(requestId)
  return parked ? { sessionId: parked.sessionId, rootId: parked.rootId } : undefined
}

export function resolveArmRequest(requestId: string, res: ArmResolution): boolean {
  const parked = PENDING_ARM.get(requestId)
  if (!parked) return false
  PENDING_ARM.delete(requestId)
  if (parked.onAbort) parked.signal?.removeEventListener('abort', parked.onAbort)
  parked.resolve(res)
  log.info('arm request resolved', { requestId, approved: res.approved })
  return true
}
