<template>
  <header
    class="relative h-12 flex items-center gap-2.5 px-3 flex-shrink-0 z-30"
    :style="{
      background: parts.bg,
      backdropFilter: parts.blur,
      WebkitBackdropFilter: parts.blur,
      borderBottom: `1px solid ${parts.border}`,
      boxShadow: parts.sheen
        ? `${parts.sheen}, 0 8px 24px -16px ${parts.shadow}`
        : `0 8px 24px -16px ${parts.shadow}`,
      color: t.text,
    }"
  >
    <!-- Brand -->
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

    <!-- Section tabs -->
    <nav
      ref="strip"
      class="tabstrip flex items-center gap-1.5 flex-1 overflow-x-auto h-full"
      @mouseleave="hoveredId = null"
      @wheel="onWheel"
    >
      <NuxtLink
        v-for="item in items"
        :key="item.id"
        :to="item.to"
        :title="item.label"
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
        <template v-else-if="item.id === 'sessions'">
          <span
            v-if="unreadCount > 0"
            class="inline-flex items-center justify-center font-mono text-[12px] leading-none px-1.5 py-0.5 rounded-full"
            :style="badgeStyle"
            :title="`${unreadCount} unread`"
          >
            {{ unreadCount }}
          </span>
          <span
            v-else-if="anyStreaming"
            class="w-1.5 h-1.5 rounded-full animate-pulse"
            :style="{ background: t.accent, boxShadow: `0 0 6px ${t.accent}` }"
            title="Streaming"
          />
        </template>
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
    <div class="self-stretch my-2.5 w-px flex-shrink-0" :style="{ background: parts.border }" />

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

      <button
        :title="tr('settings.title')"
        class="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150"
        :style="pillStyle(settingsOpen, hoveredId === 'settings')"
        @mouseenter="hoveredId = 'settings'"
        @click="openSettings()"
      >
        <Settings :size="15" />
      </button>

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
  <SettingsModal />
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
  ScrollText,
  Package,
  Sparkles,
} from 'lucide-vue-next'

const { t, themeName, toggle } = useTheme()
const { on, parts, pill } = useGlass()
const { t: tr } = useI18n()
const { open: whatsNewOpen, hasUnseen, releases, openPanel, closePanel } = useWhatsNew()
const { open: settingsOpen, openSettings } = useSettingsModal()
const route = useRoute()

const gitStore = useGitStore()
const gitDirty = computed(() => gitStore.hasUncommitted)
const gitAhead = computed(() => gitStore.ahead)
const gitBehind = computed(() => gitStore.behind)

const tasksStore = useTasksStore()
const runningCount = computed(() => tasksStore.runningCount)

const sessionsStore = useSessionsStore()
const anyStreaming = computed(() => sessionsStore.anyStreaming)
const unreadCount = computed(() => sessionsStore.unreadCount)

const hoveredId = ref<string | null>(null)

// Tab strip overflow handling. Labels always show (more legible than icon-only);
// when the labelled tabs don't fit, map a mouse wheel's vertical delta onto
// horizontal scroll — trackpads already emit deltaX natively.
const strip = useTemplateRef<HTMLElement>('strip')

const onWheel = (e: WheelEvent) => {
  const el = strip.value
  if (!el || el.scrollWidth <= el.clientWidth) return
  if (e.deltaY === 0) return // let native horizontal (trackpad) deltaX through
  el.scrollLeft += e.deltaY
  e.preventDefault()
}

interface NavItem {
  id: string
  label: string
  icon: unknown
  to: string
}

const items: NavItem[] = [
  { id: 'sessions', label: 'Sessions', icon: MessageSquare, to: '/sessions' },
  { id: 'tasks', label: 'Tasks', icon: ListTodo, to: '/tasks' },
  { id: 'projects', label: 'Projects', icon: FolderGit2, to: '/projects' },
  { id: 'workflows', label: 'Workflows', icon: Workflow, to: '/workflows' },
  { id: 'agents', label: 'Agents', icon: Users, to: '/agents' },
  { id: 'skills', label: 'Skills', icon: Wand2, to: '/skills' },
  { id: 'templates', label: 'Templates', icon: Package, to: '/templates' },
  { id: 'git', label: 'Git', icon: GitBranch, to: '/git' },
  { id: 'connections', label: 'Connections', icon: Plug, to: '/connections' },
  { id: 'hooks', label: 'Hooks', icon: Zap, to: '/hooks' },
  { id: 'rules', label: 'Rules', icon: ScrollText, to: '/rules' },
  { id: 'commands', label: 'Commands', icon: Slash, to: '/commands' },
]

const isActive = (to: string) => {
  if (to === '/sessions') return route.path === '/' || route.path.startsWith('/sessions')
  return route.path.startsWith(to)
}

// Tab/utility pill: glass lozenge via useGlass (mode-aware) + app-semantic text
// color + an active sheen/drop when glass is on.
const pillStyle = (active: boolean, hovered: boolean) => {
  const base = pill(active, hovered)
  return {
    background: base.background,
    border: `1px solid ${base.borderColor}`,
    color: active || hovered ? t.value.text : t.value.textMuted,
    boxShadow:
      active && on.value
        ? `inset 0 1px 0 ${t.value.glassHighlight}, 0 2px 10px -6px ${t.value.shadow}`
        : 'none',
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

<style scoped>
/* Hide the scrollbar on the tab strip — overflow stays scrollable (trackpad /
 * wheel). `overflow-x: auto` (Tailwind) implies `overflow-y: auto`, which on
 * Chromium/Electron renders a stray vertical bar overlapping the header border;
 * pin overflow-y to hidden and hide the bar cross-browser. */
.tabstrip {
  overflow-y: hidden;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* legacy Edge */
}
.tabstrip::-webkit-scrollbar {
  display: none; /* Chromium / WebKit (Electron) */
}
</style>
