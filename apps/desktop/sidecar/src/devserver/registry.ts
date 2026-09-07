// Vòng đời dev server, dựng TRÊN registry tiến trình nền đã có
// (sessions/bg-registry.ts, ADR 0066) — cố ý KHÔNG dựng registry thứ hai.
//
// Một dev server ở đây = một background shell của bg-registry, cộng một cái TÊN.
// Cái tên được nhét vào chính chuỗi lệnh dưới dạng biến môi trường đánh dấu
// (`AWOG_DEV_SERVER=<name> …`, xem config.ts), nên ánh xạ tên → shell được SUY RA
// từ `listBackground()` chứ không lưu ở đâu cả. Hệ quả:
//
//   - Không có file state thứ hai để lệch pha với sự thật.
//   - RESTART SIDECAR VẪN GẮN LẠI ĐƯỢC: bg-registry ghi `meta.json` (có nguyên văn
//     `command`, tức có cả marker) xuống đĩa và nhận lại mọi shell còn sống lúc
//     boot (reloadBackgroundShells) — server chạy tiếp, log vẫn ở chỗ cũ, tra theo
//     tên vẫn ra. Shell mồ côi (pid chết, không có file exit) được bg-registry chốt
//     thành 'exited-unknown' và ở đây hiện là `unknown` ⇒ khởi động lại được.
//   - Server sống QUA lượt chat: tiến trình detach, không dính abort signal của lượt.
//
// Phạm vi: background shell thuộc về MỘT phiên (thư mục `~/.awog/sessions/<sid>/bg`),
// nên server bật ở phiên A không thấy được từ phiên B. Đó là ranh giới sẵn có của
// ADR 0066, không phải thứ module này tự đặt thêm.
//
// BẢO MẬT: module này là chỗ DUY NHẤT spawn, và nó chỉ được gọi từ RPC — tức từ
// một hành động của CON NGƯỜI trên UI, đã nhìn thấy nguyên văn lệnh (RPC còn bắt
// gửi lại đúng chuỗi đó qua `confirmCommand`, xem startDevServer). Đường của MODEL
// không đi qua đây để spawn: tool trả về đúng lệnh cần chạy và bắt model gọi
// `Bash({ run_in_background: true })`, tức đi qua cổng quyền thật (EXEC_TOOLS).

import { resolve } from 'node:path'
import {
  listBackground,
  killBackground,
  readBackground,
  startBackground,
  type BgShellState,
} from '../sessions/bg-registry.js'
import {
  buildLaunchCommand,
  findEntry,
  loadDevServerConfig,
  markerFor,
  resolveEntryCwd,
  type DevServerEntry,
} from './config.js'
import { filterLog, type LogFilterOptions, type LogFilterResult } from './log-filter.js'

export type DevServerStatus = 'stopped' | 'running' | 'exited' | 'unknown'

export interface DevServerView {
  name: string
  description?: string
  port?: number
  // Nguyên văn lệnh sẽ chạy — thứ người dùng phải đọc trước khi đồng ý.
  command: string
  // Thư mục chạy, tuyệt đối, do sidecar dựng từ gốc dự án.
  cwd: string
  status: DevServerStatus
  shellId?: string
  startedAt?: string
  exitCode: number | null
}

export interface DevServerListing {
  configPath: string
  missing: boolean
  problems: string[]
  servers: DevServerView[]
}

export type DevServerErrorCode = 'not-found' | 'command-changed' | 'not-running'

export class DevServerError extends Error {
  constructor(
    public readonly code: DevServerErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DevServerError'
  }
}

// Background shell của server `name` trong phiên này: ưu tiên cái ĐANG CHẠY, sau
// đó tới lần chạy gần nhất (để còn đọc được log của một server vừa chết).
function findShell(shells: BgShellState[], name: string): BgShellState | undefined {
  const marker = markerFor(name)
  const mine = shells.filter((s) => s.command.includes(marker))
  if (mine.length === 0) return undefined
  const byNewest = [...mine].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return byNewest.find((s) => s.status === 'running') ?? byNewest[0]
}

function statusOf(shell: BgShellState | undefined): DevServerStatus {
  if (!shell) return 'stopped'
  if (shell.status === 'running') return 'running'
  return shell.status === 'exited' ? 'exited' : 'unknown'
}

function toView(
  projectRoot: string,
  entry: DevServerEntry,
  shell: BgShellState | undefined,
): DevServerView {
  return {
    name: entry.name,
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.port !== undefined ? { port: entry.port } : {}),
    command: buildLaunchCommand(projectRoot, entry),
    cwd: resolveEntryCwd(projectRoot, entry),
    status: statusOf(shell),
    ...(shell ? { shellId: shell.shellId, startedAt: shell.startedAt } : {}),
    exitCode: shell?.exitCode ?? null,
  }
}

// Toàn bộ server đã khai + trạng thái hiện tại của chúng.
export async function listDevServers(
  projectRoot: string,
  sessionId: string,
): Promise<DevServerListing> {
  const config = await loadDevServerConfig(projectRoot)
  const shells = listBackground(sessionId)
  return {
    configPath: config.configPath,
    missing: config.missing,
    problems: config.problems,
    servers: config.servers.map((entry) => toView(projectRoot, entry, findShell(shells, entry.name))),
  }
}

// Một server theo tên. Ném DevServerError('not-found') để người gọi (RPC/tool) tự
// diễn đạt — biên nào cũng cần câu chữ riêng.
export async function getDevServer(
  projectRoot: string,
  sessionId: string,
  name: string,
): Promise<{ entry: DevServerEntry; view: DevServerView }> {
  const config = await loadDevServerConfig(projectRoot)
  const entry = findEntry(config.servers, name)
  if (!entry) {
    const known = config.servers.map((s) => s.name).join(', ')
    throw new DevServerError(
      'not-found',
      config.missing
        ? `No dev server config at ${config.configPath}.`
        : `No dev server named "${name}". Declared: ${known || '(none)'}.`,
    )
  }
  const shell = findShell(listBackground(sessionId), entry.name)
  return { entry, view: toView(projectRoot, entry, shell) }
}

export type StartOutcome = 'started' | 'already-running'

export interface StartDevServerResult {
  outcome: StartOutcome
  server: DevServerView
}

// Khởi động theo tên. ĐƯỜNG CỦA NGƯỜI DÙNG (RPC) — không phải của model.
//
// `confirmCommand` là nguyên văn lệnh mà UI đã hiện cho người dùng đọc. Sidecar so
// lại với lệnh vừa dựng từ file cấu hình: khác nhau ⇒ từ chối. Điều này đóng đúng
// một cửa: file trong repo bị đổi (hoặc `git pull`) GIỮA lúc người dùng đọc và lúc
// họ bấm đồng ý, khiến họ đồng ý một lệnh và máy chạy một lệnh khác.
//
// Đang chạy rồi ⇒ KHÔNG spawn thêm, trả về cái đang chạy (nguyên do tồn tại của
// tính năng: khởi động trùng là cách nhanh nhất có hai tiến trình giành một cổng).
export async function startDevServer(input: {
  projectRoot: string
  sessionId: string
  name: string
  confirmCommand?: string | undefined
}): Promise<StartDevServerResult> {
  const { projectRoot, sessionId, name } = input
  const { entry, view } = await getDevServer(projectRoot, sessionId, name)
  if (view.status === 'running') return { outcome: 'already-running', server: view }

  if (input.confirmCommand !== undefined && input.confirmCommand !== view.command) {
    throw new DevServerError(
      'command-changed',
      `The declared command for "${entry.name}" changed since it was shown. Review it again before starting.`,
    )
  }

  // cwd = gốc dự án do sidecar dựng (KHÔNG lấy từ payload); phần `cd` vào thư mục
  // con nằm trong chính chuỗi lệnh, nên lệnh chạy ở đây và lệnh model chạy qua
  // `Bash` là MỘT — cùng chuỗi, cùng marker, nên tra theo tên luôn ra.
  const meta = await startBackground({
    sessionId,
    cwd: resolve(projectRoot),
    command: view.command,
  })
  return {
    outcome: 'started',
    server: {
      ...view,
      status: 'running',
      shellId: meta.shellId,
      startedAt: meta.startedAt,
      exitCode: null,
    },
  }
}

// Dừng theo tên. Không đi qua cổng quyền, giống `KillShell`: dừng một tiến trình
// mà người dùng đã đồng ý cho chạy thì không mở thêm bề mặt nào.
export async function stopDevServer(input: {
  projectRoot: string
  sessionId: string
  name: string
}): Promise<DevServerView> {
  const { projectRoot, sessionId, name } = input
  const { view } = await getDevServer(projectRoot, sessionId, name)
  if (view.status !== 'running' || !view.shellId) {
    throw new DevServerError('not-running', `Dev server "${view.name}" is not running.`)
  }
  killBackground(sessionId, view.shellId)
  return { ...view, status: 'unknown' }
}

export interface DevServerLogResult {
  server: DevServerView
  log: LogFilterResult
  // Đuôi log gốc đã bị bg-registry cắt vì vượt trần 64KB.
  truncated: boolean
}

// Đọc log của một server, có lọc. `markRead: false` — người/model đọc log dev
// server là một lần xem tiến độ, không phải "đã nhận kết quả" của một lệnh nền,
// nên không retire chip nền của nó.
export async function readDevServerLog(input: {
  projectRoot: string
  sessionId: string
  name: string
  filter?: LogFilterOptions | undefined
}): Promise<DevServerLogResult> {
  const { projectRoot, sessionId, name } = input
  const { view } = await getDevServer(projectRoot, sessionId, name)
  if (!view.shellId) {
    throw new DevServerError(
      'not-running',
      `Dev server "${view.name}" has not been started in this session, so it has no log yet.`,
    )
  }
  const snapshot = readBackground(sessionId, view.shellId, { markRead: false, raw: true })
  if (!snapshot) {
    throw new DevServerError('not-running', `The log for "${view.name}" is no longer available.`)
  }
  return {
    server: { ...view, status: statusOfSnapshot(snapshot.status), exitCode: snapshot.exitCode },
    log: filterLog(snapshot.output, input.filter ?? {}),
    truncated: snapshot.truncated,
  }
}

function statusOfSnapshot(status: BgShellState['status']): DevServerStatus {
  if (status === 'running') return 'running'
  return status === 'exited' ? 'exited' : 'unknown'
}
