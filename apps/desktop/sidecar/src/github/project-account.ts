// Tài khoản gh HIỆU DỤNG của một project, resolve phía sidecar — cùng luật với renderer
// (ui-next/utils/project-gh-account.ts): Project.githubAccount thắng; vắng (undefined)
// = kế thừa `githubAccount` trong ~/.awog/settings.json của app; '' ở bất kỳ tầng nào
// = "theo tài khoản active của gh" ⇒ trả undefined.
//
// Dùng cho shell của agent (runtime/tools/gh-shim.ts): giá trị tự đọc từ đĩa mỗi lượt,
// KHÔNG nhận từ payload UI — một renderer cũ không được đổi danh tính lệnh chạy bằng.
import { loadProject } from '../projects/store.js'
import { loadSettings } from '../settings/store.js'
import { log } from '../util/logger.js'

export async function resolveProjectGhAccount(projectId: string | null | undefined): Promise<string | undefined> {
  try {
    const project = projectId ? await loadProject(projectId) : null
    let chosen = project?.githubAccount
    if (chosen === undefined) {
      const app = (await loadSettings()).githubAccount
      chosen = typeof app === 'string' ? app : ''
    }
    return chosen.trim() || undefined
  } catch (err) {
    // Không đọc được cấu hình ⇒ rơi về tài khoản active (hành vi cũ), không chặn lượt.
    log.warn('gh account: resolve failed', {
      projectId,
      err: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}
