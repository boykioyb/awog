// Chế độ xem "Nhóm" của danh sách phiên: một CÂY kiểu trang Notion, phiên con nằm
// dưới phiên cha, tên nhóm chính là tiêu đề phiên cha.
//
// Quan hệ cha–con đọc từ `Session.groupParentId` (engineId của phiên cha) — KHÁC
// `parentSessionId`, cái đó là fork lineage và đã có cây riêng ở useSessionForkTree.
//
// Cây được LÀM PHẲNG thành một mảng có `depth` thay vì dùng component đệ quy: hàng
// phiên (SessionListItem) đã mang sẵn rename inline, select mode và context menu, nên
// một component đệ quy sẽ phải chuyền toàn bộ chỗ đó xuống từng tầng, còn mảng phẳng
// thì template không đổi gì ngoài một lần thụt lề.

import { computed, ref, watch } from 'vue'
import type { Session } from '~/composables/useSessionsData'

export type SessionTreeRow = {
  session: Session
  // 0 = gốc. Chỉ dùng để thụt lề.
  depth: number
  // Có con (kể cả khi đang thu gọn) ⇒ hàng này vẽ nút xoè/thu.
  hasChildren: boolean
  // Tổng số con cháu mọi tầng, để hàng cha thu gọn vẫn nói được nó đang giấu bao nhiêu.
  descendants: number
  collapsed: boolean
}

// Số GỐC trên một trang. Đếm theo gốc chứ không theo hàng: cắt trang giữa một nhóm
// sẽ để phiên con mồ côi ở đầu trang sau, nhìn y như một phiên cấp cao nhất.
const ROOTS_PER_PAGE = 20
const STORAGE_COLLAPSED = 'awog.sessions.tree.collapsed'

// Đọc tập phiên cha đang thu gọn. Hỏng/không phải mảng ⇒ coi như chưa thu gọn gì:
// một localStorage rác không được phép giấu phiên của người dùng.
function readCollapsed(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_COLLAPSED) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

// Làm phẳng danh sách phiên ĐÃ LỌC + ĐÃ SẮP XẾP thành các hàng cây. Thứ tự của
// `sessions` được tôn trọng ở cả cấp gốc lẫn trong từng cụm con, nên "Sort by" của
// danh sách vẫn có tác dụng bên trong nhóm. Hàm THUẦN — mọi trạng thái ở ngoài.
function buildRows(sessions: Session[], collapsedIds: Set<string>): SessionTreeRow[] {
  const byEid = new Map<string, Session>()
  for (const s of sessions) if (s.engineId) byEid.set(s.engineId, s)

  // Con theo cha. Một phiên trỏ tới phiên cha KHÔNG có trong danh sách hiện tại (bị
  // lọc mất, đã lưu trữ, hoặc thuộc tab project khác) được coi là GỐC — nếu không nó
  // biến mất hoàn toàn, tức người dùng mất một phiên chỉ vì đang đứng ở tab khác.
  const childrenOf = new Map<string, Session[]>()
  const roots: Session[] = []
  for (const s of sessions) {
    const parentEid = s.groupParentId
    if (parentEid && byEid.has(parentEid) && parentEid !== s.engineId) {
      const bucket = childrenOf.get(parentEid)
      if (bucket) bucket.push(s)
      else childrenOf.set(parentEid, [s])
    } else {
      roots.push(s)
    }
  }

  // Đếm con cháu. `seen` chặn chu trình đã nằm sẵn trên đĩa (header sửa tay): sidecar
  // chặn chu trình lúc GHI, nhưng renderer đọc cả những file nó không ghi.
  const countDescendants = (eid: string, seen: Set<string>): number => {
    if (seen.has(eid)) return 0
    seen.add(eid)
    const kids = childrenOf.get(eid) ?? []
    return kids.reduce((n, k) => n + 1 + (k.engineId ? countDescendants(k.engineId, seen) : 0), 0)
  }

  const rows: SessionTreeRow[] = []
  const visited = new Set<number>()
  const visit = (s: Session, depth: number): void => {
    if (visited.has(s.id)) return // hàng rào chu trình
    visited.add(s.id)
    const eid = s.engineId
    const kids = eid ? (childrenOf.get(eid) ?? []) : []
    const collapsed = Boolean(eid && collapsedIds.has(eid))
    rows.push({
      session: s,
      depth,
      hasChildren: kids.length > 0,
      descendants: eid && kids.length ? countDescendants(eid, new Set()) : 0,
      collapsed,
    })
    if (collapsed) return
    for (const k of kids) visit(k, depth + 1)
  }
  for (const r of roots) visit(r, 0)

  // Phiên nằm TRONG một chu trình không bao giờ tới lượt `visit` (không cái nào là
  // gốc) nên sẽ biến mất. Vớt nốt ở cấp gốc: một cái cây hỏng không được phép giấu
  // phiên — mở được nó ra chính là cách duy nhất người dùng sửa được.
  for (const s of sessions) {
    if (visited.has(s.id)) continue
    visited.add(s.id)
    rows.push({ session: s, depth: 0, hasChildren: false, descendants: 0, collapsed: false })
  }
  return rows
}

export function useSessionTree(source: () => Session[]) {
  const collapsed = ref<Set<string>>(readCollapsed())
  watch(
    collapsed,
    (v) => {
      try {
        localStorage.setItem(STORAGE_COLLAPSED, JSON.stringify([...v]))
      } catch {
        // Riêng tư/hết quota: thu gọn vẫn chạy trong phiên làm việc này, chỉ không nhớ.
      }
    },
    { deep: true },
  )

  const allRows = computed(() => buildRows(source(), collapsed.value))

  // Trang hiện tại, ĐẾM THEO GỐC. Một gốc kéo theo trọn cụm con của nó, nên trang
  // cuối có thể dài hơn 20 hàng — đúng ý: nhóm không bị cắt đôi.
  const page = ref(1)
  const totalPages = computed(() =>
    Math.max(1, Math.ceil(allRows.value.filter((r) => r.depth === 0).length / ROOTS_PER_PAGE)),
  )
  // Danh sách thu hẹp (lọc/đổi tab) có thể làm trang hiện tại trỏ ra ngoài; kẹp lại
  // ở computed thay vì watcher để không có một nhịp render rỗng.
  const currentPage = computed(() => Math.min(page.value, totalPages.value))
  const rows = computed(() => {
    const start = (currentPage.value - 1) * ROOTS_PER_PAGE
    const end = start + ROOTS_PER_PAGE
    let rootSeen = -1
    return allRows.value.filter((r) => {
      if (r.depth === 0) rootSeen += 1
      return rootSeen >= start && rootSeen < end
    })
  })
  function setPage(n: number) {
    page.value = Math.min(Math.max(n, 1), totalPages.value)
  }

  function toggle(engineId: string | undefined) {
    if (!engineId) return
    const next = new Set(collapsed.value)
    if (next.has(engineId)) next.delete(engineId)
    else next.add(engineId)
    collapsed.value = next
  }

  return { rows, page: currentPage, totalPages, setPage, toggle }
}
