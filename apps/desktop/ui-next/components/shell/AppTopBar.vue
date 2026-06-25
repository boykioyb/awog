<template>
  <div class="top">
    <span class="ptitle">{{ title }}</span>
    <span class="sp" />
    <div class="kbd" title="Command palette (chưa wire)">
      <Icon name="search" style="width: 13px; height: 13px" />
      {{ t('topbar.search') }}
      <span class="kk">⌘K</span>
    </div>
    <button class="btn pri" :title="t('topbar.new')" @click="onNew">
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
