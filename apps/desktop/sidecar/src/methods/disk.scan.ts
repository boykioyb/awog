import { z } from 'zod'
import { register } from '../transport/rpc.js'
import {
  cancelTreeScan,
  homeRoot,
  listJunkTargets,
  listVolumes,
  measure,
  startTreeScan,
  type DiskVolume,
  type JunkTarget,
} from '../monitor/disk.js'

// Dung lượng ổ — rẻ, gọi được liên tục.
register('disk.volumes', async (): Promise<{ volumes: DiskVolume[] }> => ({
  volumes: await listVolumes(),
}))

const TargetsParams = z
  .object({
    // Thư mục project để tìm node_modules/.nuxt/dist… ở cấp 1. UI lấy từ store
    // `projects`; sidecar không tự quyết định quét cây nào của người dùng.
    projectRoots: z.array(z.string().min(1)).max(200).optional(),
  })
  .optional()

// Danh sách mục CÓ THẬT — chỉ `stat`, không `du`, nên trả về ngay.
//
// Kèm `home`: UI cần biết thư mục nhà để phân biệt "duyệt được" (cả đĩa) với
// "xoá được" (chỉ trong nhà) — hai phạm vi CỐ Ý khác nhau.
register('disk.targets', async (raw): Promise<{ targets: JunkTarget[]; home: string }> => {
  const params = TargetsParams.parse(raw) ?? {}
  return { targets: await listJunkTargets(params.projectRoots ?? []), home: homeRoot() }
})

const PathParams = z.object({ path: z.string().min(1).max(4096) })

// Kích thước MỘT mục. Tách riêng vì `du` chậm (đo: 19.5s cho ~/Library/Caches) —
// UI gọi song song có giới hạn và hiện dần thay vì treo chờ một con số tổng.
register('disk.size', async (raw): Promise<{ path: string; sizeKb: number }> => {
  const params = PathParams.parse(raw)
  return measure(params.path)
})

// Một cấp con — PHÁT TỪNG MỤC qua event `disk.tree-entry` ngay khi `du` duyệt
// xong mục đó, chốt bằng `disk.tree-done`. Không trả danh sách ở đây: chờ xong
// mới trả nghĩa là người dùng nhìn "Đang quét…" 20 giây mà không biết đang ở đâu.
register('disk.tree', (raw): { scanId: string; path: string } => {
  const params = PathParams.parse(raw)
  // Trả cả đường dẫn đã chuẩn hoá: UI gửi lên dạng `/System/Volumes/Data/...`
  // (firmlink APFS) nhưng entry phát ra ở dạng `/...`, nên nếu UI giữ nguyên cái
  // nó gửi thì breadcrumb và `canTrash` nói về một đường dẫn khác với danh sách.
  return startTreeScan(params.path)
})

const CancelParams = z.object({ scanId: z.string().min(1).max(64) })

// Đóng drawer / lần sang thư mục khác ⇒ giết tiến trình `du` cũ, kẻo để lại vài
// tiến trình đang cày đĩa mà không ai đọc kết quả.
register('disk.tree-cancel', (raw): { ok: true } => {
  cancelTreeScan(CancelParams.parse(raw).scanId)
  return { ok: true }
})
