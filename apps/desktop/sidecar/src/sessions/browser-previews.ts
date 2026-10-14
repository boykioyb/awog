// Thẻ xem trước trang của `browser_tool` (docs/features/browser-preview-card.md).
//
// Mỗi lần agent mở một trang (navigate / tab_new có url), ta lưu một ảnh JPEG nhỏ +
// metadata (title, url, tabId) dưới thư mục của chính session:
//
//   ~/.awog/sessions/<sessionId>/thumbs/<key>.jpg
//   ~/.awog/sessions/<sessionId>/thumbs/<key>.json
//
// `key` suy ra từ id của step = tool_use id. Id đó sống sót qua reload kể cả ở
// pointer-mode (ADR 0097: transcript dựng lại từ JSONL của Claude CLI nên step id
// chính là tool_use id), nên thẻ tìm lại được ảnh mà không cần ghi gì vào transcript.
//
// Ảnh KHÔNG BAO GIỜ đi vào kết quả tool gửi cho model: nó chỉ nằm trên đĩa và đi tới
// UI qua RPC `sessions.browserPreview` (data URL, bị cap kích thước).
//
// Bảo mật: `sessionId` đi qua `sanitizeChild` (sessionDir), `stepId` đi qua
// `thumbKey` — id không khớp charset an toàn bị băm thành hex nên KHÔNG có đường nào
// cho ký tự `/`, `\` hay `..` chạm vào tên file (invariant #2). Đọc từ đĩa vẫn coi là
// L2: lstat từ chối symlink, file quá cap bị bỏ, meta đi qua zod.

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { log } from "../util/logger.js";
import { MESSAGE_ID_RE } from "./ids.js";
import { sessionDir } from "./jsonl.js";

// 640px JPEG q70 đo ra ~20–60KB; 512KB là trần cho cả ghi lẫn đọc để một file bị
// thay ruột không biến thành data URL khổng lồ trên đường IPC.
export const MAX_THUMB_BYTES = 512 * 1024;

const THUMBS_DIR_NAME = "thumbs";

const MetaSchema = z.object({
  url: z.string().max(4096),
  title: z.string().max(1024),
  tabId: z.string().max(64),
  hasThumb: z.boolean(),
});

export type BrowserPreviewMeta = z.infer<typeof MetaSchema>;

export type BrowserPreview = BrowserPreviewMeta & {
  // `data:image/jpeg;base64,…` hoặc null khi không có ảnh (chụp lỗi / file mất).
  thumbDataUrl: string | null;
};

// Khoá file từ step id. Id hợp lệ giữ nguyên (đọc được khi debug); id lạ (vd. id của
// provider khác chứa `|`, `.`) băm sha1 rút gọn. Hàm này là nguồn DUY NHẤT cho cả
// ghi lẫn đọc nên hai phía không thể lệch nhau.
export function thumbKey(stepId: string): string {
  if (MESSAGE_ID_RE.test(stepId)) return stepId;
  return `h-${createHash("sha1").update(stepId).digest("hex").slice(0, 24)}`;
}

const SESSION_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

function thumbsDir(sessionId: string): string {
  // sanitizeChild chặn `/`, `\`, `..`; thêm charset + cấm tên toàn dấu chấm (`.` sẽ
  // trỏ thẳng vào thư mục sessions/ dùng chung).
  if (!SESSION_ID_RE.test(sessionId) || /^\.+$/.test(sessionId)) {
    throw new Error("Invalid session id");
  }
  return join(sessionDir(sessionId), THUMBS_DIR_NAME);
}

export async function saveBrowserPreview(
  sessionId: string,
  stepId: string,
  meta: { url: string; title: string; tabId: string },
  jpegBase64: string | null,
): Promise<void> {
  const dir = thumbsDir(sessionId);
  const key = thumbKey(stepId);
  const jpeg = jpegBase64 ? Buffer.from(jpegBase64, "base64") : null;
  // Ảnh quá cap thì bỏ ảnh, giữ thẻ — đúng tinh thần best-effort.
  const keep =
    jpeg !== null && jpeg.length > 0 && jpeg.length <= MAX_THUMB_BYTES;
  await mkdir(dir, { recursive: true });
  if (keep) await writeFile(join(dir, `${key}.jpg`), jpeg);
  const record: BrowserPreviewMeta = {
    url: meta.url.slice(0, 4096),
    title: meta.title.slice(0, 1024),
    tabId: meta.tabId.slice(0, 64),
    hasThumb: keep,
  };
  await writeFile(join(dir, `${key}.json`), JSON.stringify(record));
}

// null = chưa từng lưu cho step này (step không phải trang, hoặc lưu thất bại).
export async function readBrowserPreview(
  sessionId: string,
  stepId: string,
): Promise<BrowserPreview | null> {
  const dir = thumbsDir(sessionId);
  const key = thumbKey(stepId);
  let meta: BrowserPreviewMeta;
  try {
    const metaPath = join(dir, `${key}.json`);
    const st = await lstat(metaPath);
    if (!st.isFile() || st.size > 16 * 1024) return null;
    meta = MetaSchema.parse(JSON.parse(await readFile(metaPath, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      log.warn("browser preview meta unreadable", {
        sessionId,
        stepId,
        err: String(err),
      });
    }
    return null;
  }
  let thumbDataUrl: string | null = null;
  if (meta.hasThumb) {
    try {
      const jpgPath = join(dir, `${key}.jpg`);
      const st = await lstat(jpgPath);
      if (st.isFile() && st.size > 0 && st.size <= MAX_THUMB_BYTES) {
        thumbDataUrl = `data:image/jpeg;base64,${(await readFile(jpgPath)).toString("base64")}`;
      }
    } catch {
      // Ảnh mất sau khi ghi meta (người dùng dọn thư mục): thẻ vẫn hiện, không ảnh.
    }
  }
  return { ...meta, thumbDataUrl };
}

// ─── Gắn tool_use id vào lời gọi của handler MCP (nhánh Claude SDK) ──────────
//
// Handler MCP in-process của SDK KHÔNG nhận tool_use id (không có `_meta` đo được ở
// bản 0.3.296), còn PreToolUse hook thì có — và nó chạy TRƯỚC handler. Hook ghi một
// "phiếu" theo dấu vân tay lời gọi, handler nhận phiếu khớp. Khoá theo `scope` (session
// id) để hai phiên cùng điều hướng một URL không nhận nhầm phiếu của nhau. Phiếu hết
// hạn sau 5 phút và mỗi scope giữ tối đa 32 để hook gọi mà handler không bao giờ chạy
// (bị deny sau đó) không làm phình bộ nhớ.

type Ticket = { toolUseId: string; fingerprint: string; at: number };

const TICKET_TTL_MS = 5 * 60_000;
const MAX_TICKETS_PER_SCOPE = 32;
const tickets = new Map<string, Ticket[]>();

function fingerprint(action: unknown, url: unknown, tabId: unknown): string {
  return JSON.stringify([
    typeof action === "string" ? action : "",
    typeof url === "string" ? url : "",
    typeof tabId === "string" ? tabId : "",
  ]);
}

// Chỉ những lời gọi MANG thẻ (navigate / tab_new có url) mới cần phiếu.
export function wantsPreview(action: unknown, url: unknown): boolean {
  return (
    (action === "navigate" || action === "tab_new") &&
    typeof url === "string" &&
    url !== ""
  );
}

export function noteBrowserToolUse(
  scope: string,
  toolUseId: string,
  input: { action?: unknown; url?: unknown; tabId?: unknown },
): void {
  if (!wantsPreview(input.action, input.url) || !toolUseId) return;
  const now = Date.now();
  const list = (tickets.get(scope) ?? []).filter(
    (t) => now - t.at < TICKET_TTL_MS,
  );
  list.push({
    toolUseId,
    fingerprint: fingerprint(input.action, input.url, input.tabId),
    at: now,
  });
  tickets.set(scope, list.slice(-MAX_TICKETS_PER_SCOPE));
}

export function claimBrowserToolUse(
  scope: string,
  input: { action?: unknown; url?: unknown; tabId?: unknown },
): string | undefined {
  const list = tickets.get(scope);
  if (!list) return undefined;
  const fp = fingerprint(input.action, input.url, input.tabId);
  const i = list.findIndex((t) => t.fingerprint === fp);
  if (i < 0) return undefined;
  const [hit] = list.splice(i, 1);
  if (list.length === 0) tickets.delete(scope);
  return hit?.toolUseId;
}
