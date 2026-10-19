import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

// Shell responsive. Sidebar điều hướng là `Sidebar` stock của shadcn (layout default,
// mẫu sidebar-07): thu về dạng icon thay vì thành drawer, nên ở chế độ hẹp chỉ còn
// cột `.list` phụ của từng trang biến thành drawer off-canvas (bật từ AppTopBar) để
// nội dung chính (chat / detail) lấy trọn bề ngang. Style drawer nằm ở app-shell.css,
// bám vào `.app.compact{,.list-open}` mà layout gắn lên SidebarProvider.
const COMPACT_BREAKPOINT = 1100

// Routes whose page renders a secondary master `.list` column (SessionList,
// ProjectList, workflows, and every LibraryView-based page). On these, compact
// mode exposes the "list" drawer toggle; elsewhere it is hidden.
const LIST_ROUTES = [
  '/workbench',
  '/projects',
  '/workflows',
  '/agents',
  '/skills',
  '/commands',
  '/rules',
  '/templates',
  '/tasks',
  '/connections',
  '/hooks',
] as const

// Module-scoped singletons: layout, AppTopBar và TourHost dùng chung MỘT state.
// Composable chỉ là accessor mỏng — không có side effect theo từng lần gọi.
const compact = ref(false)
const listOpen = ref(false)
let bound = false

// Sidebar mở rộng (có nhãn) hay thu về icon — state cấp app, layout nối vào
// `SidebarProvider :open`. Lưu ở 'awog-nav-expanded': '1' = mở rộng, MỌI giá trị
// khác (kể cả chưa có) = icon. Key này thay cho 'awog-nav-collapsed' cũ một cách
// có chủ ý — không đọc key cũ, nên mọi người dùng về rail icon một lần.
// (Không dùng cookie `sidebar_state` của SidebarProvider stock: giữ nguyên lựa
// chọn người dùng đã lưu trước đợt chuyển.)
const NAV_EXPANDED_KEY = 'awog-nav-expanded'
const navOpen = ref(false)
if (import.meta.client) navOpen.value = localStorage.getItem(NAV_EXPANDED_KEY) === '1'

function setNavOpen(open: boolean) {
  navOpen.value = open
  if (import.meta.client) localStorage.setItem(NAV_EXPANDED_KEY, open ? '1' : '0')
}

function toggleNav() {
  setNavOpen(!navOpen.value)
}

function closeList() {
  listOpen.value = false
}

function toggleList() {
  listOpen.value = !listOpen.value
}

// Bind the viewport listener once (called from the layout's onMounted). Leaving
// compact resets the list drawer so it never lingers when the window grows back.
function initResponsiveShell() {
  if (bound || !import.meta.client) return
  bound = true
  const apply = () => {
    compact.value = window.innerWidth <= COMPACT_BREAKPOINT
    if (!compact.value) closeList()
  }
  apply()
  window.addEventListener('resize', apply)
}

export function useResponsiveShell() {
  const route = useRoute()
  const hasList = computed(() =>
    LIST_ROUTES.some((r) => route.path === r || route.path.startsWith(`${r}/`)),
  )
  return {
    compact,
    navOpen,
    listOpen,
    hasList,
    setNavOpen,
    toggleNav,
    toggleList,
    closeList,
    initResponsiveShell,
  }
}
