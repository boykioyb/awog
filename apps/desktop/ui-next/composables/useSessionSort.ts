import { SORTBY, type Session, type SortBy } from '~/composables/useSessionsData'

// Cách sắp xếp danh sách phiên — MỘT lựa chọn dùng chung cho cột /sessions
// (SessionList) và view Phiên của Explorer Workbench (SessionsView): đổi ở một nơi
// thì nơi kia theo luôn, vì cả hai là cùng một danh sách nhìn ở hai chỗ.
//
// Ref ở module scope (singleton) + nhớ qua localStorage. Mặc định 'updated' — sửa
// đổi gần nhất lên đầu (`updatedAt` được store bump ngay khi gửi tin / lượt xong,
// nên thứ tự theo kịp việc đang làm mà không cần nạp lại).
const STORAGE_SORTBY = 'awog.sessions.filter.sortBy'

function readSortBy(): SortBy {
  try {
    const v = localStorage.getItem(STORAGE_SORTBY)
    return v && (SORTBY as readonly string[]).includes(v) ? (v as SortBy) : 'updated'
  } catch {
    return 'updated'
  }
}

const sortBy = ref<SortBy>(readSortBy())
watch(sortBy, (v) => {
  try {
    localStorage.setItem(STORAGE_SORTBY, v)
  } catch {
    // Storage bị chặn: lựa chọn chỉ sống trong lần chạy này.
  }
})

function tsOf(iso?: string): number {
  const n = iso ? Date.parse(iso) : NaN
  return Number.isNaN(n) ? 0 : n
}

// Thời gian: mới nhất trước; tên: A→Z theo locale.
const SORT_CMP: Record<SortBy, (a: Session, b: Session) => number> = {
  updated: (a, b) => tsOf(b.updatedAt) - tsOf(a.updatedAt),
  created: (a, b) => tsOf(b.createdAt) - tsOf(a.createdAt),
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
}

export function useSessionSort() {
  // Ghim lên đầu, rồi tới cách sắp xếp đã chọn. Trả mảng MỚI — không đụng mảng nguồn.
  function sortSessions(list: readonly Session[]): Session[] {
    const cmp = SORT_CMP[sortBy.value]
    return list
      .slice()
      .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || cmp(a, b))
  }
  return { sortBy, sortOptions: SORTBY, sortSessions }
}
