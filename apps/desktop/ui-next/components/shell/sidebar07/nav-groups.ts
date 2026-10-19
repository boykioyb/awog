// Danh mục điều hướng của shell — MỘT nguồn cho cả sidebar (NavMain) lẫn breadcrumb
// ở header (AppTopBar). `label` / `title` là i18n key (resolve qua t()).
//
// Grouping mirrors awog-prototype.html. Tasks, Workflows, Commands, Rules, Hooks và
// Templates cố ý KHÔNG có mục trên sidebar (yêu cầu người dùng) — trang vẫn tồn tại,
// chỉ mất lối vào từ menu; tiêu đề của chúng nằm ở ROUTE_TITLE_KEYS bên dưới.

export type NavItemDef = {
  to: string
  icon: string
  label: string
  // Mục mở modal toàn cục thay vì đổi trang (`to` khi đó chỉ làm key).
  modal?: 'slack'
  // Huy hiệu sống: số phiên cần người dùng để ý (chưa đọc / đang chờ trả lời).
  badge?: 'sessionsAttention'
  // Chấm chỉ báo tĩnh (port nguyên từ prototype).
  dot?: boolean
  // Neo `data-tour` cho tour giới thiệu (useTour.ts).
  tour?: string
}

export type NavGroupDef = { title?: string; items: readonly NavItemDef[] }

export const NAV_GROUPS: readonly NavGroupDef[] = [
  { items: [{ to: '/', icon: 'home', label: 'nav.home' }] },
  {
    title: 'nav.group.work',
    items: [
      {
        to: '/workbench',
        icon: 'sessions',
        label: 'nav.sessions',
        badge: 'sessionsAttention',
        tour: 'nav-sessions',
      },
      { to: '/board', icon: 'board', label: 'nav.board' },
      { to: '/teams', icon: 'agents', label: 'nav.teams' },
      { to: '/agents', icon: 'brain', label: 'nav.agents' },
      { to: '/schedules', icon: 'clock', label: 'nav.schedules' },
      { to: '/logtime', icon: 'table', label: 'nav.logtime' },
      { to: '/slack', icon: 'message', label: 'nav.slack', modal: 'slack' },
    ],
  },
  {
    title: 'nav.group.library',
    items: [
      { to: '/skills', icon: 'skills', label: 'nav.skills' },
      { to: '/wiki', icon: 'book', label: 'nav.wiki' },
    ],
  },
  {
    title: 'nav.group.system',
    items: [
      { to: '/projects', icon: 'projects', label: 'nav.projects' },
      { to: '/git', icon: 'git', label: 'nav.git', dot: true },
      { to: '/connections', icon: 'conn', label: 'nav.connections' },
      { to: '/ssh', icon: 'ssh', label: 'nav.ssh' },
      { to: '/infra', icon: 'layers', label: 'nav.infra' },
      { to: '/monitor', icon: 'cpu', label: 'nav.monitor' },
    ],
  },
]

// Tiêu đề của các trang KHÔNG có mục trên sidebar (dùng lại key nav.*).
const ROUTE_TITLE_KEYS: Record<string, string> = {
  '/tasks': 'nav.tasks',
  '/workflows': 'nav.workflows',
  '/commands': 'nav.commands',
  '/rules': 'nav.rules',
  '/templates': 'nav.templates',
  '/hooks': 'nav.hooks',
  '/playbooks': 'nav.playbooks',
  '/settings': 'nav.settings',
}

/** `/` chỉ khớp đúng trang chủ; route khác khớp cả trang con (`/projects/…`). */
export function routeMatches(to: string, path: string): boolean {
  return to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`)
}

export type RouteCrumb = { groupKey?: string; titleKey?: string }

/** Breadcrumb của route hiện tại: nhóm sidebar (nếu có) → tên trang. */
export function routeCrumb(path: string): RouteCrumb {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((i) => !i.modal && routeMatches(i.to, path))
    if (item) return { groupKey: group.title, titleKey: item.label }
  }
  const key = Object.keys(ROUTE_TITLE_KEYS).find((k) => routeMatches(k, path))
  return { titleKey: key ? ROUTE_TITLE_KEYS[key] : undefined }
}
