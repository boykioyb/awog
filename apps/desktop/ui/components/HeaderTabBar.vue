<template>
  <header
    class="relative h-12 flex items-center gap-2.5 px-3 flex-shrink-0 backdrop-blur-xl backdrop-saturate-150 z-30"
    :style="{
      background: t.glassBg,
      borderBottom: `1px solid ${t.glassBorder}`,
      boxShadow: `inset 0 1px 0 ${t.glassHighlight}, 0 8px 24px -16px ${t.shadow}`,
      color: t.text,
    }"
  >
    <!-- Brand -->
    <div
      class="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0"
      :style="{
        background: t.glassActive,
        border: `1px solid ${t.glassBorder}`,
        boxShadow: `inset 0 1px 0 ${t.glassHighlight}`,
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

    <!-- Section tabs -->
    <nav
      class="tabstrip flex items-center gap-1.5 flex-1 overflow-x-auto h-full"
      @mouseleave="hoveredId = null"
    >
      <NuxtLink
        v-for="item in items"
        :key="item.id"
        :to="item.to"
        class="relative flex items-center gap-2 px-3 h-8 rounded-xl text-[1em] whitespace-nowrap flex-shrink-0 transition-all duration-150"
        :style="pillStyle(isActive(item.to), hoveredId === item.id)"
        @mouseenter="hoveredId = item.id"
      >
        <component :is="item.icon" :size="15" class="flex-shrink-0" />
        <span>{{ item.label }}</span>

        <!-- Live badges -->
        <span
          v-if="item.id === 'tasks' && runningCount > 0"
          class="inline-flex items-center justify-center font-mono text-[12px] leading-none px-1.5 py-0.5 rounded-full"
          :style="badgeStyle"
          :title="`${runningCount} running`"
        >
          {{ runningCount }}
        </span>
        <span
          v-else-if="item.id === 'sessions' && anyStreaming"
          class="w-1.5 h-1.5 rounded-full animate-pulse"
          :style="{ background: t.accent, boxShadow: `0 0 6px ${t.accent}` }"
          title="Streaming"
        />
        <template v-else-if="item.id === 'git'">
          <span
            v-if="gitDirty"
            class="w-1.5 h-1.5 rounded-full"
            :style="{ background: gitStore.hasConflict ? t.gitConflict : t.warning }"
            :title="gitStore.hasConflict ? 'Conflicts' : 'Uncommitted changes'"
          />
          <span
            v-if="gitAhead > 0 || gitBehind > 0"
            class="inline-flex items-center gap-1 font-mono text-[12px] leading-none px-1.5 py-0.5 rounded-full"
            :style="badgeStyle"
            :title="`${gitAhead} ahead · ${gitBehind} behind`"
          >
            <span v-if="gitAhead > 0">↑{{ gitAhead }}</span>
            <span v-if="gitBehind > 0">↓{{ gitBehind }}</span>
          </span>
        </template>
      </NuxtLink>
    </nav>

    <!-- Divider -->
    <div class="self-stretch my-2.5 w-px flex-shrink-0" :style="{ background: t.glassBorder }" />

    <!-- Utility cluster -->
    <div class="flex items-center gap-1 flex-shrink-0" @mouseleave="hoveredId = null">
      <button
        :title="tr('whatsnew.label')"
        class="relative flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150"
        :style="pillStyle(false, hoveredId === 'whatsnew')"
        @mouseenter="hoveredId = 'whatsnew'"
        @click="openPanel"
      >
        <Sparkles :size="15" />
        <span
          v-if="hasUnseen"
          class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
          :style="{ background: t.accent, boxShadow: `0 0 6px ${t.accent}` }"
        />
      </button>

      <NuxtLink
        to="/settings"
        title="Settings"
        class="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150"
        :style="pillStyle(isActive('/settings'), hoveredId === 'settings')"
        @mouseenter="hoveredId = 'settings'"
      >
        <Settings :size="15" />
      </NuxtLink>

      <button
        :title="themeName === 'dark' ? 'Switch to light' : 'Switch to dark'"
        class="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150"
        :style="pillStyle(false, hoveredId === 'theme')"
        @mouseenter="hoveredId = 'theme'"
        @click="toggle"
      >
        <component :is="themeName === 'dark' ? Sun : Moon" :size="15" />
      </button>
    </div>
  </header>

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

const tasksStore = useTasksStore()
const runningCount = computed(() => tasksStore.runningCount)

const sessionsStore = useSessionsStore()
const anyStreaming = computed(() => sessionsStore.anyStreaming)

const hoveredId = ref<string | null>(null)

interface NavItem {
  id: string
  label: string
  icon: unknown
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

// Liquid Glass surface: active = bright translucent lozenge with ring + sheen +
// soft drop, hover = faint glass fill, idle = transparent.
const pillStyle = (active: boolean, hovered: boolean) => {
  if (active) {
    return {
      background: t.value.glassActive,
      color: t.value.text,
      border: `1px solid ${t.value.glassBorder}`,
      boxShadow: `inset 0 1px 0 ${t.value.glassHighlight}, 0 2px 10px -6px ${t.value.shadow}`,
    }
  }
  if (hovered) {
    return {
      background: t.value.glassHover,
      color: t.value.text,
      border: '1px solid transparent',
    }
  }
  return { background: 'transparent', color: t.value.textMuted, border: '1px solid transparent' }
}

const badgeStyle = computed(() => ({
  background: t.value.glassActive,
  color: t.value.accent,
  border: `1px solid ${t.value.glassBorder}`,
  boxShadow: `inset 0 1px 0 ${t.value.glassHighlight}`,
  minWidth: '18px',
}))
</script>

<style scoped>
/* Hide the horizontal scrollbar on the tab strip — overflow stays scrollable. */
.tabstrip::-webkit-scrollbar {
  height: 0;
  width: 0;
}
</style>
