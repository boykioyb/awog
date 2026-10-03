import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { BOARD_STATUS_ORDER, listBoardItems } from '../boards/store.js'
import type { BoardItemStatus } from '../types/shared.js'

// Đọc board work-item của một project (docs/features/session-teams.md §7) —
// nguồn dữ liệu cho cột board của "team cockpit". Board sống theo PROJECT
// (~/.awog/boards/<projectId>.json) chứ không theo nhóm: xoá nhóm không mất
// backlog.
//
// `projectId` đi vào một sink đường dẫn (tên file) nên siết đúng charset của
// `projects.upsert` — sanitizeChild trong store chỉ chặn '/', '\\', '..'; chặt
// hơn ở biên giữ payload sạch sớm.
const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]*$/

const Params = z.object({
  projectId: z.string().min(3).max(64).regex(PROJECT_ID_RE),
})

// Cột trước, mới-sửa sau: item đang chạy / chờ review / kẹt phải nổi lên đầu
// (đúng phần "Cần bạn quyết" của cockpit), backlog và đã xong chìm xuống cuối.
const STATUS_RANK = new Map<BoardItemStatus, number>(BOARD_STATUS_ORDER.map((s, i) => [s, i]))

register('boards.list', async (raw) => {
  const params = Params.parse(raw)
  const items = await listBoardItems(params.projectId)
  items.sort(
    (a, b) =>
      (STATUS_RANK.get(a.status) ?? BOARD_STATUS_ORDER.length) -
        (STATUS_RANK.get(b.status) ?? BOARD_STATUS_ORDER.length) ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  )
  return { items }
})
