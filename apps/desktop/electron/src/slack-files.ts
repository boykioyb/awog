import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { resolveInsideWorkspace } from './workspace-scope'

// Phần THUẦN (không import electron) của lớp Electron cho Slack threads
// (docs/features/slack-threads.md). Tách riêng để kiểm bằng `node --test` mà không
// phải dựng app Electron, và để media.ts / ipc.ts / slack-window.ts dùng chung một
// nguồn cho đường dẫn gốc + các phép kiểm.

// Gốc CỐ ĐỊNH chứa file Slack sidecar đã tải: `~/.awog/slack/files/<teamId>/<fileId>/<tên>`.
// Phải khớp `awogHome()` của sidecar (= os.homedir()/.awog) — đổi bố cục bên đó thì
// đổi cả đây. Hằng số ở main chứ không nhận từ renderer: renderer chỉ được trỏ vào
// một file BÊN TRONG gốc này, không bao giờ được chọn gốc (bất biến #2).
export const SLACK_FILES_DIR = join(homedir(), '.awog', 'slack', 'files')

// Khoá thread `${teamId}:${channelId}:${threadTs}` — cùng regex với sidecar
// (`slack/types.ts`). Kiểm ở đây vì giá trị đi từ renderer (L1) thẳng vào URL query.
const THREAD_ID_RE = /^T[A-Z0-9]{6,}:[CGD][A-Z0-9]{6,}:\d{10}\.\d{6}$/

export function isValidThreadId(v: unknown): v is string {
  return typeof v === 'string' && THREAD_ID_RE.test(v)
}

// Đường dẫn renderer gửi lên (L1) → đường dẫn thật (realpath) của một FILE nằm trong
// SLACK_FILES_DIR. Dùng lại resolveInsideWorkspace để phép chống `..` + symlink chỉ
// sống ở một chỗ. Bắt buộc tuyệt đối: renderer luôn có path tuyệt đối từ
// `slack.file.fetch`, nên một path tương đối là dấu hiệu payload lạ — từ chối luôn
// thay vì đoán gốc. Thư mục (kể cả chính gốc, hay một bundle `.app`) bị từ chối.
export function resolveSlackFile(p: unknown): string {
  if (typeof p !== 'string' || !isAbsolute(p)) {
    throw new Error('slack file path must be absolute')
  }
  const real = resolveInsideWorkspace(SLACK_FILES_DIR, p)
  if (!statSync(real).isFile()) throw new Error('slack file path is not a regular file')
  return real
}

// Tên gợi ý cho hộp thoại "Save as…". Tên file đến từ Slack (người khác đặt) nên làm
// sạch như sidecar: bỏ ký tự điều khiển + dấu phân cách đường dẫn + ký tự Windows cấm,
// gộp `..`, bỏ chấm đầu (không tạo file ẩn), cắt 120 ký tự. Hộp thoại vẫn là người
// dùng chọn đích cuối, đây chỉ là giá trị mặc định cho đỡ bất ngờ.
const NAME_MAX = 120
export function safeFileName(name: unknown): string {
  const raw = typeof name === 'string' ? name : ''
  const cleaned = raw
    .replace(/[\p{Cc}/\\<>:"|?*]/gu, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, NAME_MAX)
  return cleaned || 'file'
}

// "Mở bằng app mặc định" cho file NGƯỜI KHÁC gửi qua Slack — ALLOWLIST, không phải
// blocklist. Blocklist luôn hở: `.zip`/`.dmg` (Archive Utility/Finder bung ra rồi mở
// tiếp), `.webloc`/`.url` (mở URL tuỳ ý), `.docm`/`.xlsm` (macro), `.html`/`.svg` (chạy
// script trong trình duyệt với origin file://)… mà danh sách loại "OS sẽ CHẠY" thì
// không bao giờ liệt kê hết. Nên chỉ cho mở những loại CHỈ-XEM dưới đây; còn lại người
// dùng lấy file qua "Save as…" (chỉ chép, không chạy).
//
// Không có `svg` (là tài liệu XML chạy được script, mở bằng trình duyệt) và không có
// Office định dạng có macro (`docm`/`xlsm`/`pptm`) hay định dạng cũ (`doc`/`xls`/`ppt`
// có thể mang macro mà không đổi đuôi).
const OPEN_ALLOWED_EXT = new Set([
  // Tài liệu
  '.pdf',
  // Ảnh raster
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.heic',
  '.bmp',
  '.tif',
  '.tiff',
  // Video / audio
  '.mp4',
  '.m4v',
  '.mov',
  '.webm',
  '.mp3',
  '.m4a',
  '.wav',
  '.aac',
  '.flac',
  '.ogg',
  // Văn bản thuần
  '.txt',
  '.csv',
  '.tsv',
  '.log',
  '.md',
  '.json',
  // Office XML không macro
  '.docx',
  '.xlsx',
  '.pptx',
])

// Tiền tố message lỗi của `slack:openPath` khi từ chối mở. Electron chỉ chuyển
// `message` qua `ipcRenderer.invoke` (bọc thêm "Error invoking remote method…"), nên
// UI dò chuỗi này để gợi ý "Lưu thành…" thay vì hiện lỗi chung.
export const SLACK_OPEN_BLOCKED = 'slack_open_blocked'

// Lý do từ chối mở: `type` = đuôi ngoài allowlist; `executable` = đuôi được phép nhưng
// file có bit thực thi (POSIX) — LaunchServices có thể chọn chạy thay vì mở xem, và
// file Slack tải về không bao giờ cần bit x. null = được mở.
export type OpenRefusal = 'type' | 'executable'

// `mode` = st.mode của file.
export function openRefusal(path: string, mode: number, platform: NodeJS.Platform): OpenRefusal | null {
  if (!OPEN_ALLOWED_EXT.has(extname(path).toLowerCase())) return 'type'
  if (platform !== 'win32' && (mode & 0o111) !== 0) return 'executable'
  return null
}

// ─── Cờ "tải từ Internet" cho bản chép "Lưu thành…" ─────────────────────────
//
// `copyFile` KHÔNG mang theo `com.apple.quarantine` của bản cache (đo trên macOS
// 2026-10-16: bản chép sạch cờ) — file người ngoài gửi qua Slack mà mất cờ thì mở từ
// Downloads Gatekeeper/SmartScreen không cảnh báo nữa. Gắn lại đúng giá trị sidecar
// dùng khi tải (`sidecar/src/slack/files.ts` → markDownloadedFromInternet): đổi một
// bên thì đổi cả bên kia.

// `0081` = tải về, chưa được người dùng duyệt; timestamp là epoch giây dạng hex; agent
// hiện trong hộp thoại Gatekeeper.
export function quarantineValue(nowMs: number): string {
  return `0081;${Math.floor(nowMs / 1000).toString(16)};AWOG;`
}

// Nội dung luồng ADS `Zone.Identifier` của Windows — `ZoneId=3` = vùng Internet.
export const ZONE_IDENTIFIER = '[ZoneTransfer]\r\nZoneId=3\r\n'

const execFileAsync = promisify(execFile)

// Ném lỗi khi gắn cờ hỏng — caller chỉ LOG, không được làm hỏng việc lưu file. Linux
// không có cơ chế tương đương ⇒ không làm gì.
export async function markDownloadedFromInternet(
  path: string,
  platform: NodeJS.Platform = process.platform,
  nowMs: number = Date.now(),
): Promise<void> {
  if (platform === 'darwin') {
    // Mảng tham số, không shell: `path` do người dùng chọn, tên gợi ý đến từ Slack.
    await execFileAsync('xattr', ['-w', 'com.apple.quarantine', quarantineValue(nowMs), path])
  } else if (platform === 'win32') {
    await writeFile(`${path}:Zone.Identifier`, ZONE_IDENTIFIER, 'utf8')
  }
}
