<template>
  <aside class="side" :class="{ collapsed: collapsed && !compact }" data-tour="nav-rail">
    <div class="brand">
      <span class="logo"><Icon name="home" /></span>
      <span class="nm">
        AWOG
        <span>{{ t('nav.brandSuffix') }}</span>
      </span>
    </div>

    <template v-for="group in groups" :key="group.title ?? 'top'">
      <div v-if="group.title" class="navg">{{ t(group.title) }}</div>
      <NuxtLink
        v-for="item in group.items"
        :key="item.to"
        :to="item.to"
        class="ni"
        :class="{ on: isActive(item.to) }"
        :data-tour="item.to === '/sessions' ? 'nav-sessions' : undefined"
      >
        <Icon :name="item.icon" />
        {{ t(item.label) }}
        <span v-if="item.badge" class="bdg" :class="item.badge.kind">{{ item.badge.n }}</span>
        <span v-if="item.dot" class="gdot" />
      </NuxtLink>
    </template>

    <div class="sfoot">
      <button
        class="footbtn"
        :class="{ on: activityOpen }"
        :title="t('nav.activity')"
        @click="openActivity()"
      >
        <Icon name="act" style="width: 15px; height: 15px" />
      </button>
      <button
        class="footbtn"
        :class="{ on: settingsOpen }"
        :title="t('nav.settings')"
        data-tour="settings-btn"
        @click="openSettings()"
      >
        <Icon name="settings" style="width: 15px; height: 15px" />
      </button>
      <button
        class="footbtn wn-btn"
        :title="t('topbar.whatsNew')"
        data-tour="whatsnew-btn"
        @click="openPanel"
      >
        <Icon name="tag" style="width: 15px; height: 15px" />
        <span v-if="hasUnseen" class="wn-dot" />
      </button>
      <button
        class="footbtn"
        :title="isDark ? t('topbar.toLight') : t('topbar.toDark')"
        @click="toggleTheme"
      >
        <Icon :name="isDark ? 'moon' : 'sun'" style="width: 15px; height: 15px" />
      </button>
      <button v-if="!compact" class="navtgl" :title="t('nav.collapse')" @click="toggleCollapsed">
        <Icon name="chev" />
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

type NavBadge = { kind: 'run' | 'wait'; n: number }
type NavItem = { to: string; icon: string; label: string; badge?: NavBadge; dot?: boolean }
type NavGroup = { title?: string; items: NavItem[] }

const sessions = useSessionsStore()
// Sessions needing the user's attention: unread, or paused on a gate (awaiting a
// question / permission answer). Drives the live "wait" badge on the Sessions nav
// item — replaces the old static seed. 0 → no badge.
const sessionsAttention = computed(
  () => sessions.sessions.filter((s) => s.unread || s.status === 'awaiting').length,
)

// Grouping mirrors awog-prototype.html; `label`/`title` are i18n keys (resolved
// via t()). The Sessions badge is live (sessionsAttention); Tasks has no live
// store in ui-next yet, so it carries no badge.
const groups = computed<NavGroup[]>(() => [
  { items: [{ to: '/', icon: 'home', label: 'nav.home' }] },
  {
    title: 'nav.group.work',
    items: [
      {
        to: '/sessions',
        icon: 'sessions',
        label: 'nav.sessions',
        ...(sessionsAttention.value > 0
          ? { badge: { kind: 'wait', n: sessionsAttention.value } as NavBadge }
          : {}),
      },
      { to: '/tasks', icon: 'tasks', label: 'nav.tasks' },
      { to: '/workflows', icon: 'workflows', label: 'nav.workflows' },
    ],
  },
  {
    title: 'nav.group.library',
    items: [
      { to: '/agents', icon: 'agents', label: 'nav.agents' },
      { to: '/skills', icon: 'skills', label: 'nav.skills' },
      { to: '/commands', icon: 'commands', label: 'nav.commands' },
      { to: '/rules', icon: 'rules', label: 'nav.rules' },
      { to: '/templates', icon: 'templates', label: 'nav.templates' },
    ],
  },
  {
    title: 'nav.group.system',
    items: [
      { to: '/projects', icon: 'projects', label: 'nav.projects' },
      { to: '/git', icon: 'git', label: 'nav.git', dot: true },
      { to: '/connections', icon: 'conn', label: 'nav.connections' },
      { to: '/ssh', icon: 'ssh', label: 'nav.ssh' },
      { to: '/hooks', icon: 'hooks', label: 'nav.hooks' },
    ],
  },
])

const { t } = useI18n()
const route = useRoute()
const { open: settingsOpen, openSettings } = useSettingsModal()
const { open: activityOpen, openActivity } = useActivityModal()
const { isDark, toggleTheme } = useTheme()
const { hasUnseen, openPanel } = useWhatsNew()
const { compact } = useResponsiveShell()
const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to))

const COLLAPSE_KEY = 'awog-nav-collapsed'
const collapsed = ref(false)
if (import.meta.client) collapsed.value = localStorage.getItem(COLLAPSE_KEY) === '1'
function toggleCollapsed() {
  collapsed.value = !collapsed.value
  localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0')
}
</script>

<style scoped>
/* Footer utility buttons (Settings + What's New + theme toggle) — sized like
   .navtgl but without the chevron rotation. The collapse button keeps
   margin-left:auto, so these sit at the left and the collapse toggle stays
   pinned right. */
.footbtn {
  position: relative;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: var(--textDim);
  background: transparent;
  cursor: pointer;
  flex: 0 0 auto;
}
.footbtn:hover {
  color: var(--text);
  background: var(--bgHover);
}
/* Active (e.g. Settings modal open) — accent like the nav items' .on state. */
.footbtn.on {
  color: var(--accent);
  background: var(--accentDim);
}
.wn-dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  border: 1px solid var(--bgEl);
}
/* Collapsed rail is too narrow for a row — stack the footer buttons. */
.side.collapsed .sfoot {
  flex-direction: column;
  gap: 6px;
}
</style>
