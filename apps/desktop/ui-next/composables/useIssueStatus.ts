import type { BoardItemStatus } from '~/stores/board'

// Nhãn + màu của status issue — một nguồn cho mọi bề mặt (chip issue trên header
// phiên, khung Issues của workbench, trang /board). Màu là token theme, không hex.
const STATUS_COLOR: Record<BoardItemStatus, string> = {
  backlog: 'var(--muted-foreground)',
  todo: 'var(--info)',
  in_progress: 'var(--primary)',
  in_review: 'var(--warning)',
  changes: 'var(--violet)',
  pending: 'var(--muted-foreground)',
  blocked: 'var(--destructive)',
  done: 'var(--success)',
  cancelled: 'var(--muted-foreground)',
}

// Thứ tự người dùng đổi tay từ chip header — việc hay bấm nhất lên đầu.
export const ISSUE_QUICK_STATUSES: readonly BoardItemStatus[] = [
  'in_progress',
  'pending',
  'blocked',
  'in_review',
  'done',
  'todo',
  'cancelled',
]

// Status mà người dùng chuyển vào thì nên recap ngay — lúc gác việc là lúc
// cần ghi lại "đang ở đâu", để quay lại sau nhiều ngày vẫn nối được.
export const RECAP_ON_STATUSES: ReadonlySet<BoardItemStatus> = new Set([
  'pending',
  'blocked',
  'done',
])

const camel = (s: string): string => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

export function useIssueStatus() {
  const { t } = useI18n()
  const statusLabel = (s: BoardItemStatus): string => t(`sessions.workspace.group.st.${camel(s)}`)
  const statusColor = (s: BoardItemStatus): string => STATUS_COLOR[s] ?? 'var(--muted-foreground)'
  return { statusLabel, statusColor }
}
