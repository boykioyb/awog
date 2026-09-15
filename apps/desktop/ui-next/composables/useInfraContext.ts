// Ngữ cảnh hạ tầng của không gian làm việc (ADR 0088 §7) — MỘT ngữ cảnh hiệu lực
// tại một thời điểm, dùng chung cho mọi bề mặt (chip trong phiên, thanh `/infra`,
// env của terminal). Không view nào có picker account riêng: có picker riêng là có
// cách để hai bảng cạnh nhau nói về hai tài khoản khác nhau mà không ai nhận ra.
//
// Ba tầng, giải theo TỪNG TRƯỜNG: phiên → project → toàn app (luật thuần nằm ở
// utils/infra-context.ts). Phiên ĐÓNG BĂNG ý kiến của hai tầng dưới lúc được tạo
// (stores/sessions.ts `frozenInfraFor`), nên đổi mặc định project sau đó không âm
// thầm chuyển tài khoản của một phiên đang chạy dở.
//
// Mọi lần ghi đi qua store/IPC; composable này không chạm filesystem (invariant 4).
import { computed, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { useSessionsStore } from '~/stores/sessions'
import { useProjectsStore } from '~/stores/projects'
import { useSettingsStore } from '~/stores/settings'
import { compactInfraContext, resolveInfraContext } from '~/utils/infra-context'
import type { InfraContext } from '~/types'

/**
 * Phạm vi để giải ngữ cảnh. Bỏ trống = phiên đang mở + project của nó (bề mặt
 * trong phiên). `sessionId: null` = cố ý ĐỨNG NGOÀI phiên (trang `/infra`,
 * Settings) nên tầng phiên bị bỏ qua dù đang có phiên mở ở tab khác.
 */
export type InfraScope = {
  sessionId?: number | null
  projectId?: string | null
}

export function useInfraContext(scope?: MaybeRefOrGetter<InfraScope | undefined>) {
  const sessionsStore = useSessionsStore()
  const projectsStore = useProjectsStore()
  const settingsStore = useSettingsStore()

  const scopeValue = computed<InfraScope>(() => toValue(scope) ?? {})

  const session = computed(() => {
    const { sessionId } = scopeValue.value
    if (sessionId === null) return null
    if (sessionId === undefined) return sessionsStore.active
    return sessionsStore.sessions.find((s) => s.id === sessionId) ?? null
  })

  // Project của phạm vi: khai tường minh thì dùng, không thì theo phiên đang xét.
  const projectId = computed(() => {
    const explicit = scopeValue.value.projectId
    if (explicit !== undefined) return explicit ?? ''
    return session.value?.project ?? ''
  })

  const project = computed(() =>
    projectId.value ? (projectsStore.projectById(projectId.value) ?? null) : null,
  )

  const sessionValue = computed<InfraContext | undefined>(() => session.value?.infra)
  const projectValue = computed<InfraContext | undefined>(() => project.value?.infra)
  const appValue = computed<InfraContext>(() => settingsStore.infra)

  /**
   * Ngữ cảnh thật sự đang có hiệu lực — thứ đi vào argv của lệnh.
   *
   * TRONG PHIÊN (có `session`): CHỈ lấy field phiên tự ghim, KHÔNG kế thừa
   * project/app (2026-09-15). Mỗi tool là một công tắc độc lập bật/tắt ngay trên
   * chip của phiên, mặc định TẮT; và sidecar cũng chỉ đọc `Session.infra`, nên
   * "hiệu lực" mà UI hiện phải khớp đúng thứ đi vào lệnh — hiện một profile app mà
   * lệnh sẽ không dùng là nói dối về tài khoản đang chạy.
   *
   * NGOÀI phiên (`sessionId: null` — trang `/infra`, Settings, env terminal): giữ
   * nguyên kế thừa ba tầng phiên → project → app.
   */
  const effective = computed<InfraContext>(() => {
    if (session.value) return compactInfraContext(sessionValue.value)
    return resolveInfraContext(sessionValue.value, projectValue.value, appValue.value)
  })

  /**
   * Ghim cho PHIÊN đang xét. Trả false khi không có phiên trong phạm vi hoặc khi
   * ghi xuống sidecar hỏng (người gọi nên báo lại, đừng nuốt).
   */
  async function setForSession(next: InfraContext): Promise<boolean> {
    const s = session.value
    if (!s) return false
    return sessionsStore.setInfraContext(s.id, next)
  }

  /** Ghim cho PROJECT đang xét. Phiên đã tạo giữ nguyên bản đóng băng của chúng. */
  async function setForProject(next: InfraContext): Promise<boolean> {
    const p = project.value
    if (!p) return false
    await projectsStore.updateProject({ ...p, infra: compactInfraContext(next) })
    return true
  }

  /** Ghim mặc định TOÀN APP (tầng cuối). Ghi ngay vào settings.json qua store. */
  function setForApp(next: InfraContext): void {
    settingsStore.setInfra(next)
  }

  return {
    effective,
    sessionValue,
    projectValue,
    appValue,
    setForSession,
    setForProject,
    setForApp,
  }
}
