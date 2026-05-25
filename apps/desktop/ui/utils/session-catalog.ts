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

export interface FileEntry {
  id: string
  path: string
  name: string
  language?: string
}

export interface CommandDef {
  id: string
  name: string
  icon: LucideIcon
  description: string
}

export const PROJECT_FILES: FileEntry[] = [
  {
    id: 'f1',
    path: 'src/loyalty/balance_service.py',
    name: 'balance_service.py',
    language: 'python',
  },
  { id: 'f2', path: 'src/loyalty/api.py', name: 'api.py', language: 'python' },
  {
    id: 'f3',
    path: 'src/loyalty/loyalty_balance_cache.py',
    name: 'loyalty_balance_cache.py',
    language: 'python',
  },
  { id: 'f4', path: 'src/infra/redis_client.py', name: 'redis_client.py', language: 'python' },
  { id: 'f5', path: 'src/infra/cache_helpers.py', name: 'cache_helpers.py', language: 'python' },
  { id: 'f6', path: 'jobs/report.py', name: 'report.py', language: 'python' },
  {
    id: 'f7',
    path: 'tests/loyalty/test_balance_service.py',
    name: 'test_balance_service.py',
    language: 'python',
  },
  {
    id: 'f8',
    path: 'docs/architecture/system-overview.md',
    name: 'system-overview.md',
    language: 'markdown',
  },
  {
    id: 'f9',
    path: 'docs/architecture/data-model.md',
    name: 'data-model.md',
    language: 'markdown',
  },
  { id: 'f10', path: 'package.json', name: 'package.json', language: 'json' },
  { id: 'f11', path: 'README.md', name: 'README.md', language: 'markdown' },
]

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

export const findFile = (id: string) => PROJECT_FILES.find((f) => f.id === id || f.path === id)

export const findCommand = (id: string) => COMMANDS.find((c) => c.id === id)
