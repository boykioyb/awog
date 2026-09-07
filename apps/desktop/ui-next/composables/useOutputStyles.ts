import { computed, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'

// Output styles (WP11) — 21 style dựng sẵn nằm trong sidecar, cộng thêm style do
// người dùng TỰ VIẾT lưu thành file Markdown 2 tier:
//   global  → ~/.awog/styles/<id>.md
//   project → {project}/.awog/styles/<id>.md
//
// State để ở module-level nên mọi nơi (Settings → Styles và chip Style ở thanh
// trạng thái) dùng chung một danh sách, không mỗi chỗ tự nạp một bản.
// Không cần Pinia store: đây là dữ liệu chỉ đọc-ghi qua 3 RPC, không có logic
// domain nào khác.

export type StyleSource = 'global' | 'project'

export type OutputStyle = {
  id: string
  name: string
  description: string
  // Directive gửi vào system prompt — đây chính là nội dung người dùng viết.
  body: string
  source: StyleSource
  projectId?: string
}

export type BuiltInStyle = {
  id: string
  directive: string
}

export type StyleScanReport = {
  dir: string
  source: StyleSource
  found: number
  projectId?: string
}

export type OutputStyleInput = {
  id: string
  name: string
  description: string
  body: string
  source: StyleSource
  projectId?: string
}

type StylesListResponse = {
  builtIn?: BuiltInStyle[]
  styles?: OutputStyle[]
  reports?: StyleScanReport[]
}

// Danh tính đầy đủ của một style người dùng = (source, projectId, id): hai
// project có quyền đặt trùng id.
export const outputStyleKey = (s: Pick<OutputStyle, 'id' | 'source' | 'projectId'>): string =>
  `${s.source}|${s.projectId ?? ''}|${s.id}`

const builtIn = ref<BuiltInStyle[]>([])
const styles = ref<OutputStyle[]>([])
const reports = ref<StyleScanReport[]>([])
const loaded = ref(false)
const lastError = ref('')

// Những project đã được quét trong lần `styles.list` gần nhất. `styles.list` trả
// về TOÀN BỘ danh sách (không cộng dồn), nên nạp lại cho project B mà quên project
// A sẽ XOÁ style của A khỏi state — Settings đang mở sẽ mất hàng. Giữ tập này để
// mỗi lần nạp thêm đều là hợp của cũ + mới.
const scannedProjectIds = ref<Set<string>>(new Set())
// Lần nạp đang bay — nhiều nơi (Settings, chip Style của mỗi session) cùng gọi lúc
// mở app thì chỉ tốn một RPC.
let inFlight: Promise<void> | null = null

// Style người dùng NHÌN THẤY được từ một project: tier global (mọi project) +
// tier của ĐÚNG project đó. Style project A không được rò sang project B — id
// trùng nhau giữa hai project là hợp lệ và mỗi bên có nội dung riêng.
// Trùng id giữa hai tier ⇒ bản project thắng, khớp `resolveDirective` ở sidecar.
export function stylesForProject(projectId: string | undefined): OutputStyle[] {
  const byId = new Map<string, OutputStyle>()
  for (const s of styles.value) {
    if (s.source === 'project' && (!projectId || s.projectId !== projectId)) continue
    const prev = byId.get(s.id)
    if (!prev || (s.source === 'project' && prev.source === 'global')) byId.set(s.id, s)
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// "Id này có phải style do người dùng viết không?" — câu trả lời phải ĐỒNG BỘ vì
// người gọi (normalizeStyleSlug) là hàm thuần dùng trong store. Không scope theo
// project: nó chỉ để nhận diện id, còn việc hiển thị/chọn thì đi qua
// stylesForProject. Trước khi danh sách về, hàm trả false — id lạ vẫn được
// normalizeStyleSlug cho đi qua nên không có degrade im lặng nào ở giữa.
const userStyleIds = computed(() => new Set(styles.value.map((s) => s.id)))
export function isUserStyleId(id: string): boolean {
  return userStyleIds.value.has(id)
}

// Đã quét đủ để KẾT LUẬN "id này không tồn tại" trong tầm nhìn của project chưa.
// Chỉ `loaded` là không đủ: một lần nạp trước đó (Settings) có thể chưa đụng tới
// project của session đang mở, và kết luận vội sẽ hiện nhãn "không còn trên đĩa"
// cho một style hoàn toàn hợp lệ, rồi nháy về tên thật khi danh sách về.
export function stylesScanned(projectId: string | undefined): boolean {
  if (!loaded.value) return false
  return !projectId || scannedProjectIds.value.has(projectId)
}

export function useOutputStyles() {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  // Id dựng sẵn đang bị style người dùng che. Cùng id ⇒ bản người dùng thắng —
  // UI phải nói rõ điều đó, nếu không người dùng sẽ sửa file và không hiểu vì
  // sao giọng văn không đổi (hoặc ngược lại).
  const shadowedBuiltInIds = computed(() => {
    const userIds = new Set(styles.value.map((s) => s.id))
    return new Set(builtIn.value.filter((b) => userIds.has(b.id)).map((b) => b.id))
  })

  async function loadStyles(projectIds: string[] = []): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      const res = await sc.request<StylesListResponse>(
        'styles.list',
        projectIds.length > 0 ? { projectIds } : {},
      )
      builtIn.value = Array.isArray(res.builtIn) ? res.builtIn : []
      styles.value = Array.isArray(res.styles) ? res.styles : []
      reports.value = Array.isArray(res.reports) ? res.reports : []
      scannedProjectIds.value = new Set(projectIds.filter((id) => id !== ''))
      lastError.value = ''
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    } finally {
      loaded.value = true
    }
  }

  // Nạp một lần cho mỗi tập project, dùng cho chỗ CHỈ ĐỌC danh sách (chip Style
  // của session). Khác `loadStyles` — vốn là "làm tươi lại", Settings gọi mỗi lần
  // mở pane: ở đây mở session nào cũng nạp lại thì thừa, mà bỏ qua thì style
  // tier project của session mới sẽ không thấy. Không await ở chỗ gọi: picker
  // vẫn dùng được ngay với style dựng sẵn, nhóm của người dùng hiện thêm khi
  // danh sách về.
  async function ensureStylesLoaded(projectIds: string[] = []): Promise<void> {
    if (inFlight) await inFlight
    const missing = projectIds.filter((id) => id !== '' && !scannedProjectIds.value.has(id))
    if (loaded.value && missing.length === 0) return
    inFlight = loadStyles([...scannedProjectIds.value, ...missing])
    try {
      await inFlight
    } finally {
      inFlight = null
    }
  }

  async function saveStyle(
    input: OutputStyleInput,
    mode: 'create' | 'update',
  ): Promise<OutputStyle | null> {
    if (!available.value) return null
    try {
      const res = await sc.request<{ style: OutputStyle }>('styles.upsert', {
        style: {
          id: input.id,
          name: input.name,
          description: input.description,
          body: input.body,
          source: input.source,
          ...(input.projectId ? { projectId: input.projectId } : {}),
        },
        mode,
      })
      const key = outputStyleKey(res.style)
      const existing = styles.value.find((s) => outputStyleKey(s) === key)
      if (existing) Object.assign(existing, res.style)
      else styles.value.push(res.style)
      lastError.value = ''
      return res.style
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return null
    }
  }

  async function deleteStyle(
    style: Pick<OutputStyle, 'id' | 'source' | 'projectId'>,
  ): Promise<boolean> {
    if (!available.value) return false
    const key = outputStyleKey(style)
    try {
      await sc.request('styles.delete', {
        id: style.id,
        source: style.source,
        ...(style.projectId ? { projectId: style.projectId } : {}),
      })
      styles.value = styles.value.filter((s) => outputStyleKey(s) !== key)
      lastError.value = ''
      return true
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  return {
    // state
    builtIn,
    styles,
    reports,
    loaded,
    available,
    lastError,
    // getters
    shadowedBuiltInIds,
    stylesForProject,
    stylesScanned,
    // actions
    loadStyles,
    ensureStylesLoaded,
    saveStyle,
    deleteStyle,
  }
}
