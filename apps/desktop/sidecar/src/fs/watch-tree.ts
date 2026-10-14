// Theo dõi một cây thư mục — nguồn DUY NHẤT của quyết định "watch bằng gì" cho cả
// watcher luôn-bật (watcher.ts) lẫn watcher workspace (fs-watcher.ts).
//
// macOS + Windows: `fs.watch(root, { recursive: true })` NATIVE — FSEvents /
// ReadDirectoryChangesW, MỘT handle cho cả cây, không quét ban đầu. KHÔNG dùng
// chokidar ở đây: chokidar 4+ bỏ fsevents nên trên macOS nó mở một `fs.watch`
// (kqueue ⇒ một fd) cho TỪNG file và thư mục, kèm một lượt quét toàn cây. Đo
// 2026-10-13 (Electron 33 / Node 20.18):
//   - repo 4,9k thư mục / 28k file: tiến trình cạn fd (`spawn /bin/sh EBADF`), event
//     loop đứng ~90s ⇒ engine trượt 3 heartbeat và bị giết sau log `EMFILE`;
//   - riêng watcher luôn-bật (skills/commands/wiki/… của mọi project) giữ ~1,7k fd
//     mỗi engine.
// Bản native: 0 fd tăng thêm, lag ≤ 2ms.
//
// Linux giữ chokidar: inotify dùng chung một fd mỗi loop (giới hạn là
// `max_user_watches`, không phải fd), còn `recursive` của Node 20 trên Linux là bản
// JS tự đi cây.

import { watch as fsWatch } from "node:fs";
import { relative, sep } from "node:path";
import { log } from "../util/logger.js";

export const USE_NATIVE_RECURSIVE =
  process.platform === "darwin" || process.platform === "win32";

export interface TreeWatcher {
  close: () => Promise<void>;
}

export interface WatchTreeOptions {
  /**
   * Số cấp thư mục con được đi xuống (ngữ nghĩa `depth` của chokidar): 0 = chỉ file
   * nằm thẳng trong root. Bỏ trống = không giới hạn.
   */
  depth?: number;
  /** Đường dẫn TƯƠNG ĐỐI theo root (phân cách `/` hoặc `\`) cần bỏ qua. */
  ignored?: (relPath: string) => boolean;
  /** Path TUYỆT ĐỐI vừa đổi (thêm / sửa / xoá — không phân biệt). */
  onPath: (absPath: string) => void;
  onError: (err: unknown) => void;
}

interface ChokidarWatcher {
  close: () => Promise<void> | void;
  on: (event: string, handler: (arg: string) => void) => void;
}

interface ChokidarModule {
  watch: (
    paths: string | string[],
    options: Record<string, unknown>,
  ) => ChokidarWatcher;
}

let chokidarModule: ChokidarModule | null = null;
let chokidarLoadAttempted = false;

async function getChokidar(): Promise<ChokidarModule | null> {
  if (chokidarLoadAttempted) return chokidarModule;
  chokidarLoadAttempted = true;
  try {
    // Dynamic: chỉ nhánh Linux cần, và import hỏng thì tắt auto-refresh thay vì
    // làm sập cả sidecar lúc nạp module.
    const mod = await import("chokidar");
    chokidarModule = mod as unknown as ChokidarModule;
    return chokidarModule;
  } catch (err) {
    log.warn("watch-tree: chokidar import failed — fs auto-refresh disabled", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Bắt đầu theo dõi `root`. Ném đồng bộ/async nếu root không tồn tại hoặc không mở
 * được (native) — caller quyết định thử lại. `null` = không có backend (chokidar
 * không nạp được trên Linux).
 */
export async function watchTree(
  root: string,
  opts: WatchTreeOptions,
): Promise<TreeWatcher | null> {
  if (USE_NATIVE_RECURSIVE) {
    const w = fsWatch(root, { recursive: true }, (_event, filename) => {
      // FSEvents đôi khi gửi sự kiện không tên (vd. cả cây bị đổi tên) — không có
      // path cụ thể để báo.
      if (!filename) return;
      const rel = filename.toString();
      if (
        opts.depth !== undefined &&
        rel.split(/[\\/]+/).length - 1 > opts.depth
      )
        return;
      if (opts.ignored?.(rel)) return;
      opts.onPath(`${root}${sep}${rel}`);
    });
    w.on("error", opts.onError);
    return {
      close: async () => {
        w.close();
      },
    };
  }

  const chokidar = await getChokidar();
  if (!chokidar) return null;
  const ignored = opts.ignored;
  const w = chokidar.watch(root, {
    ignoreInitial: true,
    ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
    ...(ignored ? { ignored: (p: string) => ignored(relative(root, p)) } : {}),
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    followSymlinks: false,
  });
  for (const ev of ["add", "change", "unlink", "addDir", "unlinkDir"])
    w.on(ev, opts.onPath);
  w.on("error", opts.onError);
  return { close: async () => Promise.resolve(w.close()) };
}
