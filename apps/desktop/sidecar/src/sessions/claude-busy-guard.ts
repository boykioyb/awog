// Cổng "phiên nhập có thể đang mở ở Claude Desktop/CLI" — ADR 0102.
//
// Phiên nhập dùng CHUNG file transcript với Desktop/CLI (pointer-mode). Hai tiến trình cùng
// `--resume` một session id sẽ ghi xen vào cùng file (hoặc fork lặng lẽ), nên khi có dấu hiệu
// bên kia còn mở thì từ chối lượt ghi (`sessions.sendMessage`, `sessions.compact`).
//
// Heuristic (không có cách tin cậy để biết một app khác còn mở file): BẬN khi
//   mtime(transcript) < 120s trước  VÀ  AWOG không có tiến trình CLI sống nào cho phiên này.
// - Có tiến trình CLI sống của AWOG (`liveFor`) ⇒ chính AWOG đang sở hữu file, các lần ghi gần
//   đây là của mình ⇒ cho đi tiếp.
// - Transcript im ≥ 120s ⇒ coi như bên kia đã đóng/ngừng.
// Hệ quả chấp nhận: huỷ giữa lượt AWOG (tiến trình sống đã bị đóng) rồi gửi lại trong 2 phút
// cũng bị chặn — chờ hoặc gửi lại sau; thà chặn nhầm một lần còn hơn hỏng transcript chung.

import { stat } from "node:fs/promises";
import { RpcError } from "../transport/rpc.js";
import { liveFor } from "../runtime/claude-sdk/live-process.js";
import type { Session } from "../types/shared.js";
import { resolveSdkTranscriptPath } from "./sdk-transcript.js";

export const CLAUDE_SESSION_BUSY_WINDOW_MS = 120_000;
export const CLAUDE_SESSION_BUSY_CODE = -32021;

export async function assertClaudeSessionIdle(
  session: Pick<
    Session,
    "id" | "importedFrom" | "sdkSessionId" | "sdkSessionPath"
  > | null,
  now: number = Date.now(),
): Promise<void> {
  if (!session?.importedFrom || !session.sdkSessionId) return;
  if (liveFor(session.id)) return;
  const file = resolveSdkTranscriptPath(
    session.sdkSessionId,
    session.sdkSessionPath,
  );
  if (!file) return;
  const st = await stat(file).catch(() => undefined);
  if (!st || now - st.mtimeMs >= CLAUDE_SESSION_BUSY_WINDOW_MS) return;
  const where =
    session.importedFrom.kind === "cli" ? "Claude CLI" : "Claude Desktop";
  throw new RpcError(
    CLAUDE_SESSION_BUSY_CODE,
    `CLAUDE_SESSION_BUSY: this session was written to ${Math.round((now - st.mtimeMs) / 1000)}s ago and may still be open in ${where}. Close it there (or wait 2 minutes), then send again.`,
    { code: "CLAUDE_SESSION_BUSY" },
  );
}
