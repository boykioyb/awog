import type { BoardItemPriority, BoardItemType } from '~/stores/board'

// Bộ lọc của trang /board: NHỚ lần cuối (quay lại trang không về "tất cả") + PRESET có
// tên ("Yahagi panwall", "Bug đang mở"…) bật lại một cú bấm.
//
// localStorage — đúng loại tiện ích theo-người-xem (lựa chọn hiển thị, không phải dữ
// liệu): mất thì chỉ về mặc định. Mọi đọc/ghi bọc try/catch (storage có thể bị chặn).
// Ô tìm kiếm CỐ Ý không nhớ ở trạng thái "lần cuối": quay lại trang mà bị lọc ngầm bởi
// một chữ gõ hôm qua thì board trông như mất việc. Preset thì giữ cả chữ tìm.

export type BoardView = 'board' | 'list'

export type BoardFilters = {
  project: string
  type: BoardItemType | ''
  priority: BoardItemPriority | ''
  showChildren: boolean
  query: string
}

export type BoardFilterPreset = { id: string; name: string; filters: BoardFilters }

const STATE_KEY = 'awog.board.filters'
const PRESETS_KEY = 'awog.board.presets'
const MAX_PRESETS = 20

const EMPTY: BoardFilters = { project: '', type: '', priority: '', showChildren: false, query: '' }

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage bị chặn — chỉ sống trong lần chạy này.
  }
}

// Giá trị đọc từ storage là L2 (người dùng/bản cũ sửa được) — chỉ nhận đúng hình.
function cleanFilters(raw: Partial<BoardFilters> | null | undefined): BoardFilters {
  return {
    project: typeof raw?.project === 'string' ? raw.project : '',
    type: typeof raw?.type === 'string' ? (raw.type as BoardFilters['type']) : '',
    priority: typeof raw?.priority === 'string' ? (raw.priority as BoardFilters['priority']) : '',
    showChildren: raw?.showChildren === true,
    query: typeof raw?.query === 'string' ? raw.query : '',
  }
}

const sameFilters = (a: BoardFilters, b: BoardFilters): boolean =>
  a.project === b.project &&
  a.type === b.type &&
  a.priority === b.priority &&
  a.showChildren === b.showChildren &&
  a.query.trim() === b.query.trim()

export function useBoardFilters() {
  const saved = read<Partial<BoardFilters> & { view?: BoardView }>(STATE_KEY)
  const initial = cleanFilters(saved)

  const filterProject = ref(initial.project)
  const filterType = ref<BoardFilters['type']>(initial.type)
  const filterPriority = ref<BoardFilters['priority']>(initial.priority)
  const showChildren = ref(initial.showChildren)
  const query = ref('')
  const view = ref<BoardView>(saved?.view === 'list' ? 'list' : 'board')

  const current = computed<BoardFilters>(() => ({
    project: filterProject.value,
    type: filterType.value,
    priority: filterPriority.value,
    showChildren: showChildren.value,
    query: query.value,
  }))

  watch([current, view], ([f, v]) => write(STATE_KEY, { ...f, query: '', view: v }))

  const presets = ref<BoardFilterPreset[]>(
    (read<BoardFilterPreset[]>(PRESETS_KEY) ?? [])
      .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
      .map((p) => ({ id: p.id, name: p.name, filters: cleanFilters(p.filters) })),
  )
  watch(presets, (list) => write(PRESETS_KEY, list), { deep: true })

  // Preset khớp ĐÚNG bộ lọc đang bật (dấu tick trong menu, tên hiện trên nút).
  const activePreset = computed(
    () => presets.value.find((p) => sameFilters(p.filters, current.value)) ?? null,
  )
  const isFiltered = computed(() => !sameFilters(current.value, EMPTY))

  function apply(f: BoardFilters): void {
    filterProject.value = f.project
    filterType.value = f.type
    filterPriority.value = f.priority
    showChildren.value = f.showChildren
    query.value = f.query
  }

  // Lưu bộ lọc đang bật thành preset. Trùng tên ⇒ ghi đè preset đó (đổi nội dung
  // giữ nguyên tên), không đẻ bản thứ hai cùng tên.
  function savePreset(name: string): void {
    const n = name.trim()
    if (!n) return
    const filters = { ...current.value }
    const same = presets.value.find((p) => p.name === n)
    if (same) {
      same.filters = filters
      return
    }
    presets.value = [
      ...presets.value,
      { id: `bf-${Date.now().toString(36)}`, name: n, filters },
    ].slice(-MAX_PRESETS)
  }

  function applyPreset(id: string): void {
    const p = presets.value.find((x) => x.id === id)
    if (p) apply(p.filters)
  }

  function deletePreset(id: string): void {
    presets.value = presets.value.filter((p) => p.id !== id)
  }

  function clearFilters(): void {
    apply(EMPTY)
  }

  return {
    filterProject,
    filterType,
    filterPriority,
    showChildren,
    query,
    view,
    presets,
    activePreset,
    isFiltered,
    savePreset,
    applyPreset,
    deletePreset,
    clearFilters,
  }
}
