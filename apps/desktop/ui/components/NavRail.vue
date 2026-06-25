<template>
  <aside
    class="flex flex-col flex-shrink-0 h-full rounded-xl overflow-hidden transition-[width] duration-200"
    :style="{
      width: collapsed ? '56px' : '232px',
      background: parts.bg,
      border: `1px solid ${parts.border}`,
      boxShadow: parts.sheen
        ? `${parts.sheen}, 0 6px 18px -10px ${parts.shadow}`
        : `0 6px 18px -10px ${parts.shadow}`,
      color: t.text,
    }"
  >
    <!-- Brand -->
    <div class="flex items-center gap-2.5 px-3 h-14 flex-shrink-0">
      <div
        class="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0"
        :style="{
          background: on ? t.glassActive : t.bgElevated,
          border: `1px solid ${on ? t.glassBorder : t.border}`,
          boxShadow: on ? `inset 0 1px 0 ${t.glassHighlight}` : 'none',
          color: t.text,
        }"
      >
        <svg viewBox="0 0 32 32" width="19" height="19" role="img" aria-label="AWOG">
          <rect x="4" y="13" width="18" height="14" rx="2.5" fill="currentColor" opacity="0.4" />
          <rect x="7" y="9" width="18" height="14" rx="2.5" fill="currentColor" opacity="0.7" />
          <rect x="10" y="5" width="18" height="14" rx="2.5" fill="currentColor" />
          <rect x="13" y="9.4" width="10" height="1.4" rx="0.7" fill="#60a5fa" />
          <rect x="13" y="12.4" width="7" height="1.4" rx="0.7" fill="#60a5fa" opacity="0.65" />
          <circle cx="25.5" cy="7.5" r="1.6" fill="#fbbf24" />
        </svg>
      </div>
      <span
        v-if="!collapsed"
        class="text-[1em] font-semibold tracking-tight whitespace-nowrap"
        :style="{ color: t.text }"
      >
        {{ tr('nav.brand') }}
      </span>
    </div>

    <!-- Scrollable nav body -->
    <nav class="flex-1 overflow-y-auto overflow-x-hidden px-2 py-1" @mouseleave="hoveredId = null">
      <!-- Home (ungrouped) -->
      <NuxtLink
        :to="homeItem.to"
        :title="collapsed ? tr(homeItem.labelKey) : undefined"
        class="relative flex items-center gap-2.5 h-9 px-2.5 rounded-lg transition-all duration-150"
        :class="collapsed ? 'justify-center' : ''"
        :style="itemStyle(isActive(homeItem.to), hoveredId === homeItem.id)"
        @mouseenter="hoveredId = homeItem.id"
      >
        <span
          v-if="isActive(homeItem.to)"
          class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full"
          :style="{ background: t.accent }"
        />
        <component :is="homeItem.icon" :size="17" class="flex-shrink-0" />
        <span v-if="!collapsed" class="text-[1em] truncate flex-1">
          {{ tr(homeItem.labelKey) }}
        </span>
      </NuxtLink>

      <!-- Groups -->
      <div v-for="group in groups" :key="group.id" class="mt-2">
        <p
          v-if="!collapsed"
          class="px-2 pt-2 pb-1 text-[12px] font-semibold uppercase tracking-wider leading-none select-none"
          :style="{ color: t.textFaint }"
        >
          {{ tr(group.labelKey) }}
        </p>
        <div v-else class="my-1.5 mx-3 h-px" :style="{ background: t.border }" />

        <NuxtLink
          v-for="item in group.items"
          :key="item.id"
          :to="item.to"
          :title="collapsed ? tr(item.labelKey) : undefined"
          class="relative flex items-center gap-2.5 h-9 px-2.5 rounded-lg transition-all duration-150"
          :class="collapsed ? 'justify-center' : ''"
          :style="itemStyle(isActive(item.to), hoveredId === item.id)"
          @mouseenter="hoveredId = item.id"
        >
          <span
            v-if="isActive(item.to)"
            class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full"
            :style="{ background: t.accent }"
          />
          <component :is="item.icon" :size="17" class="flex-shrink-0" />
          <span v-if="!collapsed" class="text-[1em] truncate flex-1">{{ tr(item.labelKey) }}</span>

          <!-- Tasks: running count -->
          <span
            v-if="item.id === 'tasks' && runningCount > 0 && !collapsed"
            class="inline-flex items-center justify-center font-mono text-[12px] leading-none px-1.5 py-0.5 rounded-full"
            :style="badgeStyle"
            :title="`${runningCount} running`"
          >
            {{ runningCount }}
          </span>
          <span
            v-else-if="item.id === 'tasks' && runningCount > 0 && collapsed"
            class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
            :style="{ background: t.accent }"
            :title="`${runningCount} running`"
          />

          <!-- Sessions: unread count / awaiting pulse / streaming pulse -->
          <template v-else-if="item.id === 'sessions'">
            <span
              v-if="unreadCount > 0 && !collapsed"
              class="inline-flex items-center justify-center font-mono text-[12px] leading-none px-1.5 py-0.5 rounded-full"
              :style="badgeStyle"
              :title="`${unreadCount} unread`"
            >
              {{ unreadCount }}
            </span>
            <span
              v-else-if="unreadCount > 0 && collapsed"
              class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
              :style="{ background: t.accent }"
              :title="`${unreadCount} unread`"
            />
            <span
              v-else-if="anyAwaitingInput"
              class="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
              :class="collapsed ? 'absolute top-1.5 right-1.5' : ''"
              :style="{ background: t.warning, boxShadow: `0 0 6px ${t.warning}` }"
              :title="tr('session.tab.awaiting')"
            />
            <span
              v-else-if="anyStreaming"
              class="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
              :class="collapsed ? 'absolute top-1.5 right-1.5' : ''"
              :style="{ background: t.accent, boxShadow: `0 0 6px ${t.accent}` }"
              title="Streaming"
            />
          </template>

          <!-- Git: dirty/conflict dot + ahead/behind chip -->
          <template v-else-if="item.id === 'git'">
            <span
              v-if="gitDirty"
              class="w-1.5 h-1.5 rounded-full flex-shrink-0"
              :class="collapsed ? 'absolute top-1.5 right-1.5' : ''"
              :style="{ background: gitStore.hasConflict ? t.gitConflict : t.warning }"
              :title="gitStore.hasConflict ? 'Conflicts' : 'Uncommitted changes'"
            />
            <span
              v-if="!collapsed && (gitAhead > 0 || gitBehind > 0)"
              class="inline-flex items-center gap-1 font-mono text-[12px] leading-none px-1.5 py-0.5 rounded-full"
              :style="badgeStyle"
              :title="`${gitAhead} ahead · ${gitBehind} behind`"
            >
              <span v-if="gitAhead > 0">↑{{ gitAhead }}</span>
              <span v-if="gitBehind > 0">↓{{ gitBehind }}</span>
            </span>
          </template>
        </NuxtLink>
      </div>
    </nav>

    <!-- Footer -->
    <div
      class="flex-shrink-0 px-2 py-2 flex flex-col gap-1"
      :style="{ borderTop: `1px solid ${parts.border}` }"
      @mouseleave="hoveredId = null"
    >
      <!-- Settings -->
      <button
        type="button"
        :title="collapsed ? tr('settings.title') : undefined"
        class="flex items-center gap-2.5 w-full h-9 px-2.5 rounded-lg transition-all duration-150"
        :class="collapsed ? 'justify-center' : ''"
        :style="itemStyle(settingsActive, hoveredId === 'settings')"
        @mouseenter="hoveredId = 'settings'"
        @click="openSettings()"
      >
        <Settings :size="17" class="flex-shrink-0" />
        <span v-if="!collapsed" class="text-[1em] truncate">{{ tr('settings.title') }}</span>
      </button>

      <!-- User chip -->
      <div
        class="flex items-center gap-2.5 w-full h-10 px-2 rounded-lg"
        :class="collapsed ? 'justify-center' : ''"
        :title="collapsed ? `${userName} · ${userDomain}` : undefined"
      >
        <div
          class="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 text-[12px] font-semibold uppercase"
          :style="{ background: t.bgActive, color: t.textMuted, border: `1px solid ${t.border}` }"
        >
          {{ userInitial }}
        </div>
        <div v-if="!collapsed" class="min-w-0 leading-tight">
          <p class="text-[1em] truncate" :style="{ color: t.text }">{{ userName }}</p>
          <p class="text-[12px] leading-none truncate" :style="{ color: t.textFaint }">
            {{ userDomain }}
          </p>
        </div>
      </div>

      <!-- Collapse toggle -->
      <button
        type="button"
        :title="collapsed ? tr('nav.expand') : tr('nav.collapse')"
        class="flex items-center gap-2.5 w-full h-9 px-2.5 rounded-lg transition-all duration-150"
        :class="collapsed ? 'justify-center' : ''"
        :style="itemStyle(false, hoveredId === 'collapse')"
        @mouseenter="hoveredId = 'collapse'"
        @click="toggleCollapsed"
      >
        <component
          :is="collapsed ? PanelLeftOpen : PanelLeftClose"
          :size="17"
          class="flex-shrink-0"
        />
        <span v-if="!collapsed" class="text-[1em] truncate">{{ tr('nav.collapse') }}</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import {
  LayoutDashboard,
  MessageSquare,
  ListTodo,
  Workflow,
  Users,
  Wand2,
  Slash,
  ScrollText,
  Package,
  FolderGit2,
  GitBranch,
  Plug,
  Zap,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-vue-next'
import type { Component } from 'vue'

// Nav model is local to the rail (KISS — no shared shape needed elsewhere).
type NavItem = {
  id: string
  labelKey: string
  icon: Component
  to: string
}
type NavGroup = {
  id: string
  labelKey: string
  items: NavItem[]
}

const { t } = useTheme()
const { on, parts, pill } = useGlass()
const { t: tr } = useI18n()
const { open: settingsActive, openSettings } = useSettingsModal()
const route = useRoute()

const gitStore = useGitStore()
const gitDirty = computed(() => gitStore.hasUncommitted)
const gitAhead = computed(() => gitStore.ahead)
const gitBehind = computed(() => gitStore.behind)

const tasksStore = useTasksStore()
const runningCount = computed(() => tasksStore.runningCount)

const sessionsStore = useSessionsStore()
const anyStreaming = computed(() => sessionsStore.anyStreaming)
const anyAwaitingInput = computed(() => sessionsStore.anyAwaitingInput)
const unreadCount = computed(() => sessionsStore.unreadCount)

const settingsStore = useSettingsStore()
// User chip — derive a display name from the workspace path leaf, with a
// spacelinks placeholder fallback (no identity/account model exists yet).
const userName = computed(() => {
  const leaf = settingsStore.workspacePath?.split('/').filter(Boolean).pop()
  return leaf && leaf !== 'home' ? leaf : 'hoatq'
})
const userDomain = 'spacelinks.vn'
const userInitial = computed(() => userName.value.charAt(0).toUpperCase() || 'A')

const hoveredId = ref<string | null>(null)

// Collapse state persists across reloads (icon-only rail is a deliberate pick).
const COLLAPSE_KEY = 'awog.navrail.collapsed'
const loadCollapsed = (): boolean => {
  if (!import.meta.client) return false
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}
const collapsed = ref(loadCollapsed())
const toggleCollapsed = () => {
  collapsed.value = !collapsed.value
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0')
  } catch {
    // Storage full or disabled — non-fatal, the value still applies this session.
  }
}

const homeItem: NavItem = { id: 'home', labelKey: 'nav.home', icon: LayoutDashboard, to: '/' }

const groups: NavGroup[] = [
  {
    id: 'work',
    labelKey: 'nav.group.work',
    items: [
      { id: 'sessions', labelKey: 'nav.sessions', icon: MessageSquare, to: '/sessions' },
      { id: 'tasks', labelKey: 'nav.tasks', icon: ListTodo, to: '/tasks' },
      { id: 'workflows', labelKey: 'nav.workflows', icon: Workflow, to: '/workflows' },
    ],
  },
  {
    id: 'library',
    labelKey: 'nav.group.library',
    items: [
      { id: 'agents', labelKey: 'nav.agents', icon: Users, to: '/agents' },
      { id: 'skills', labelKey: 'nav.skills', icon: Wand2, to: '/skills' },
      { id: 'commands', labelKey: 'nav.commands', icon: Slash, to: '/commands' },
      { id: 'rules', labelKey: 'nav.rules', icon: ScrollText, to: '/rules' },
      { id: 'templates', labelKey: 'nav.templates', icon: Package, to: '/templates' },
    ],
  },
  {
    id: 'system',
    labelKey: 'nav.group.system',
    items: [
      { id: 'projects', labelKey: 'nav.projects', icon: FolderGit2, to: '/projects' },
      { id: 'git', labelKey: 'nav.git', icon: GitBranch, to: '/git' },
      { id: 'connections', labelKey: 'nav.connections', icon: Plug, to: '/connections' },
      { id: 'hooks', labelKey: 'nav.hooks', icon: Zap, to: '/hooks' },
    ],
  },
]

const isActive = (to: string): boolean => {
  if (to === '/') return route.path === '/'
  return route.path.startsWith(to)
}

// Nav-item pill — mirror HeaderTabBar's pillStyle (glass-aware tint + text color).
const itemStyle = (active: boolean, hovered: boolean) => {
  const base = pill(active, hovered)
  return {
    background: base.background,
    border: `1px solid ${base.borderColor}`,
    color: active || hovered ? t.value.text : t.value.textMuted,
  }
}

const badgeStyle = computed(() => ({
  background: on.value ? t.value.glassActive : t.value.bgInput,
  color: t.value.accent,
  border: `1px solid ${on.value ? t.value.glassBorder : t.value.border}`,
  boxShadow: on.value ? `inset 0 1px 0 ${t.value.glassHighlight}` : 'none',
  minWidth: '18px',
}))
</script>
