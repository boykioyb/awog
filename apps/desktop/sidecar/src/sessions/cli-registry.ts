// "Open in CLI" — link registry + spawn logic. Attaches a real agent CLI
// (claude / codex / devin) to an AWOG session inside a PTY so the user can
// drive the SAME conversation from a terminal UI (entry point:
// methods/sessions.open-cli.ts; kind semantics on SessionCliKind in
// types/shared.ts).
//
// TWO maps, on purpose:
//   - LIVE (links): sessionId → CliLink while the PTY runs. This is the attach
//     gate: sessions.sendMessage refuses a turn while a CLI is live because a
//     streamed turn + an interactive `claude --resume` would fork the SHARED
//     ~/.claude transcript (the CLI silently starts a copy when the session id
//     is already attached elsewhere).
//   - LAST (lastLinks): sessionId → the most recent CliLink, KEPT after the
//     PTY exits. The transcript importer (sessions/cli-import.ts) still needs
//     the link's `pendingSdkSessionId` (claude: the --session-id we minted and
//     must adopt) and `spawnedAt` (devin: transcript-file discovery lower
//     bound) — data that exists only because we spawned the process, and only
//     becomes meaningful once the process has written its transcript.
//
// SECURITY (invariant #1): `terminalManager.spawnProcess` takes env VERBATIM —
// unlike `create()` it does NOT strip credentials; its contract makes the
// caller own the invocation's safety (see the note on manager.ts). The claude
// branch DELIBERATELY hands the resolved OAuth token to the PTY env via
// buildSdkEnv — the same exposure class as the per-turn SDK subprocess, and
// the CLI is useless without it. Nhưng PTY sống LÂU (không phải một lượt) nên
// env của nó được siết hơn subprocess SDK: buildSdkEnv chỉ được phủ LÊN
// `sanitizedBaseEnv()` — không phải process.env thô — để mọi biến môi trường
// lân cận của sidecar (AWS_*, *_URL nội bộ, PATH hiện tại…) không bị thừa kế
// ngầm vào một process tương tác. Codex/devin chạy trên sanitized base env
// nguyên vẹn (codex auth nằm trong CODEX_HOME/auth.json trên đĩa — đúng chỗ
// Codex CLI tự tìm).

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import { RpcError } from '../transport/rpc.js'
import { terminalManager } from '../terminal/manager.js'
import { resolveClaudeBinary } from '../runtime/claude-sdk/binary.js'
import { resolveCodexBinary } from '../runtime/codex/binary.js'
import { ensureCodexHome } from '../runtime/codex/home.js'
import { buildSdkEnv } from '../runtime/claude-sdk/shared.js'
import { resolveAccount, resolveCredential } from '../credentials/credential-resolver.js'
import { loadProject } from '../projects/store.js'
import { log } from '../util/logger.js'
import { loadSession, updateSessionMetadata } from './store.js'
import { importCliTranscript } from './cli-import.js'
import { activeSessionIds } from './runner.js'
import type { Session, SessionCliKind } from '../types/shared.js'

export interface CliLink {
  terminalId: string
  sessionId: string // AWOG engine session id
  kind: SessionCliKind
  cwd: string // resolved workspace
  spawnedAt: number // ms epoch — devin transcript discovery uses it
  linked: boolean // true when the CLI resumes/adopts THIS AWOG session's runtime handle
  pendingSdkSessionId?: string // claude-only: pre-generated --session-id uuid awaiting adoption
}

// LIVE links — PTY still running. Keyed by AWOG session id (one CLI per
// session; a second openCli call returns the existing link).
const links = new Map<string, CliLink>()

// LAST link per session — kept after exit so the importer can still read
// pendingSdkSessionId/spawnedAt (see the header note). Overwritten on respawn.
const lastLinks = new Map<string, CliLink>()

export function cliLinkFor(sessionId: string): CliLink | undefined {
  return links.get(sessionId)
}

export function cliLastLinkFor(sessionId: string): CliLink | undefined {
  return lastLinks.get(sessionId)
}

// The attach gate sessions.sendMessage consults before persisting a turn.
export function isCliAttached(sessionId: string): boolean {
  return links.has(sessionId)
}

// ─── Base env (sanitized) ───────────────────────────────────────────────────
// Sao chép tối thiểu của `sanitizedEnv()` trong terminal/manager.ts — hàm đó
// private và không đáng nới surface chỉ vì chỗ này (rule-of-three: bản thứ
// hai thì copy). Cùng 3 lớp lọc: credential exact/suffix (invariant #1 — một
// shell tương tác không được `env | grep` ra token), rồi cờ runtime của host
// (ELECTRON_RUN_AS_NODE/NODE_OPTIONS sẽ cướp mọi `node` con chạy trong PTY).
// Nhánh claude KHÔNG đi qua đây — nó cần token trong env nên dùng buildSdkEnv.
const SENSITIVE_EXACT = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'])
const SENSITIVE_SUFFIX = /(_TOKEN|_KEY|_SECRET)$/i
const HOST_RUNTIME_VARS = ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ELECTRON_NO_ATTACH_CONSOLE']

function sanitizedBaseEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (SENSITIVE_EXACT.has(key) || SENSITIVE_SUFFIX.test(key)) continue
    if (HOST_RUNTIME_VARS.includes(key)) continue
    out[key] = value
  }
  out.TERM_PROGRAM = 'AWOG'
  out.COLORTERM = 'truecolor'
  if (!out.LANG) out.LANG = 'en_US.UTF-8'
  return out
}

// ─── Binary resolution ──────────────────────────────────────────────────────
// Quét PATH như `pathCandidate()` của runtime/codex/binary.ts — dành cho binary
// AWOG KHÔNG bundle (devin) hoặc binary bundle sẵn nhưng vắng mặt trong dev
// (claude: resolveClaudeBinary trả undefined khi chạy từ output của tsc).
function pathCandidate(name: string): string | undefined {
  const raw = process.env.PATH
  if (!raw) return undefined
  for (const dir of raw.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

// Devin CLI không đi kèm app: AWOG_DEVIN_BIN thắng (dev/CI override), rồi mới
// tới PATH. Không cache — PATH có thể đổi sau khi cài, và lời gọi này rẻ.
function resolveDevinBinary(): string | undefined {
  const override = process.env.AWOG_DEVIN_BIN?.trim()
  if (override && existsSync(override)) return override
  return pathCandidate(process.platform === 'win32' ? 'devin.exe' : 'devin')
}

function claudeExeName(): string {
  return process.platform === 'win32' ? 'claude.exe' : 'claude'
}

// ─── cwd ────────────────────────────────────────────────────────────────────
// Cùng thứ tự ưu tiên với sessions.cli-commands.ts resolveCwd và đường turn
// (send-message): thư mục người dùng kéo vào phiên thắng, rồi path của project
// đã link. Khác đường turn ở chỗ KHÔNG có fallback ngầm sang process.cwd() —
// spawn một CLI agent vào cwd của sidecar là chạy nó trên nhà của chính mình,
// nên thiếu workspace là lỗi, không phải "dùng tạm".
export async function resolveCliCwd(session: Session): Promise<string> {
  if (session.workspaceFolder) {
    try {
      if (
        isAbsolute(session.workspaceFolder) &&
        (await stat(session.workspaceFolder)).isDirectory()
      ) {
        return session.workspaceFolder
      }
    } catch {
      // Thư mục cũ đã bị xoá/dời → rơi xuống path của project.
    }
  }
  if (session.projectId) {
    try {
      const project = await loadProject(session.projectId)
      if (project?.path) return project.path
    } catch {
      // projectId cũ → hết chỗ dựa, báo lỗi bên dưới.
    }
  }
  throw new RpcError(-32021, 'no workspace to run the CLI in')
}

// ─── Per-kind invocation ────────────────────────────────────────────────────
interface CliInvocation {
  file: string
  args: string[]
  env: Record<string, string>
  linked: boolean
  pendingSdkSessionId?: string
}

// `claude` resume theo đúng cơ chế của nhánh turn: sdkSessionId đã có →
// `--resume <id>`; chưa có → `--session-id <uuid mới>` và giữ uuid đó trong
// `pendingSdkSessionId` để importer "nhận nuôi" khi file transcript thật sự
// tồn tại (ghi sdkSessionId ngay bây giờ là treo một resume-handle trỏ vào
// file có thể KHÔNG bao giờ được tạo — lượt sau resume vào hư không).
//
// Phiên SDK của một lượt đóng băng token trong env subprocess suốt lượt nên nó
// đòi ~1h runway (FROZEN_TOKEN_MIN_LIFETIME_MS). PTY CLI tương tác tồn tại lâu
// hơn một lượt — nhưng CLI TỰ refresh OAuth trong ~/.claude của nó khi token
// hết hạn, nên ta chỉ cần token sống đủ lâu để vượt khúc khởi động: ~5 phút.
const CLI_TOKEN_MIN_LIFETIME_MS = 5 * 60 * 1000

// Env: tái dùng đúng đường credential của turn (`resolveCredential` +
// `buildSdkEnv`) nhưng phủ LÊN `sanitizedBaseEnv()` thay vì process.env thô —
// OAuth token nằm trong env của PTY một cách CỐ Ý (cùng một lớp exposure với
// subprocess SDK của mỗi lượt, CLI vô dụng nếu thiếu nó), còn mọi biến ambient
// khác của sidecar thì KHÔNG được thừa kế ngầm. Thiếu credential cấu hình thì
// VẪN spawn với env đã lọc: CLI rơi về login ~/.claude của chính người dùng
// (CLAUDE_CONFIG_DIR dùng chung, ADR 0070) — warn để còn truy vết.
async function claudeInvocation(session: Session): Promise<CliInvocation> {
  const file = resolveClaudeBinary() ?? pathCandidate(claudeExeName())
  if (!file) {
    throw new RpcError(
      -32021,
      'claude CLI not found — reinstall the app or install `claude` on PATH',
    )
  }

  let args: string[]
  let pendingSdkSessionId: string | undefined
  if (session.sdkSessionId) {
    args = ['--resume', session.sdkSessionId]
  } else {
    pendingSdkSessionId = randomUUID()
    args = ['--session-id', pendingSdkSessionId]
  }

  let env: Record<string, string>
  try {
    const { cred } = await resolveCredential(
      session.settings.provider,
      session.settings.accountId,
      CLI_TOKEN_MIN_LIFETIME_MS,
    )
    // InfraContext của phiên (đóng băng lúc tạo) → profile/region cho buildSdkEnv
    // — cùng đường `buildSdkEnv(cred, args.settings.infra)` của run-stream, chỉ
    // khác base env được siết sẵn.
    env = buildSdkEnv(cred, session.infra, sanitizedBaseEnv())
  } catch (err) {
    log.warn('openCli: no AWOG credential — claude CLI will use the user login', {
      sessionId: session.id,
      err: err instanceof Error ? err.message : String(err),
    })
    env = sanitizedBaseEnv()
  }
  return {
    file,
    args,
    env,
    linked: true,
    ...(pendingSdkSessionId ? { pendingSdkSessionId } : {}),
  }
}

// `codex resume <threadId>` — cần thread đã tồn tại (turn đầu tiên tạo nó qua
// app-server), nên phiên chưa từng chat thì chưa mở được. CODEX_HOME theo
// ACCOUNT (không phải phiên): home ~/.awog/codex/<accountId>/ được provision
// LẠI trước khi spawn bằng đúng ensureCodexHome của đường turn — auth.json có
// thể đã cũ (token xoay) hoặc thiếu (home bị dọn) kể từ lần thread chạy.
//
// Account lookup đi qua `resolveAccount` (chỉ đọc store), KHÔNG phải
// resolveCredential: đường kia có thể refresh + persist trạng thái OAuth chỉ
// để trả lời một câu hỏi "account nào" — spawn một TUI không đáng gây side
// effect xác thực. Với account ChatGPT-subscription, token lưu trong piOAuth
// có thể đã hết hạn — Codex CLI tự refresh bằng auth.json của chính nó, còn
// việc AWOG refresh token là việc của đường turn.
async function codexInvocation(session: Session): Promise<CliInvocation> {
  if (!session.codexThreadId) {
    throw new RpcError(
      -32021,
      'Codex CLI needs an existing thread; send one message in this session first',
    )
  }
  let file: string
  try {
    file = resolveCodexBinary()
  } catch (err) {
    // CodexBinaryMissingError (message đã mang gợi ý cài đặt) → khuôn lỗi RPC
    // thống nhất với nhánh claude/devin.
    throw new RpcError(-32021, err instanceof Error ? err.message : 'codex CLI not found')
  }
  // account.id mới là khoá của home — không phải label hiển thị.
  const account = await resolveAccount('openai', session.settings.accountId)
  // Secret đưa vào `codex login`: api-key account → khóa thô; ChatGPT
  // subscription → access token đang lưu (pi OAuth blob là Record — lấy trường
  // `access` theo đúng khuôn pi's OAuthCredential).
  const secret =
    account.authMode === 'apikey'
      ? account.apiKey
      : typeof account.piOAuth?.access === 'string'
        ? account.piOAuth.access
        : undefined
  if (!secret) {
    throw new RpcError(-32021, 'openai account has no usable credential for the Codex CLI')
  }
  const kind = account.authMode === 'apikey' ? ('api-key' as const) : ('access-token' as const)
  let home: string
  try {
    home = await ensureCodexHome({ accountId: account.id, secret, kind })
  } catch (err) {
    // Provisioning chạy `codex login` + ghi file — lỗi của nó không phải lỗi
    // nội bộ bất định (-32603), là "CLI không mở được" (-32021).
    throw new RpcError(
      -32021,
      `codex home provisioning failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const env = sanitizedBaseEnv()
  env.CODEX_HOME = home
  return { file, args: ['resume', session.codexThreadId], env, linked: true }
}

// `devin` TUI trần: AWOG không có devin runtime nên không có handle để resume —
// người dùng tự chọn session của devin bằng `/resume` bên trong nó. unlinked,
// env chỉ là base đã lọc.
function devinInvocation(): CliInvocation {
  const file = resolveDevinBinary()
  if (!file) {
    throw new RpcError(
      -32021,
      'devin CLI not found — install Devin CLI or set AWOG_DEVIN_BIN',
    )
  }
  return { file, args: [], env: sanitizedBaseEnv(), linked: false }
}

// ─── open ───────────────────────────────────────────────────────────────────
export async function openCliLink(args: {
  sessionId: string
  kind: SessionCliKind
  cols: number
  rows: number
}): Promise<{
  terminalId: string
  kind: SessionCliKind
  linked: boolean
  alreadyOpen?: boolean
}> {
  const { sessionId, kind } = args

  // Idempotent: phiên đang có CLI sống thì trả lại chính nó thay vì spawn cái
  // thứ hai — hai PTY cùng resume một transcript là cách chắc nhất để fork nó.
  const live = links.get(sessionId)
  if (live) {
    if (live.kind !== kind) {
      throw new RpcError(
        -32021,
        `A ${live.kind} CLI is already open for this session — close it before opening ${kind}`,
      )
    }
    return {
      terminalId: live.terminalId,
      kind: live.kind,
      linked: live.linked,
      alreadyOpen: true,
    }
  }

  const session = await loadSession(sessionId)
  if (!session) throw new RpcError(-32004, 'Session not found')
  const cwd = await resolveCliCwd(session)
  const invocation =
    kind === 'claude'
      ? await claudeInvocation(session)
      : kind === 'codex'
        ? await codexInvocation(session)
        : devinInvocation()

  // `link` được gán SAU khi spawn thành công; onExit đọc nó qua closure và so
  // identity với entry trong `links` để một exit trễ của PTY cũ không xoá nhầm
  // link mới hơn (mở lại ngay sau khi đóng).
  let link: CliLink | undefined
  const spawnedAt = Date.now()
  const { terminalId } = await terminalManager.spawnProcess({
    file: invocation.file,
    args: invocation.args,
    env: invocation.env,
    cwd,
    cols: args.cols,
    rows: args.rows,
    // Khoá gom nhóm RIÊNG (`cli:` thay vì `ses:`): tách CLI khỏi shell thường
    // của người dùng trong cùng phiên (terminal.list('cli:'+id) / giới hạn
    // MAX_PER_SESSION không đếm lẫn nhau). Không phải ranh giới bảo mật.
    sessionId: `cli:${sessionId}`,
    onExit: () => {
      if (link && links.get(sessionId) === link) links.delete(sessionId)
      void importAfterCliExit(sessionId, kind)
    },
  })

  // TOCTOU: spawn resolve có thể chậm tới vài giây (provision codex home chạy
  // `codex login`). Một lượt AWOG có thể đã bắt đầu trong khe đó — nếu cứ gắn
  // link, CLI resume đúng transcript lượt đó đang viết → fork. Giết PTY vừa
  // tạo và từ chối như cổng BẬN phía trên.
  if (activeSessionIds().includes(sessionId)) {
    try {
      terminalManager.kill(terminalId)
    } catch {
      // PTY có thể đã tự thoát — onExit vẫn chạy, `link` chưa set nên nó
      // không đụng `links`; không có gì để dọn thêm.
    }
    throw new RpcError(
      -32021,
      'This session has a turn in flight — wait for it or stop it before opening a CLI',
    )
  }

  link = {
    terminalId,
    sessionId,
    kind,
    cwd,
    spawnedAt,
    linked: invocation.linked,
    ...(invocation.pendingSdkSessionId
      ? { pendingSdkSessionId: invocation.pendingSdkSessionId }
      : {}),
  }
  links.set(sessionId, link)
  lastLinks.set(sessionId, link)
  // Persist bằng chứng spawn NGAY: maps trên chết cùng sidecar, còn importer
  // sau restart chỉ còn `session.cliImport` để tìm transcript (adopt
  // pendingSdkSessionId của claude, mtime floor của devin). Merge trên cursor
  // hiện có — không đè file/offset của lần sync trước, không đụng kind khác.
  void persistCliSpawnEvidence(sessionId, link)
  log.info('cli link opened', { sessionId, kind, terminalId, linked: link.linked })
  return { terminalId, kind, linked: link.linked }
}

// Ghi spawnedAt (+ pendingSdkSessionId của claude) vào cursor persist của kind
// tương ứng. Best-effort: PTY đã mở rồi, một lỗi ghi không được giết nó —
// importer sẽ thiếu bằng chứng restart thôi (warn để còn truy vết).
async function persistCliSpawnEvidence(sessionId: string, link: CliLink): Promise<void> {
  try {
    const fresh = await loadSession(sessionId)
    if (!fresh) return
    const prev = { ...(fresh.cliImport?.[link.kind] ?? {}) }
    prev.spawnedAt = link.spawnedAt
    if (link.kind === 'claude') {
      // claude: fresh mint thay pending cũ; resume-spawn (undefined) XOÁ KEY
      // pending đã thành dead weight (xoá key chứ không ghi undefined —
      // exactOptionalPropertyTypes + JSON persist).
      if (link.pendingSdkSessionId) prev.pendingSdkSessionId = link.pendingSdkSessionId
      else delete prev.pendingSdkSessionId
    }
    await updateSessionMetadata(sessionId, {
      cliImport: { ...fresh.cliImport, [link.kind]: prev },
    })
  } catch (err) {
    log.warn('cli spawn evidence persist failed', {
      sessionId,
      kind: link.kind,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

// Importer chạy fire-and-forget sau khi PTY đóng, nhưng KHÔNG được append vào
// transcript trong khi một lượt AWOG còn đang ghi vào chính nó — poll trạng
// thái turn (~2s/nhịp, tối đa ~60s) rồi mới fold. Hết hạn thì bỏ lượt import
// này kèm warn; `sessions.syncCli` thủ công vẫn nhặt phần còn lại sau.
const CLI_EXIT_IMPORT_POLL_MS = 2_000
const CLI_EXIT_IMPORT_WAIT_MS = 60_000

async function importAfterCliExit(sessionId: string, kind: SessionCliKind): Promise<void> {
  const deadline = Date.now() + CLI_EXIT_IMPORT_WAIT_MS
  while (activeSessionIds().includes(sessionId)) {
    if (Date.now() >= deadline) {
      log.warn('cli transcript import skipped: AWOG turn still in flight', { sessionId, kind })
      return
    }
    await new Promise((resolve) => setTimeout(resolve, CLI_EXIT_IMPORT_POLL_MS))
  }
  try {
    // Phiên có thể đã bị xoá trong khi chờ — loadSession trả null bên trong và
    // importer tự thoát êm, nên không cần kiểm trước ở đây.
    await importCliTranscript(sessionId, kind)
  } catch (err) {
    log.warn('cli transcript import failed', {
      sessionId,
      kind,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

// Cổng của `sessions.delete`: một link SỐNG chặn xoá phiên — importer/onExit
// của nó sẽ append vào transcript đã tombstone. Link mà record PTY đã biến mất
// khỏi terminalManager (kill/exit đã xoá record nhưng links chưa kịp dọn —
// race spawn→links.set hoặc restart giữa chừng) là STALE: gỡ khỏi `links`,
// giữ `lastLinks` cho importer, rồi coi như đã detach và cho xoá tiếp.
export function assertCliDetachedForDelete(sessionId: string): void {
  const link = links.get(sessionId)
  if (!link) return
  // Record PTY phải còn VÀ vẫn thuộc nhóm cli: của đúng phiên này — một record
  // biến mất (kill/exit đã reap) nghĩa là link chỉ còn là xác stale.
  const alive = terminalManager.groupKeyFor(link.terminalId) === `cli:${sessionId}`
  if (alive) {
    throw new RpcError(
      -32021,
      'A CLI is still attached to this session — close it before deleting the session',
    )
  }
  links.delete(sessionId)
  log.warn('cli link dropped as stale during session delete', {
    sessionId,
    terminalId: link.terminalId,
    kind: link.kind,
  })
}
