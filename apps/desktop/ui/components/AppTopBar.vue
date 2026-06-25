<template>
  <header
    class="flex items-center gap-2 px-3 h-12 flex-shrink-0 rounded-xl"
    :style="{
      background: parts.bg,
      border: `1px solid ${parts.border}`,
      boxShadow: parts.sheen
        ? `${parts.sheen}, 0 6px 18px -10px ${parts.shadow}`
        : `0 6px 18px -10px ${parts.shadow}`,
      color: t.text,
    }"
  >
    <!-- Page title -->
    <h1 class="text-[1em] font-semibold tracking-tight truncate" :style="{ color: t.text }">
      {{ pageTitle }}
    </h1>

    <div class="flex-1" />

    <!-- Page-specific action(s) -->
    <slot name="action" />

    <!-- Global search trigger -->
    <button
      type="button"
      :title="tr('topbar.search')"
      class="flex items-center gap-2 h-8 pl-2.5 pr-2 rounded-lg transition-all duration-150"
      :style="searchStyle(hoveredId === 'search')"
      @mouseenter="hoveredId = 'search'"
      @mouseleave="hoveredId = null"
      @click="emit('open-search')"
    >
      <Search :size="15" class="flex-shrink-0" />
      <span class="text-[1em] hidden sm:inline">{{ tr('topbar.search') }}</span>
      <kbd
        class="font-mono text-[12px] leading-none px-1.5 py-1 rounded"
        :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
      >
        ⌘K
      </kbd>
    </button>

    <!-- Divider -->
    <div class="self-stretch my-2.5 w-px flex-shrink-0" :style="{ background: parts.border }" />

    <!-- Utility cluster -->
    <div class="flex items-center gap-1 flex-shrink-0" @mouseleave="hoveredId = null">
      <button
        type="button"
        :title="tr('whatsnew.label')"
        class="relative flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150"
        :style="iconStyle(hoveredId === 'whatsnew')"
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
        type="button"
        :title="themeName === 'dark' ? tr('topbar.theme.light') : tr('topbar.theme.dark')"
        class="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150"
        :style="iconStyle(hoveredId === 'theme')"
        @mouseenter="hoveredId = 'theme'"
        @click="toggle"
      >
        <component :is="themeName === 'dark' ? Sun : Moon" :size="15" />
      </button>
    </div>

    <WhatsNewModal :open="whatsNewOpen" :releases="releases" @close="closePanel" />
  </header>
</template>

<script setup lang="ts">
import { Search, Sparkles, Sun, Moon } from 'lucide-vue-next'

const emit = defineEmits<{
  // Opens the global ⌘K palette — the layout owns its visibility.
  'open-search': []
}>()

const { t, themeName, toggle } = useTheme()
const { on, parts, pill } = useGlass()
const { t: tr } = useI18n()
const { open: whatsNewOpen, hasUnseen, releases, openPanel, closePanel } = useWhatsNew()
const route = useRoute()

const hoveredId = ref<string | null>(null)

// Path → i18n title key. Falls back to the brand wordmark on the dashboard root
// and to the longest matching prefix for nested routes (e.g. /sessions/abc).
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
}

const pageTitle = computed(() => {
  const path = route.path
  if (path === '/') return tr(TITLE_KEYS['/']!)
  // Match the most specific (longest) prefix so nested routes resolve correctly.
  const match = Object.keys(TITLE_KEYS)
    .filter((p) => p !== '/' && path.startsWith(p))
    .sort((a, b) => b.length - a.length)[0]
  return match ? tr(TITLE_KEYS[match]!) : tr('nav.brand')
})

// Labelled search trigger — glass-aware tint (mirrors HeaderTabBar pillStyle).
const searchStyle = (hovered: boolean) => {
  const base = pill(false, hovered)
  return {
    background: on.value ? t.value.glassActive : t.value.bgInput,
    border: `1px solid ${hovered ? t.value.borderStrong : base.borderColor || t.value.border}`,
    color: hovered ? t.value.text : t.value.textMuted,
  }
}

// Icon-only utility pill (What's New / theme toggle).
const iconStyle = (hovered: boolean) => {
  const base = pill(false, hovered)
  return {
    background: base.background,
    border: `1px solid ${base.borderColor}`,
    color: hovered ? t.value.text : t.value.textMuted,
  }
}
</script>
