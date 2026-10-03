// Cổng duyệt ĐIỀU PHỐI — popover "mở phiên con" của tool `create_session`.
//
// Bản chất giống hệt questions.ts / permission.ts: lời gọi tool park một Promise
// ở đây, popover cấu hình trên renderer trả lời qua RPC `sessions.spawnResolve`,
// promise héo cho tool chạy tiếp — hoặc trả kết quả "người dùng không duyệt".
//
// Vì sao là CỔNG RIÊNG chứ không đi nhờ thẻ duyệt quyền chung: người dùng không
// chỉ duyệt có/không — họ còn SỬA được danh sách phiên con và chọn cấu hình
// (account/model/level/style/mode) trước khi đồng ý, kèm lựa chọn "nhớ cho cả
// nhóm". Thẻ quyền chung không mang được payload đó, và một lượt duyệt ở đây
// còn chính là lần duyệt duy nhất của cả workflow khi `spawnConfig` được ghi.
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
import type { SpawnSessionConfig } from '../types/shared.js'
// SpawnChildSpec của spawn.ts — bản có thêm tuple bind-agent (session-teams §3),
// để danh sách con sửa trong popover không đánh rơi binding khi đi vòng qua
// request → resolve → spawnMemberSessions.
import type { SpawnChildSpec } from './spawn.js'

// Những gì người dùng quyết trong popover.
export interface SpawnResolution {
  approved: boolean
  // Danh sách phiên con SAU KHI chỉnh trong popover (bỏ bớt/sửa tên/vai/việc).
  // Vắng mặt = nguyên bản model đề xuất.
  children?: SpawnChildSpec[]
  // Cấu hình CHUNG người dùng chọn — đè lên settings kế thừa của phiên cha.
  config?: SpawnSessionConfig
  // "Nhớ cho cả nhóm" — RPC `sessions.spawnResolve` ghi nó lên gốc nhóm thành
  // `spawnConfig` TRƯỚC khi request héo, nên lần đẻ sau bỏ qua popover.
  remember?: boolean
  // Lời từ chối tự do, trả lại cho model đọc.
  message?: string
  // Request chết vì lượt bị huỷ, không phải người dùng bấm Từ chối.
  aborted?: boolean
}

interface ParkedSpawn {
  sessionId: string
  // Gốc của nhóm chứa phiên đang gọi — chỗ `spawnConfig` được ghi khi người
  // dùng duyệt kèm "nhớ" (RPC sessions.spawnResolve đọc nó qua peek).
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
// để ghi `spawnConfig` TRƯỚC khi tool chạy tiếp (thứ tự: config trên đĩa →
// resolve → runner đẻ phiên).
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
