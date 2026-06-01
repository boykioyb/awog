import {
  BookOpen,
  Database,
  Eraser,
  ExternalLink,
  FileText,
  GitBranch,
  HelpCircle,
  type LucideIcon,
  Save,
  Search,
} from 'lucide-vue-next'

export interface CommandDef {
  id: string
  name: string
  icon: LucideIcon
  description: string
}

export const COMMANDS: CommandDef[] = [
  {
    id: 'clear',
    name: 'clear',
    icon: Eraser,
    description: 'Xóa toàn bộ message trong session hiện tại',
  },
  {
    id: 'compact',
    name: 'compact',
    icon: BookOpen,
    description: 'Tóm tắt + giảm context cho session dài',
  },
  {
    id: 'model',
    name: 'model',
    icon: Database,
    description: 'Đổi model nhanh không qua chip picker',
  },
  { id: 'save', name: 'save', icon: Save, description: 'Lưu snapshot session ra file markdown' },
  { id: 'help', name: 'help', icon: HelpCircle, description: 'Hiển thị danh sách lệnh' },
  {
    id: 'export',
    name: 'export',
    icon: ExternalLink,
    description: 'Export session sang Markdown / JSON',
  },
  { id: 'branch', name: 'branch', icon: GitBranch, description: 'Fork session từ điểm hiện tại' },
  { id: 'search', name: 'search', icon: Search, description: 'Tìm trong lịch sử session' },
  { id: 'find', name: 'find', icon: FileText, description: 'Tìm file trong project' },
]

export const findCommand = (id: string) => COMMANDS.find((c) => c.id === id)
