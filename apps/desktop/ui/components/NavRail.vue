<template>
  <!-- Spacer keeps flex layout stable when rail becomes overlay on mobile -->
  <div v-if="isMobile" class="w-12 flex-shrink-0 md:hidden" aria-hidden="true" />

  <!-- Backdrop on mobile drawer -->
  <Teleport to="body">
    <div
      v-if="isMobile && mobileOpen"
      class="fixed inset-0 z-40 md:hidden"
      style="background: rgba(0, 0, 0, 0.4)"
      @click="mobileOpen = false"
    />
  </Teleport>

  <nav
    class="flex flex-col transition-all duration-150"
    :class="
      isMobile
        ? mobileOpen
          ? 'fixed left-0 top-0 bottom-0 z-50'
          : 'fixed left-0 top-0 bottom-0 z-30'
        : 'h-full flex-shrink-0'
    "
    :style="{
      width: railWidth,
      background: t.bgRail,
      borderRight: `1px solid ${t.border}`,
    }"
  >
    <!-- Logo / brand -->
    <div
      class="h-11 flex items-center px-3 flex-shrink-0 gap-2"
      :style="{ borderBottom: `1px solid ${t.border}` }"
    >
      <div
        class="w-6 h-6 rounded flex items-center justify-center text-xs font-bold flex-shrink-0"
        :style="{ background: t.accent, color: t.accentText }"
      >
        A
      </div>
      <span
        v-if="showLabels"
        class="text-sm font-semibold tracking-tight"
        :style="{ color: t.text }"
      >
        AWOG
      </span>
    </div>

    <!-- Main nav items -->
    <div class="flex-1 flex flex-col py-2 gap-0.5 px-1.5 overflow-y-auto">
      <NuxtLink
        v-for="item in items"
        :key="item.id"
        :to="item.to"
        :title="!showLabels ? item.label : ''"
        class="relative flex items-center gap-2.5 px-2 h-8 rounded text-xs transition-colors group"
        :style="navItemStyle(item)"
        @click="onItemClick"
      >
        <component :is="item.icon" :size="15" class="flex-shrink-0" />
        <span v-if="showLabels" class="truncate">{{ item.label }}</span>
        <span
          v-if="item.id === 'git' && gitDirty"
          class="absolute top-1 left-6 w-1.5 h-1.5 rounded-full"
          :style="{ background: gitStore.hasConflict ? t.gitConflict : t.warning }"
        />
      </NuxtLink>
    </div>

    <!-- Bottom: settings + theme toggle + collapse -->
    <div class="flex flex-col gap-0.5 p-1.5" :style="{ borderTop: `1px solid ${t.border}` }">
      <NuxtLink
        to="/settings"
        :title="!showLabels ? 'Settings' : ''"
        class="flex items-center gap-2.5 px-2 h-8 rounded text-xs transition-colors"
        :style="navItemStyle({ to: '/settings' })"
        @click="onItemClick"
      >
        <Settings :size="15" class="flex-shrink-0" />
        <span v-if="showLabels" class="truncate">Settings</span>
      </NuxtLink>

      <button
        :title="!showLabels ? (themeName === 'dark' ? 'Switch to light' : 'Switch to dark') : ''"
        class="flex items-center gap-2.5 px-2 h-8 rounded text-xs transition-colors"
        :style="{ color: t.textMuted }"
        @click="toggle"
        @mouseenter="hoverTheme = true"
        @mouseleave="hoverTheme = false"
      >
        <component
          :is="themeName === 'dark' ? Sun : Moon"
          :size="15"
          class="flex-shrink-0"
          :style="{ color: hoverTheme ? t.text : t.textMuted }"
        />
        <span v-if="showLabels" class="truncate">
          {{ themeName === 'dark' ? 'Light mode' : 'Dark mode' }}
        </span>
      </button>

      <button
        :title="!showLabels ? (isMobile ? 'Open menu' : 'Expand') : isMobile ? 'Close' : 'Collapse'"
        class="flex items-center gap-2.5 px-2 h-8 rounded text-xs transition-colors"
        :style="{ color: t.textMuted }"
        @click="onToggle"
      >
        <component
          :is="showLabels ? PanelLeftClose : PanelLeftOpen"
          :size="15"
          class="flex-shrink-0"
        />
        <span v-if="showLabels" class="truncate">{{ isMobile ? 'Close menu' : 'Collapse' }}</span>
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import {
  ListTodo,
  MessageSquare,
  FolderGit2,
  Workflow,
  Users,
  Wand2,
  Settings,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Zap,
  Slash,
  GitBranch,
} from 'lucide-vue-next'

const { t, themeName, toggle } = useTheme()
const route = useRoute()
const gitStore = useGitStore()
const gitDirty = computed(() => gitStore.hasUncommitted)

const expanded = useState<boolean>('navRailExpanded', () => true)
const mobileOpen = ref(false)
const hoverTheme = ref(false)
const isMobile = useIsMobile()

const showLabels = computed(() => (isMobile.value ? mobileOpen.value : expanded.value))

const railWidth = computed(() => {
  if (isMobile.value) return mobileOpen.value ? '208px' : '48px'
  return expanded.value ? '192px' : '48px'
})

const onToggle = () => {
  if (isMobile.value) mobileOpen.value = !mobileOpen.value
  else expanded.value = !expanded.value
}

const onItemClick = () => {
  if (isMobile.value) mobileOpen.value = false
}

watch(
  () => route.path,
  () => {
    if (isMobile.value) mobileOpen.value = false
  },
)

interface NavItem {
  id: string
  label?: string
  icon?: unknown
  to: string
}

const items: NavItem[] = [
  { id: 'tasks', label: 'Tasks', icon: ListTodo, to: '/tasks' },
  { id: 'sessions', label: 'Sessions', icon: MessageSquare, to: '/sessions' },
  { id: 'projects', label: 'Projects', icon: FolderGit2, to: '/projects' },
  { id: 'workflows', label: 'Workflows', icon: Workflow, to: '/workflows' },
  { id: 'agents', label: 'Agents', icon: Users, to: '/agents' },
  { id: 'skills', label: 'Skills', icon: Wand2, to: '/skills' },
  { id: 'git', label: 'Git', icon: GitBranch, to: '/git' },
  { id: 'mcp-servers', label: 'MCP Servers', icon: Plug, to: '/mcp-servers' },
  { id: 'hooks', label: 'Hooks', icon: Zap, to: '/hooks' },
  { id: 'commands', label: 'Commands', icon: Slash, to: '/commands' },
]

const isActive = (to: string) => {
  if (to === '/tasks') return route.path === '/' || route.path.startsWith('/tasks')
  return route.path.startsWith(to)
}

const navItemStyle = (item: { to: string }) => {
  const active = isActive(item.to)
  return {
    background: active ? t.value.bgActive : 'transparent',
    color: active ? t.value.text : t.value.textMuted,
  }
}
</script>
