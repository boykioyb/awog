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
      :style="{ borderBottom: `1px solid ${t.border}`, color: t.text }"
    >
      <div
        class="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
        :style="{ border: `1px solid ${t.border}`, background: t.bgElevated }"
      >
        <svg viewBox="0 0 32 32" width="20" height="20" role="img" aria-label="AWOG">
          <rect x="4" y="13" width="18" height="14" rx="2.5" fill="currentColor" opacity="0.4" />
          <rect x="7" y="9" width="18" height="14" rx="2.5" fill="currentColor" opacity="0.7" />
          <rect x="10" y="5" width="18" height="14" rx="2.5" fill="currentColor" />
          <rect x="13" y="9.4" width="10" height="1.4" rx="0.7" fill="#60a5fa" />
          <rect x="13" y="12.4" width="7" height="1.4" rx="0.7" fill="#60a5fa" opacity="0.65" />
          <circle cx="25.5" cy="7.5" r="1.6" fill="#fbbf24" />
        </svg>
      </div>
      <span
        v-if="showLabels"
        class="text-[1em] font-semibold tracking-tight"
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
        class="relative flex items-center gap-2.5 px-2 h-8 rounded text-[1em] transition-colors group"
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
        <span
          v-if="item.id === 'git' && showLabels && (gitAhead > 0 || gitBehind > 0)"
          class="ml-auto inline-flex items-center gap-1 font-mono text-[1em] px-1 py-0.5 rounded"
          :style="{
            background: t.bgInput,
            color: t.accent,
            border: `1px solid ${t.border}`,
          }"
          :title="`${gitAhead} ahead · ${gitBehind} behind`"
        >
          <span v-if="gitAhead > 0">↑{{ gitAhead }}</span>
          <span v-if="gitBehind > 0">↓{{ gitBehind }}</span>
        </span>
      </NuxtLink>
    </div>

    <!-- Bottom: what's new + settings + theme toggle + collapse -->
    <div class="flex flex-col gap-0.5 p-1.5" :style="{ borderTop: `1px solid ${t.border}` }">
      <button
        :title="!showLabels ? tr('whatsnew.label') : ''"
        class="relative flex items-center gap-2.5 px-2 h-8 rounded text-[1em] transition-colors"
        :style="{ color: t.textMuted }"
        @click="onWhatsNew"
      >
        <Sparkles :size="15" class="flex-shrink-0" />
        <span v-if="showLabels" class="truncate">{{ tr('whatsnew.label') }}</span>
        <span
          v-if="hasUnseen"
          class="absolute top-1 left-6 w-1.5 h-1.5 rounded-full"
          :style="{ background: t.accent }"
        />
      </button>

      <NuxtLink
        to="/settings"
        :title="!showLabels ? 'Settings' : ''"
        class="flex items-center gap-2.5 px-2 h-8 rounded text-[1em] transition-colors"
        :style="navItemStyle({ to: '/settings' })"
        @click="onItemClick"
      >
        <Settings :size="15" class="flex-shrink-0" />
        <span v-if="showLabels" class="truncate">Settings</span>
      </NuxtLink>

      <button
        :title="!showLabels ? (themeName === 'dark' ? 'Switch to light' : 'Switch to dark') : ''"
        class="flex items-center gap-2.5 px-2 h-8 rounded text-[1em] transition-colors"
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
        class="flex items-center gap-2.5 px-2 h-8 rounded text-[1em] transition-colors"
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

  <WhatsNewModal :open="whatsNewOpen" :releases="releases" @close="closePanel" />
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
  Sparkles,
} from 'lucide-vue-next'

const { t, themeName, toggle } = useTheme()
const { t: tr } = useI18n()
const { open: whatsNewOpen, hasUnseen, releases, openPanel, closePanel } = useWhatsNew()
const route = useRoute()
const gitStore = useGitStore()
const gitDirty = computed(() => gitStore.hasUncommitted)
const gitAhead = computed(() => gitStore.ahead)
const gitBehind = computed(() => gitStore.behind)

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

const onWhatsNew = () => {
  openPanel()
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
  { id: 'connections', label: 'Connections', icon: Plug, to: '/connections' },
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
