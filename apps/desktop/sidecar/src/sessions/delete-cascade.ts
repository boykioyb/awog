// Cascade dùng chung cho mọi đường xoá phiên: `sessions.delete` (user bấm) và
// `boards.delete` (item có assignee chết kéo theo). Một phiên đi phải gỡ trọn:
// interrupt lượt đang chạy, artefact Claude SDK, thư mục transcript (+ worktree
// member qua releaseSessionWorktreeBestEffort bên trong deleteSession), quyền
// "always allow" phạm vi phiên, MCP children, background shell và cây snapshot
// Rewind — rồi bắn `session.deleted` để renderer rụng row ngay.
import { deleteSession, loadSession } from './store.js'
import { assertCliDetachedForDelete } from './cli-registry.js'
import { deleteSnapshots } from './snapshots.js'
import { clearSessionPermissions } from './permissions.js'
import { releaseSessionMcp } from '../runtime/tools/mcp-tools.js'
import { removeSdkSession } from '../runtime/claude-sdk/store.js'
import { cleanupSessionBackground } from './bg-registry.js'
import { abortSession } from './runner.js'
import { emit } from '../transport/stdio.js'

export async function deleteSessionCascade(id: string): Promise<void> {
  // Một CLI còn SỐNG chặn xoá (-32021): importer/onExit của nó sẽ append vào
  // transcript đã bị gỡ. Link stale (record PTY đã reap) được registry tự
  // gỡ — giữ lastLinks — và coi như đã detach, cho xoá tiếp.
  assertCliDetachedForDelete(id)
  // Remove the Claude SDK store artifacts BEFORE tombstoning (we need the
  // session's sdkSessionId, ADR 0058) so a deleted Anthropic session leaves no
  // orphan SDK transcript under ~/.awog/claude-sdk. No-op for Pi sessions.
  try {
    const s = await loadSession(id)
    if (s?.sdkSessionId) await removeSdkSession(s.sdkSessionId)
  } catch {
    /* best-effort: never block the delete */
  }
  // Dừng mọi lượt đang chạy TRƯỚC khi gỡ thư mục. Turn unwind vẫn gọi
  // appendMessage trong finally — no-op trên phiên đã xoá khỏi map nên không
  // thể hồi sinh record; abort ở đây chỉ để cắt token đang đốt sớm hơn.
  abortSession(id)
  await deleteSession(id)
  // Drop any session-scoped "always allow" entries so they don't linger in the
  // sidecar for the process lifetime after the session is gone.
  clearSessionPermissions(id)
  // Tear down any session-pooled MCP children (e.g. a Playwright browser) so a
  // deleted session leaves no orphan process running for the sidecar lifetime.
  releaseSessionMcp(id)
  // Kill any background shells (ADR 0066) + remove their on-disk bg/ dir so a
  // deleted session leaves no detached process or leftover logs.
  cleanupSessionBackground(id)
  // Best-effort: discard the session's Rewind snapshot tree (ADR 0038).
  await deleteSnapshots(id)
  emit('session.deleted', { id })
}
