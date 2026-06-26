import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

// Compact shell: below this viewport width the nav rail + the per-page secondary
// `.list` column become off-canvas drawers (toggled from AppTopBar) so the main
// content (chat / detail) gets the full width. App-wide; see app-shell.css for the
// drawer styling keyed off `.app.compact{,.nav-open,.list-open}`.
const COMPACT_BREAKPOINT = 1100

// Routes whose page renders a secondary master `.list` column (SessionList,
// ProjectList, workflows, and every LibraryView-based page). On these, compact
// mode exposes the "list" drawer toggle; elsewhere it is hidden.
const LIST_ROUTES = [
  '/sessions',
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

// Module-scoped singletons: NavRail, AppTopBar and the layout scrim all share ONE
// state. The composable is a thin accessor — no per-call side effects.
const compact = ref(false)
const navOpen = ref(false)
const listOpen = ref(false)
let bound = false

function closeDrawers() {
  navOpen.value = false
  listOpen.value = false
}

function toggleNav() {
  navOpen.value = !navOpen.value
  if (navOpen.value) listOpen.value = false
}

function toggleList() {
  listOpen.value = !listOpen.value
  if (listOpen.value) navOpen.value = false
}

// Bind the viewport listener once (called from the layout's onMounted). Leaving
// compact resets any open drawer so they never linger when the window grows back.
function initResponsiveShell() {
  if (bound || !import.meta.client) return
  bound = true
  const apply = () => {
    compact.value = window.innerWidth <= COMPACT_BREAKPOINT
    if (!compact.value) closeDrawers()
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
    toggleNav,
    toggleList,
    closeDrawers,
    initResponsiveShell,
  }
}
