<template>
  <aside class="side" :class="{ collapsed: navCollapsed && !compact }" data-tour="nav-rail">
    <div class="brand">
      <span class="logo">
        <AwogMascot v-if="isCute" :size="16" />
        <Icon v-else name="home" />
      </span>
      <span class="nm">
        AWOG
        <span>{{ t('nav.brandSuffix') }}</span>
      </span>
    </div>

    <nav class="navscroll">
      <template v-for="group in groups" :key="group.title ?? 'top'">
        <div v-if="group.title" class="navg">{{ t(group.title) }}</div>
        <NuxtLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="ni"
          :class="{ on: isActive(item.to) }"
          :title="navCollapsed && !compact ? t(item.label) : undefined"
          :data-tour="item.to === '/sessions' ? 'nav-sessions' : undefined"
        >
          <Icon :name="item.icon" />
          {{ t(item.label) }}
          <span v-if="item.badge" class="bdg" :class="item.badge.kind">{{ item.badge.n }}</span>
          <span v-if="item.dot" class="gdot" />
        </NuxtLink>
      </template>
    </nav>

    <div class="sfoot">
      <Button
        variant="ghost"
        size="iconSm"
        class="footbtn"
        :class="{ on: activityOpen }"
        :title="t('nav.activity')"
        @click="openActivity()"
      >
        <Icon name="act" style="width: var(--icon-md); height: var(--icon-md)" />
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        class="footbtn"
        :class="{ on: settingsOpen }"
        :title="t('nav.settings')"
        data-tour="settings-btn"
        @click="openSettings()"
      >
        <Icon name="settings" style="width: var(--icon-md); height: var(--icon-md)" />
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        class="footbtn wn-btn"
        :title="t('topbar.whatsNew')"
        data-tour="whatsnew-btn"
        @click="openPanel"
      >
        <Icon name="tag" style="width: var(--icon-md); height: var(--icon-md)" />
        <span v-if="hasUnseen" class="wn-dot" />
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        class="footbtn"
        :title="isDark ? t('topbar.toLight') : t('topbar.toDark')"
        @click="toggleTheme"
      >
        <Icon
          :name="isDark ? 'moon' : 'sun'"
          style="width: var(--icon-md); height: var(--icon-md)"
        />
      </Button>
      <Button
        v-if="!compact"
        variant="ghost"
        size="iconSm"
        class="navtgl"
        :title="t('nav.collapse')"
        @click="toggleNavCollapsed"
      >
        <Icon name="chev" />
      </Button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { isBoardSession } from '~/composables/useSessionsData'

type NavBadge = { kind: 'run' | 'wait'; n: number }
type NavItem = { to: string; icon: string; label: string; badge?: NavBadge; dot?: boolean }
type NavGroup = { title?: string; items: NavItem[] }

const sessions = useSessionsStore()
// Sessions needing the user's attention: unread, or paused on a gate (awaiting a
// question / permission answer). Drives the live "wait" badge on the Sessions nav
// item — replaces the old static seed. 0 → no badge.
// Phiên board (member team / lone-agent do board item dispatch) ẩn khỏi list —
// unread/awaiting của chúng thuộc về board/Teams chứ không phải màn Sessions,
// nên không được đếm vào badge này (badge "1" mà list không thấy gì = báo ảo).
const sessionsAttention = computed(
  () =>
    sessions.sessions.filter((s) => !isBoardSession(s) && (s.unread || s.status === 'awaiting'))
      .length,
)

// Grouping mirrors awog-prototype.html; `label`/`title` are i18n keys (resolved
// via t()). The Sessions badge is live (sessionsAttention). Tasks, Workflows,
// Agents, Commands, Rules, Hooks and Templates are intentionally hidden from
// the rail (user request) — their pages still exist, only the nav entries are gone.
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
      { to: '/board', icon: 'board', label: 'nav.board' },
      { to: '/teams', icon: 'agents', label: 'nav.teams' },
      { to: '/agents', icon: 'brain', label: 'nav.agents' },
      { to: '/schedules', icon: 'clock', label: 'nav.schedules' },
      { to: '/logtime', icon: 'table', label: 'nav.logtime' },
    ],
  },
  {
    title: 'nav.group.library',
    items: [
      { to: '/skills', icon: 'skills', label: 'nav.skills' },
      { to: '/wiki', icon: 'book', label: 'nav.wiki' },
    ],
  },
  {
    title: 'nav.group.system',
    items: [
      { to: '/projects', icon: 'projects', label: 'nav.projects' },
      { to: '/git', icon: 'git', label: 'nav.git', dot: true },
      { to: '/connections', icon: 'conn', label: 'nav.connections' },
      { to: '/ssh', icon: 'ssh', label: 'nav.ssh' },
      { to: '/infra', icon: 'layers', label: 'nav.infra' },
      { to: '/monitor', icon: 'cpu', label: 'nav.monitor' },
    ],
  },
])

const { t } = useI18n()
const route = useRoute()
const { open: settingsOpen, openSettings } = useSettingsModal()
const { open: activityOpen, openActivity } = useActivityModal()
const { isDark, toggleTheme } = useTheme()
const { hasUnseen, openPanel } = useWhatsNew()
// Icon-mode collapse is app-wide state (shared with the header toggle) and is
// persisted by useResponsiveShell under 'awog-nav-expanded' — see it for why the
// old 'awog-nav-collapsed' key is deliberately ignored.
const { compact, navCollapsed, toggleNavCollapsed } = useResponsiveShell()
const { isCute } = useThemeFamily()
const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to))
</script>

<style scoped>
/* The RAIL itself must not scroll — only its nav list. prototype.css makes `.side`
   the scroll container (`overflow-y:auto`), so with enough nav items the footer row
   (Activity / Settings / What's New / theme / collapse) is pushed below the fold and
   can only be reached by scrolling. Clip the rail and give the groups their own
   scroller instead: the brand stays at the top, `.sfoot` (margin-top:auto) is pinned
   at the bottom, and the list in between scrolls. */
.side {
  overflow: hidden;
  /* Canonical sidebar surface (bridge: --sidebar → --bgPanel, --sidebar-border →
     --border). The global `.side` rule already lands the same values; this pins
     the rail on the standard var names. */
  background: var(--sidebar);
  border-right: 1px solid var(--sidebar-border);
}
.navscroll {
  flex: 1 1 auto;
  min-height: 0; /* a flex child won't shrink below content height without this */
  overflow-y: auto;
  overscroll-behavior: contain;
}
/* Nav selection: the shadcn idiom is a NEUTRAL wash (bg-accent = --accent-wash,
   AWOG's --bgHover), not an emerald fill/border — spec §4 + NavRail surface note.
   The prototype's .ni.on accentDim/border/inset-bar trio is dropped here; the Cute
   family re-themes it via its own higher-specificity accentSoft pill. */
.ni.on {
  background: var(--accent-wash);
  border-color: transparent;
  box-shadow: none;
  color: var(--accent-foreground);
}
/* The footer is the rail's last row — its own hairline is enough; nothing above it
   should look like it scrolled underneath. */
.sfoot {
  flex: 0 0 auto;
}

/* Footer utility buttons (Settings + What's New + theme toggle) — ghost iconSm
   Buttons (28px); geometry + hover/focus come from the primitive, scoped rules
   keep only the dot anchor, the resting dim icon, and the on-state. The collapse
   button keeps margin-left:auto (global .navtgl), so these sit at the left and
   the collapse toggle stays pinned right. */
.footbtn {
  position: relative;
  color: var(--textDim);
  flex: 0 0 auto;
}
.footbtn:hover {
  color: var(--foreground);
}
/* Active (e.g. Settings modal open) — same neutral wash as the nav items' .on. */
.footbtn.on {
  color: var(--accent-foreground);
  background: var(--accent-wash);
}
.wn-dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--primary);
  border: 1px solid var(--card);
}
/* Collapsed rail is too narrow for a row — stack the footer buttons. */
.side.collapsed .sfoot {
  flex-direction: column;
  gap: 6px;
}
</style>
