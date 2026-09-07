// Bản khai dev server của một dự án: `{project}/.awog/dev-servers.json`.
//
// Vì sao có file này: model bật được dev server bằng `Bash(run_in_background)`,
// nhưng KHÔNG có khái niệm "server đã đăng ký" — không biết dự án này chạy bằng
// lệnh gì, cổng nào, ai đang chạy. Mỗi lượt chat nó lại đoán lại (`npm run dev`?
// `pnpm dev`? ở thư mục nào?), và đoán sai thì đẻ ra tiến trình thứ hai chiếm cổng.
// File này là chỗ NÓI MỘT LẦN, cho cả người lẫn model đọc.
//
// Chỗ đặt file theo ADR 0070: đây là dữ liệu AWOG-only (Claude Code không có
// layout nào cho nó) ⇒ nằm dưới `.awog` của dự án, không phải `.claude`.
//
// ⚠ BẢO MẬT — file này NẰM TRONG REPO nên bất kỳ ai commit cũng được: nó là dữ
// liệu L1 KHÔNG TIN, y hệt luật quyền tầng project (ADR 0080, mục Đính chính F1)
// và trust của hook (ADR 0032). Hai lỗ hổng đó cùng một lớp: "một file trong repo
// khiến sidecar chạy lệnh mà không hỏi". Ở đây lớp phòng thủ chia làm hai:
//
//   1. KHAI ≠ CHẠY. Module này chỉ ĐỌC + KIỂM TRA. Không chỗ nào trong nó spawn.
//      Việc khởi động đi qua đúng một cửa duy nhất, và cửa đó luôn cho người dùng
//      nhìn thấy NGUYÊN VĂN lệnh trước khi đồng ý (xem registry.ts + doc).
//   2. Hình dạng bị siết chặt: `command` là MỘT token, `args` là MẢNG, và không
//      token nào được chứa ký tự shell (`;` `&` `|` backtick `$` `(` `)` `<` `>`
//      nháy, xuống dòng…). Nên một entry không thể nối thêm lệnh thứ hai, dù nó
//      được ghép vào chuỗi shell ở tầng dưới (xem buildLaunchCommand).
//
// Cố ý KHÔNG hỗ trợ `env` trong file: biến môi trường do repo cấp là một bề mặt
// tiêm thêm (LD_PRELOAD, NODE_OPTIONS='--require …') mà tính năng này không cần.

import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { z } from 'zod'

// Tên file + thư mục: AWOG-only ⇒ `.awog` (ADR 0070).
const CONFIG_DIR_NAME = '.awog'
const CONFIG_FILE_NAME = 'dev-servers.json'

// Trần số server trong một file. Một dự án thật có 2–5 cái; trần chỉ để một file
// bệnh hoạn không bắt sidecar dựng hàng nghìn entry.
const MAX_SERVERS = 24
const MAX_ARGS = 32
const MAX_ARG_LEN = 512
const MAX_CWD_LEN = 200

// Tên server: dùng làm khoá tra cứu VÀ làm marker trong chuỗi lệnh, nên siết về
// tập ký tự an toàn tuyệt đối (không khoảng trắng, không ký tự shell).
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/
// Lệnh: MỘT token — tên chương trình hoặc đường dẫn tới nó. Không khoảng trắng,
// không cờ (`-` đầu dòng là cờ, không phải chương trình).
const COMMAND_RE = /^[A-Za-z0-9._/@+][A-Za-z0-9._/@+-]{0,119}$/
// Ký tự shell + ký tự điều khiển: cấm ở MỌI token (command, args, cwd). Danh sách
// chặn thay vì cho phép, để arg đời thật (`--filter=@awog/ui`, `--host 0.0.0.0`)
// không bị chặn oan; phần bù an toàn là mọi token còn được single-quote lúc ghép.
const SHELL_UNSAFE_RE = /[;&|`$(){}<>\\'"\n\r\t\x00-\x1f\x7f]/

export interface DevServerEntry {
  name: string
  command: string
  args: string[]
  // Tương đối so với gốc dự án. '.' = ngay tại gốc.
  cwd: string
  port?: number
  description?: string
}

export interface DevServerConfig {
  configPath: string
  servers: DevServerEntry[]
  // Entry hỏng bị BỎ QUA chứ không làm hỏng cả file (ADR 0080 F2): mỗi cái một
  // dòng lý do, để người dùng/model biết vì sao server của họ không hiện ra.
  problems: string[]
  // File không tồn tại. Khác hẳn "file rỗng/hỏng" — người gọi cần phân biệt để
  // gợi ý tạo file thay vì báo lỗi.
  missing: boolean
}

const EntrySchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  port: z.number().optional(),
  description: z.string().optional(),
})

const FileSchema = z.object({
  version: z.number().optional(),
  servers: z.array(z.unknown()),
})

export function devServerConfigPath(projectRoot: string): string {
  return join(projectRoot, CONFIG_DIR_NAME, CONFIG_FILE_NAME)
}

// Kiểm tra một entry đã qua zod: trả về entry đã chuẩn hoá, hoặc câu nói RÕ vì sao
// bị từ chối (chuỗi này đi thẳng tới người dùng + model, nên viết cho người đọc).
function checkEntry(
  raw: z.infer<typeof EntrySchema>,
  projectRoot: string,
): { entry: DevServerEntry } | { error: string } {
  const name = raw.name.trim()
  if (!NAME_RE.test(name)) {
    return { error: `server "${raw.name}": name must be 1–40 chars of letters, digits, . _ -` }
  }
  const command = raw.command.trim()
  if (!COMMAND_RE.test(command) || SHELL_UNSAFE_RE.test(command)) {
    return {
      error: `server "${name}": command must be a single program name or path with no shell characters (got ${JSON.stringify(raw.command)})`,
    }
  }
  const args = raw.args ?? []
  if (args.length > MAX_ARGS) {
    return { error: `server "${name}": too many args (${args.length} > ${MAX_ARGS})` }
  }
  for (const arg of args) {
    if (arg.length > MAX_ARG_LEN) {
      return { error: `server "${name}": one arg is longer than ${MAX_ARG_LEN} characters` }
    }
    if (SHELL_UNSAFE_RE.test(arg)) {
      return {
        error: `server "${name}": arg ${JSON.stringify(arg)} contains a shell character; args must be plain values (the command runs without a shell of its own)`,
      }
    }
  }
  const cwdRel = (raw.cwd ?? '.').trim() || '.'
  const cwdError = checkCwd(name, cwdRel, projectRoot)
  if (cwdError) return { error: cwdError }
  if (raw.port !== undefined) {
    if (!Number.isInteger(raw.port) || raw.port < 1 || raw.port > 65535) {
      return { error: `server "${name}": port must be an integer between 1 and 65535` }
    }
  }
  const description = raw.description?.trim()
  return {
    entry: {
      name,
      command,
      args,
      cwd: cwdRel,
      ...(raw.port !== undefined ? { port: raw.port } : {}),
      ...(description ? { description } : {}),
    },
  }
}

// `cwd` phải TƯƠNG ĐỐI và nằm trong dự án. Sidecar tự dựng đường dẫn tuyệt đối từ
// gốc dự án (resolveEntryCwd) — payload/file không bao giờ cấp đường dẫn tuyệt đối.
function checkCwd(name: string, cwdRel: string, projectRoot: string): string | null {
  if (cwdRel.length > MAX_CWD_LEN) return `server "${name}": cwd is too long`
  if (isAbsolute(cwdRel) || cwdRel.startsWith('~')) {
    return `server "${name}": cwd must be relative to the project root`
  }
  if (SHELL_UNSAFE_RE.test(cwdRel)) return `server "${name}": cwd contains a shell character`
  const root = resolve(projectRoot)
  const target = resolve(root, cwdRel)
  if (target !== root && !target.startsWith(root + sep)) {
    return `server "${name}": cwd escapes the project root`
  }
  return null
}

// Đường dẫn tuyệt đối của thư mục chạy. Dựng TỪ gốc dự án do sidecar cấp, không
// bao giờ từ payload; đã được checkCwd chặn `..` lúc nạp, kiểm lại ở đây vì hàm
// này cũng là biên (fail fast thay vì trả ra một đường dẫn ngoài dự án).
export function resolveEntryCwd(projectRoot: string, entry: DevServerEntry): string {
  const root = resolve(projectRoot)
  const target = resolve(root, entry.cwd)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Dev server "${entry.name}": cwd escapes the project root`)
  }
  return target
}

// Nạp + kiểm tra bản khai. Không bao giờ throw vì nội dung file: file hỏng ⇒ danh
// sách rỗng + một dòng problem. Cổng quyền/UI không được sập vì một repo lạ.
export async function loadDevServerConfig(projectRoot: string): Promise<DevServerConfig> {
  const configPath = devServerConfigPath(projectRoot)
  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch {
    return { configPath, servers: [], problems: [], missing: true }
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (err) {
    return {
      configPath,
      servers: [],
      problems: [`${CONFIG_FILE_NAME} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`],
      missing: false,
    }
  }

  const file = FileSchema.safeParse(json)
  if (!file.success) {
    return {
      configPath,
      servers: [],
      problems: [`${CONFIG_FILE_NAME} must be an object with a "servers" array`],
      missing: false,
    }
  }

  const problems: string[] = []
  const servers: DevServerEntry[] = []
  const seen = new Set<string>()
  for (const item of file.data.servers) {
    if (servers.length >= MAX_SERVERS) {
      problems.push(`only the first ${MAX_SERVERS} servers are used; the rest were ignored`)
      break
    }
    const parsed = EntrySchema.safeParse(item)
    if (!parsed.success) {
      problems.push(`one entry is malformed: ${parsed.error.issues[0]?.message ?? 'invalid shape'}`)
      continue
    }
    const checked = checkEntry(parsed.data, projectRoot)
    if ('error' in checked) {
      problems.push(checked.error)
      continue
    }
    const key = checked.entry.name.toLowerCase()
    if (seen.has(key)) {
      problems.push(`server "${checked.entry.name}": duplicate name, the later entry was ignored`)
      continue
    }
    seen.add(key)
    servers.push(checked.entry)
  }
  return { configPath, servers, problems, missing: false }
}

export function findEntry(servers: DevServerEntry[], name: string): DevServerEntry | undefined {
  const wanted = name.trim().toLowerCase()
  return servers.find((s) => s.name.toLowerCase() === wanted)
}

// ─── Chuỗi lệnh khởi động ────────────────────────────────────────────────────

// Biến môi trường đánh dấu: nó vừa là NHÃN (cho phép tra ngược từ một background
// shell về tên server, xem registry.ts) vừa là thứ tiến trình con đọc được nếu
// muốn. Nhờ nó mà AWOG KHÔNG cần một registry thứ hai để nhớ "shell nào là server
// nào": bg-registry đã lưu nguyên văn `command` xuống đĩa, marker nằm trong đó.
export const MARKER_VAR = 'AWOG_DEV_SERVER'

export function markerFor(name: string): string {
  return `${MARKER_VAR}=${name} `
}

// Bọc một token cho an toàn khi ghép vào chuỗi shell. Token đã bị SHELL_UNSAFE_RE
// chặn hết ký tự nguy hiểm (kể cả nháy đơn) từ lúc nạp, nên bọc nháy đơn là đủ và
// không cần escape gì bên trong — vẫn assert lại: nếu một nháy đơn lọt tới đây thì
// đó là lỗi lập trình, và fail fast tốt hơn là sinh ra một chuỗi shell méo.
function shellToken(token: string): string {
  if (SHELL_UNSAFE_RE.test(token)) {
    throw new Error(`Dev server: refusing to build a command from an unsafe token: ${token}`)
  }
  // Token "hiền" giữ nguyên để người dùng đọc được nguyên văn lệnh trong prompt
  // quyền; chỉ cái nào có khoảng trắng/ký tự lạ mới bọc nháy.
  return /^[A-Za-z0-9._/@+=:,-]+$/.test(token) ? token : `'${token}'`
}

// Chuỗi lệnh chuẩn tắc của một server — CHÍNH XÁC thứ người dùng sẽ đọc trong
// prompt quyền và thứ được ghi vào meta của background shell.
//
// Vì sao vẫn là một chuỗi chứ không phải `spawn(cmd, args)`: bg-registry (ADR 0066)
// mới là chỗ chạy nền được — nó bọc lệnh trong một subshell để chuyển hướng log +
// ghi exit code, tức tầng dưới VỐN là shell. Tính "mảng arg" được giữ bằng cấu tạo:
// mọi token đã bị cấm ký tự shell VÀ được bọc nháy, nên shell nhìn thấy đúng một
// lệnh với đúng các arg đã khai — không token nào nối thêm được lệnh thứ hai.
export function buildLaunchCommand(projectRoot: string, entry: DevServerEntry): string {
  const dir = resolveEntryCwd(projectRoot, entry)
  const parts: string[] = []
  if (dir !== resolve(projectRoot)) parts.push(`cd ${shellToken(dir)} &&`)
  parts.push(markerFor(entry.name).trimEnd())
  parts.push(shellToken(entry.command))
  for (const arg of entry.args) parts.push(shellToken(arg))
  return parts.join(' ')
}

// Mẫu file để gợi ý khi dự án chưa khai gì. Nằm cạnh schema nên không bao giờ lệch.
export const CONFIG_EXAMPLE = JSON.stringify(
  {
    version: 1,
    servers: [
      {
        name: 'web',
        command: 'pnpm',
        args: ['dev'],
        cwd: 'apps/web',
        port: 3000,
        description: 'Nuxt dev server',
      },
    ],
  },
  null,
  2,
)
