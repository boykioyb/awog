// Phiên BONG BÓNG ở góc phải màn hình — một phiên thu nhỏ, thư mục riêng `awog-infra`.
//
// YÊU CẦU NGƯỜI DÙNG, nguyên văn: "làm cả phần bubble session ở góc phải màn hình…
// bản chất nó là mini session, folder tương tác sẽ là awog-infra (không phải awog,
// tôi muốn nó là infra riêng, tạo folder mới nếu chưa có). Mở full sẽ điều hướng về
// session. … trong màn agent sẽ có hiển thị toàn bộ session cả danh sách".
//
// HAI THỨ ĐƯỢC BẢO ĐẢM, VÀ CHÚNG KHÁC NHAU VỀ MỤC ĐÍCH:
//
//   · PROJECT `awog-infra` — để phiên này có một chỗ đứng trong sidebar, có tên, và
//     không lẫn với các phiên của repo đang mở. Đây là phần "infra riêng".
//
//   · `workspaceFolder` của CHÍNH PHIÊN — trỏ thẳng vào cùng thư mục đó. Đây là
//     phần thật sự quyết định cwd: `sessions.send-message` gửi `workspacePath` theo
//     TỪNG lượt từ trường này, nên kể cả project có bị đổi sau đó thì "folder tương
//     tác" vẫn là `awog-infra`.
//
// VÌ SAO STATE NẰM Ở MODULE (không phải trong component). Bong bóng cần sống ngoài
// mọi trang: nó được mở từ `/infra`, từ một phiên chat, hay từ một lần "Hỏi agent"
// ở bất kỳ màn nào. Một state trong component nghĩa là mỗi lần đổi trang là mất
// phiên đang thu nhỏ — đúng thứ mà "mini session" sinh ra để tránh. Khuôn này là
// khuôn của `useMinimizeDock` (một nguồn sự thật, đọc được từ mọi nơi).
//
// KHÔNG BAO GIỜ TỰ TẠO PHIÊN KHI CHƯA AI HỎI. `ensure()` chỉ chạy khi mở bong bóng
// hoặc khi "Hỏi agent → phiên mới": tạo một phiên là một lượt gọi provider (tốn
// quota) và một dòng trong danh sách của người dùng.
import { computed, ref } from 'vue'
import { useInfraResourcesApi } from '~/composables/useInfraResourcesApi'
import { useProjectsStore } from '~/stores/projects'
import { useSessionsStore } from '~/stores/sessions'
import { useToast } from '~/composables/useToast'

/** Tên project + thư mục — một hằng số, vì đây là một phần của yêu cầu. */
export const INFRA_PROJECT_NAME = 'awog-infra'

const open = ref(false)
/** Phiên đang hiện trong bong bóng. `null` = chưa có (sẽ tạo khi cần). */
const sessionId = ref<number | null>(null)
const projectId = ref<string | null>(null)
const workspacePath = ref('')
/** 'chat' = bong bóng đang hiện hội thoại; 'list' = đang hiện DANH SÁCH phiên. */
const pane = ref<'chat' | 'list'>('chat')
const provisioning = ref(false)
const provisionError = ref('')

export function useInfraBubble() {
  const api = useInfraResourcesApi()
  const sessions = useSessionsStore()
  const projects = useProjectsStore()
  const toast = useToast()
  const { t } = useI18n()

  const session = computed(() =>
    sessionId.value == null
      ? null
      : (sessions.sessions.find((s) => s.id === sessionId.value) ?? null),
  )

  /** Toàn bộ phiên, mới nhất trước — "trong màn agent sẽ có hiển thị toàn bộ session". */
  const allSessions = computed(() =>
    [...sessions.sessions].sort((a, b) => {
      const at = a.updatedAt ?? a.createdAt ?? ''
      const bt = b.updatedAt ?? b.createdAt ?? ''
      return at < bt ? 1 : at > bt ? -1 : 0
    }),
  )

  /**
   * Bảo đảm thư mục + project tồn tại. Tách khỏi `ensureSession()` vì "Hỏi agent →
   * phiên mới" cần đúng bước này mà không cần mở bong bóng.
   */
  async function ensureWorkspace(dir?: string): Promise<string> {
    if (workspacePath.value) return workspacePath.value
    try {
      const res = await api.bubbleWorkspace(dir)
      workspacePath.value = res.path
      // Project chỉ để có tên trong sidebar; thư mục đã tồn tại nên `projects.upsert`
      // (nó kiểm tra path là thư mục thật) sẽ nhận.
      const norm = (p: string) => p.replace(/\/+$/, '')
      const existing = projects.projects.find((p) => norm(p.path) === norm(res.path))
      if (existing) {
        projectId.value = existing.id
      } else {
        const project = await projects.linkProject({
          name: INFRA_PROJECT_NAME,
          path: res.path,
          description: t('infra.bubble.projectDescription'),
          language: '',
          gitRemote: '',
          gitBranch: '',
        })
        projectId.value = project.id
      }
      return res.path
    } catch (err) {
      provisionError.value = err instanceof Error ? err.message : String(err)
      throw err
    }
  }

  /**
   * Phiên của bong bóng. Tạo mới nếu chưa có (hoặc phiên cũ đã bị xoá).
   *
   * `workspaceFolder` được ghim NGAY sau khi tạo: project đã là `awog-infra`, nhưng
   * ghim thêm ở cấp phiên là thứ khiến cwd đúng kể cả khi project đổi về sau.
   */
  async function ensureSession(): Promise<number | null> {
    if (sessionId.value != null) {
      if (sessions.sessions.some((s) => s.id === sessionId.value)) return sessionId.value
      sessionId.value = null
    }
    if (provisioning.value) return sessionId.value
    provisioning.value = true
    provisionError.value = ''
    try {
      const path = await ensureWorkspace()
      const id = sessions.create(projectId.value ?? undefined)
      if (id == null) {
        // `create()` trả null khi quota chặn — đã có toast riêng của store, ở đây
        // chỉ giữ bong bóng ở trạng thái "chưa có phiên" thay vì tạo phiên nửa vời.
        provisionError.value = t('infra.bubble.quota')
        return null
      }
      sessionId.value = id
      sessions.setWorkspaceFolder(id, path)
      sessions.rename(id, t('infra.bubble.title'))
      return id
    } catch (err) {
      provisionError.value = err instanceof Error ? err.message : String(err)
      toast.add({ title: provisionError.value, color: 'error' })
      return null
    } finally {
      provisioning.value = false
    }
  }

  /** Mở bong bóng, tạo phiên nếu cần, và hiện hội thoại. */
  async function openBubble(): Promise<void> {
    open.value = true
    pane.value = 'chat'
    await ensureSession()
  }

  function closeBubble(): void {
    open.value = false
  }

  async function toggleBubble(): Promise<void> {
    if (open.value) closeBubble()
    else await openBubble()
  }

  /** "Mở full" — điều hướng về PHIÊN (yêu cầu người dùng), không phải về /infra. */
  async function expand(): Promise<void> {
    const id = await ensureSession()
    closeBubble()
    if (id == null) return
    sessions.setActive(id)
    await navigateTo('/sessions')
  }

  /** Trỏ bong bóng sang một phiên khác trong danh sách (chế độ thu nhỏ). */
  function selectSession(id: number): void {
    sessionId.value = id
    pane.value = 'chat'
  }

  /** Chỉ tạo phiên + ghim nội dung vào ô soạn tin; KHÔNG gửi (người dùng xem lại đã). */
  async function seedIntoNewSession(text: string): Promise<boolean> {
    const id = await ensureSession()
    if (id == null) return false
    const current = sessions.sessions.find((s) => s.id === id)?.draft ?? ''
    const next = current.trim() ? `${current.replace(/\s+$/, '')}\n\n${text}\n` : `${text}\n`
    sessions.setDraft(id, next)
    return true
  }

  return {
    open,
    pane,
    sessionId,
    session,
    allSessions,
    workspacePath,
    projectId,
    provisioning,
    provisionError,
    ensureWorkspace,
    ensureSession,
    openBubble,
    closeBubble,
    toggleBubble,
    expand,
    selectSession,
    seedIntoNewSession,
    setPane(next: 'chat' | 'list'): void {
      pane.value = next
    },
  }
}
