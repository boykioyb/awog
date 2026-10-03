// `sessions.syncCli` — đồng bộ thủ công: kéo các entry mới từ transcript của
// CLI bên ngoài (claude/codex/devin — spawn qua sessions.open-cli.ts +
// cli-registry) về transcript AWOG. Importer sống ở
// sessions/cli-import.ts; method này chỉ quyết định NHỮNG KIND NÀO cần sync:
//   - `cli` được truyền → chỉ kind đó (callers muốn kiểm soát bề mặt).
//   - `cli` vắng mặt → mọi kind CÓ BẰNG CHỨNG: đã từng sync (con trỏ trong
//     `session.cliImport`), đang có PTY sống (`cliLinkFor`), hoặc đã từng mở
//     (`cliLastLinkFor` — registry giữ link cuối sau exit đúng vì importer còn
//     cần nó).
// PTY-exit cũng tự gọi importer — hai đường serialize nhau qua mutex
// per-session BÊN TRONG importer, nên sync thủ công trùng lúc exit không gấp
// đôi entry mà chỉ trả "already up to date".
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadSession } from '../sessions/store.js'
import { cliLastLinkFor, cliLinkFor } from '../sessions/cli-registry.js'
import { importCliTranscript } from '../sessions/cli-import.js'
import { activeSessionIds } from '../sessions/runner.js'
import type { SessionCliKind } from '../types/shared.js'

const CLI_KINDS: readonly SessionCliKind[] = ['claude', 'codex', 'devin']

const Params = z.object({
  sessionId: z.string().min(1),
  cli: z.enum(['claude', 'codex', 'devin']).optional(),
})

register('sessions.syncCli', async (raw) => {
  const params = Params.parse(raw)
  const session = await loadSession(params.sessionId)
  if (!session) throw new RpcError(-32004, 'Session not found')
  // Sync append message + ghi cursor trên transcript đang được một lượt AWOG
  // viết vào — từ chối như mọi mutator khác của phiên (trừ importer nội bộ
  // sau PTY-exit, vốn tự defer trong cli-registry).
  if (activeSessionIds().includes(params.sessionId)) {
    throw new RpcError(-32021, 'Cannot sync CLI transcript while a turn is in flight')
  }

  const kinds = new Set<SessionCliKind>()
  if (params.cli) {
    kinds.add(params.cli)
  } else {
    // Header session.jsonl là L2 (tay sửa được) → chỉ nhận key kind hợp lệ.
    for (const k of Object.keys(session.cliImport ?? {})) {
      if ((CLI_KINDS as readonly string[]).includes(k)) kinds.add(k as SessionCliKind)
    }
    for (const link of [cliLinkFor(params.sessionId), cliLastLinkFor(params.sessionId)]) {
      if (link) kinds.add(link.kind)
    }
  }

  let imported = 0
  for (const kind of kinds) {
    imported += (await importCliTranscript(params.sessionId, kind)).imported
  }
  return { imported }
})
