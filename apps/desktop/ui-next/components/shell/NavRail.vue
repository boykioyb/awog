<template>
  <aside class="side" :class="{ collapsed }">
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
        :class="{ on: settingsOpen }"
        :title="t('nav.settings')"
        @click="openSettings()"
      >
        <Icon name="settings" style="width: 15px; height: 15px" />
      </button>
      <button class="footbtn wn-btn" :title="t('topbar.whatsNew')" @click="openPanel">
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
      <button class="navtgl" :title="t('nav.collapse')" @click="toggleCollapsed">
        <Icon name="chev" />
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'

type NavBadge = { kind: 'run' | 'wait'; n: number }
type NavItem = { to: string; icon: string; label: string; badge?: NavBadge; dot?: boolean }
type NavGroup = { title?: string; items: NavItem[] }

// Grouping + badges mirror awog-prototype.html. Badge/dot counts are static mock
// for now — wired to live stores (sessions/tasks/git) during the feature port.
// `label`/`title` hold i18n keys (resolved via t()). Grouping + badges mirror
// awog-prototype.html. Badge/dot counts are static mock for now — wired to live
// stores (sessions/tasks/git) during the feature port.
const groups: NavGroup[] = [
  { items: [{ to: '/', icon: 'home', label: 'nav.home' }] },
  {
    title: 'nav.group.work',
    items: [
      { to: '/sessions', icon: 'sessions', label: 'nav.sessions', badge: { kind: 'wait', n: 2 } },
      { to: '/tasks', icon: 'tasks', label: 'nav.tasks', badge: { kind: 'run', n: 3 } },
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
      { to: '/hooks', icon: 'hooks', label: 'nav.hooks' },
    ],
  },
]

const { t } = useI18n()
const route = useRoute()
const { open: settingsOpen, openSettings } = useSettingsModal()
const { isDark, toggleTheme } = useTheme()
const { hasUnseen, openPanel } = useWhatsNew()
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
