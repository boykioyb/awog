// Vé duyệt một-lần cho `infra.run` (infosec audit #1).
//
// Vấn đề của bản đầu: RPC nhận `approved: boolean` do **renderer tự khai**. Payload
// IPC là dữ liệu L1 (`.claude/rules/security.md`), nên "người dùng đã bấm duyệt"
// mà lấy từ chính bên gọi thì không chứng minh được gì — một renderer bị chi phối
// chỉ cần gửi `approved: true` là chạy được lệnh chưa ai nhìn thấy.
//
// Nay sidecar tự giữ trạng thái: khi ma trận nói `ask`, nó TỪ CHỐI và phát một
// **vé** gắn với đúng lời gọi đó. UI mở hộp duyệt, người dùng bấm, UI gọi lại kèm
// vé. Sidecar đối chiếu vân tay rồi TIÊU vé.
//
// Bốn tính chất, mỗi cái chặn một đường lách:
//   1. Vé gắn VÂN TAY của (tool, args, context) ⇒ không dùng vé của lệnh `describe`
//      để chạy `terminate`.
//   2. Dùng MỘT LẦN ⇒ duyệt một lần không thành giấy phép chạy mãi.
//   3. Có HẠN (5 phút) ⇒ vé nhặt được từ log cũ không dùng lại được.
//   4. Sinh bằng `randomUUID` ⇒ không đoán trước được.
//
// Hàng rào này chặn *bên gọi tự khai*. Nó không chống được một renderer đã bị
// chiếm hoàn toàn (kẻ đó bấm nút hộ người dùng cũng được) — chốt đó nằm ở lớp
// khác, và không có lớp nào trong app chống lại được chuyện đó.

import { createHash, randomUUID } from 'node:crypto'

const TTL_MS = 5 * 60_000
// Chặn phình bộ nhớ nếu UI xin vé rồi không bao giờ dùng. Vé cũ nhất bị bỏ trước.
const MAX_PENDING = 200

type Pending = { fingerprint: string; expiresAt: number }

const pending = new Map<string, Pending>()

/** Vân tay của một lời gọi — vé chỉ hợp lệ cho đúng lời gọi đã sinh ra nó. */
export function callFingerprint(tool: string, args: readonly string[], context: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ tool, args, context }))
    .digest('hex')
}

function sweep(now: number): void {
  for (const [id, p] of pending) if (p.expiresAt <= now) pending.delete(id)
  while (pending.size > MAX_PENDING) {
    const oldest = pending.keys().next()
    if (oldest.done) break
    pending.delete(oldest.value)
  }
}

/** Phát vé cho một lời gọi đang chờ người duyệt. */
export function issueApproval(fingerprint: string, now = Date.now()): string {
  sweep(now)
  const id = randomUUID()
  pending.set(id, { fingerprint, expiresAt: now + TTL_MS })
  return id
}

/**
 * Đối chiếu rồi TIÊU vé. Trả `true` chỉ khi vé có thật, chưa hết hạn, và thuộc
 * đúng lời gọi này. Mọi nhánh sai đều trả `false` — không ném, vì đây là biên
 * IPC và một payload rác không được làm sập lượt.
 */
export function consumeApproval(
  ticket: string | undefined,
  fingerprint: string,
  now = Date.now(),
): boolean {
  if (!ticket) return false
  const found = pending.get(ticket)
  if (!found) return false
  // Tiêu vé TRƯỚC khi kiểm vân tay: một vé đã bị đem đi thử sai chỗ thì coi như
  // đã cháy, không để dò tìm lệnh nào khớp với nó.
  pending.delete(ticket)
  if (found.expiresAt <= now) return false
  return found.fingerprint === fingerprint
}

/** Chỉ dùng cho test. */
export function _resetApprovals(): void {
  pending.clear()
}
