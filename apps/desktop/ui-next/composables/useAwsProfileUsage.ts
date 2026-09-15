// "Đang được dùng ở đâu" (docs/features/aws-profile-manager.md, việc A2) — tách
// khỏi InfraAccounts.vue vì đây là tri thức đọc-store THUẦN (không cần props/emit
// của component), giữ SFC gọn theo luật ~250 dòng của .claude/rules/nuxt-vue.md.
//
// Đếm hai việc, KHÔNG suy diễn gì thêm ngoài đó:
//   - project nào GHIM profile này làm mặc định (`project.infra?.profile`, so
//     trực tiếp — không resolveInfraContext, vì đây là ý kiến RIÊNG của project,
//     không phải giá trị hiệu lực nó đang kế thừa từ toàn app).
//   - phiên đang mở nào có ngữ cảnh HIỆU LỰC trỏ tới nó (session → project → app,
//     cùng luật resolveInfraContext dùng bởi InfraChip/useInfraContext).
import { useProjectsStore } from '~/stores/projects'
import { useSessionsStore } from '~/stores/sessions'
import { useSettingsStore } from '~/stores/settings'
import { resolveInfraContext } from '~/utils/infra-context'

export type AwsProfileUsage = { projectNames: string[]; sessionCount: number }

export function useAwsProfileUsage() {
  const projectsStore = useProjectsStore()
  const sessionsStore = useSessionsStore()
  const settingsStore = useSettingsStore()

  // Best-effort: /infra có thể là trang đầu tiên người dùng mở trong phiên làm
  // việc, hai store này chưa chắc đã hydrate (Sessions/Projects thường tự nạp khi
  // CHÍNH trang của chúng mount). Thiếu thì usageFor() chỉ THIẾU dữ liệu (đếm ra
  // 0) chứ không sai — chấp nhận được cho Mốc 1.
  function ensureHydrated(): void {
    if (projectsStore.available && !projectsStore.loaded) void projectsStore.hydrate()
    void sessionsStore.hydrate() // tự gate nội bộ — no-op nếu đã hydrate/không có bridge
  }

  function usageFor(name: string): AwsProfileUsage {
    const projectNames = projectsStore.projects
      .filter((p) => p.infra?.profile === name)
      .map((p) => p.name)
    const sessionCount = sessionsStore.sessions.filter((s) => {
      const project = s.project ? projectsStore.projectById(s.project) : undefined
      const effective = resolveInfraContext(s.infra, project?.infra, settingsStore.infra)
      return effective.profile === name
    }).length
    return { projectNames, sessionCount }
  }

  return { ensureHydrated, usageFor }
}
