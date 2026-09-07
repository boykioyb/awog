// Liệt kê MỌI luật quyền đang có, cả ba tầng (ADR 0080 — F10 của lượt infosec).
//
// Trước RPC này, luật đã lưu là thứ chỉ tồn tại trên đĩa: không xem được, không
// gỡ được, và tên file tầng project là băm của đường dẫn nên người dùng cũng
// không tìm ra file mà sửa. Đây là mặt ĐỌC của việc thu hồi quyền.
//
// Trả về cả những entry KHÔNG hợp lệ (`active: false`) và cả những file HỎNG:
// đúng hai thứ đó mới là thứ người dùng cần thấy nhất, vì chúng vô hiệu trong im
// lặng.
import { register } from '../transport/rpc.js'
import { listProjects } from '../projects/store.js'
import { listSessionSummaries } from '../sessions/store.js'
import {
  listRulesInFile,
  listSessionRuleTiers,
  projectRuleFile,
  userRuleFile,
  type PermissionRuleAction,
  type PermissionRuleKind,
  type PermissionRuleScope,
} from '../sessions/permission-rules.js'

interface RuleRow {
  scope: PermissionRuleScope
  // Nguyên văn chuỗi luật — cũng là khoá gửi lại cho `permissions.deleteRule`.
  rule: string
  action: PermissionRuleAction
  active: boolean
  toolName?: string
  kind?: PermissionRuleKind
  createdAt?: string
  // Nơi luật đang nằm. Tầng session không có file.
  file?: string
  projectId?: string
  projectName?: string
  sessionId?: string
  sessionTitle?: string
}

// Một file luật không đọc được. Hiện lên UI thay vì chỉ nằm trong log: file hỏng
// nghĩa là mọi luật DENY trong đó đang KHÔNG có hiệu lực.
interface CorruptFile {
  scope: PermissionRuleScope
  file: string
  reason: string
  projectId?: string
  projectName?: string
}

register('permissions.listRules', async () => {
  const rules: RuleRow[] = []
  const corrupt: CorruptFile[] = []

  const userFile = userRuleFile()
  const userListing = await listRulesInFile(userFile)
  if (userListing.status === 'corrupt') {
    corrupt.push({ scope: 'user', file: userFile, reason: userListing.reason })
  } else if (userListing.status === 'ok') {
    for (const rule of userListing.rules) rules.push({ scope: 'user', file: userFile, ...rule })
  }

  const projects = await listProjects()
  for (const project of projects) {
    const file = projectRuleFile(project.path)
    if (!file) continue
    // eslint-disable-next-line no-await-in-loop
    const listing = await listRulesInFile(file)
    if (listing.status === 'corrupt') {
      corrupt.push({
        scope: 'project',
        file,
        reason: listing.reason,
        projectId: project.id,
        projectName: project.name,
      })
      continue
    }
    if (listing.status !== 'ok') continue
    for (const rule of listing.rules) {
      rules.push({
        scope: 'project',
        file,
        projectId: project.id,
        projectName: project.name,
        ...rule,
      })
    }
  }

  const titles = new Map((await listSessionSummaries()).map((s) => [s.id, s.title]))
  for (const tier of listSessionRuleTiers()) {
    const title = titles.get(tier.sessionId)
    for (const rule of tier.rules) {
      rules.push({
        scope: 'session',
        rule: rule.text,
        action: rule.action,
        active: true,
        toolName: rule.toolName,
        kind: rule.kind,
        sessionId: tier.sessionId,
        ...(title ? { sessionTitle: title } : {}),
      })
    }
  }

  return { rules, corrupt, userFile }
})
