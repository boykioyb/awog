<template>
  <div class="top">
    <!-- Compact-mode drawer toggles (≤1100px): ☰ reveals the nav rail; the
         panel-left icon reveals the page's secondary list. Hidden at full width. -->
    <button
      v-if="compact"
      class="shelltgl"
      :class="{ on: navOpen }"
      :title="t('topbar.openNav')"
      @click="toggleNav"
    >
      <Icon name="menu" style="width: 16px; height: 16px" />
    </button>
    <button
      v-if="compact && hasList"
      class="shelltgl"
      :class="{ on: listOpen }"
      :title="t('topbar.openList')"
      @click="toggleList"
    >
      <Icon name="dock-left" style="width: 16px; height: 16px" />
    </button>
    <span class="ptitle">{{ title }}</span>
    <span class="sp" />
    <div class="kbd" data-tour="cmdk-hint" title="Command palette (chưa wire)">
      <Icon name="search" style="width: 13px; height: 13px" />
      {{ t('topbar.search') }}
      <span class="kk">⌘K</span>
    </div>
    <button class="btn pri" data-tour="new-btn" :title="t('topbar.new')" @click="onNew">
      <Icon name="plus" />
      <span>{{ t('topbar.new') }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

// Route → page-title i18n key (reuses the NavRail nav.* keys).
const TITLE_KEYS: Record<string, string> = {
  '/': 'nav.home',
  '/sessions': 'nav.sessions',
  '/tasks': 'nav.tasks',
  '/workflows': 'nav.workflows',
  '/agents': 'nav.agents',
  '/skills': 'nav.skills',
  '/commands': 'nav.commands',
  '/rules': 'nav.rules',
  '/templates': 'nav.templates',
  '/projects': 'nav.projects',
  '/git': 'nav.git',
  '/connections': 'nav.connections',
  '/hooks': 'nav.hooks',
  '/settings': 'nav.settings',
}

const { t } = useI18n()
const route = useRoute()
const { compact, navOpen, listOpen, hasList, toggleNav, toggleList } = useResponsiveShell()
const title = computed(() => {
  const path = route.path
  const key = Object.keys(TITLE_KEYS).find((k) => (k === '/' ? path === '/' : path.startsWith(k)))
  const titleKey = key ? TITLE_KEYS[key] : undefined
  return titleKey ? t(titleKey) : 'AWOG'
})

// Global "New" → start a fresh session (the primary work entity; create() also
// selects it) and land on the Sessions page.
const sessions = useSessionsStore()
function onNew() {
  sessions.create()
  if (!route.path.startsWith('/sessions')) navigateTo('/sessions')
}
</script>

<style scoped>
/* Compact drawer toggles — icon buttons sized to match the top bar, sitting left
   of the page title. Default muted; accent when the drawer they control is open. */
.shelltgl {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: var(--textDim);
  background: transparent;
  cursor: pointer;
}
.shelltgl:hover {
  color: var(--text);
  background: var(--bgHover);
}
.shelltgl.on {
  color: var(--accent);
  background: var(--accentDim);
}
.shelltgl:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
