<template>
  <span class="ntf">
    <button
      class="ntf-btn"
      type="button"
      :class="{ on: open, live: unreadCount > 0 }"
      :title="t('github.inbox.title')"
      :aria-expanded="open"
      @click.stop="toggle"
    >
      <Icon name="bell" style="width: 15px; height: 15px" />
      <span v-if="unreadCount > 0" class="ntf-badge">{{ badge }}</span>
    </button>

    <div
      v-if="open"
      class="ntf-panel"
      role="dialog"
      :aria-label="t('github.inbox.title')"
      @click.stop
    >
      <div class="ntf-head">
        <span class="ntf-head-title">{{ t('github.inbox.title') }}</span>
        <button
          class="ntf-act"
          type="button"
          :disabled="loading"
          :title="t('github.inbox.refresh')"
          @click="refresh"
        >
          <Icon
            name="refresh"
            class="ntf-refresh-ic"
            :class="{ spinning: loading }"
            style="width: 13px; height: 13px"
          />
        </button>
        <button
          class="ntf-act"
          type="button"
          :disabled="!unreadCount"
          :title="t('github.inbox.markAllRead')"
          @click="markAll"
        >
          <Icon name="check" style="width: 13px; height: 13px" />
        </button>
        <button
          class="ntf-act"
          type="button"
          :title="t('github.inbox.settings')"
          @click="goSettings"
        >
          <Icon name="settings" style="width: 13px; height: 13px" />
        </button>
      </div>

      <!-- Watched = repos of the projects opted in at Settings → Git (the only ones
           allowed to toast). The filter is only OFFERED when it would change the
           list: two tabs showing the same count taught the user nothing except that
           one of them was pointless. -->
      <div v-if="hasUnwatched" class="ntf-tabs">
        <button
          v-for="tab in TABS"
          :key="tab"
          class="ntf-tab"
          :class="{ on: filter === tab }"
          type="button"
          :title="t(`github.inbox.tabHint.${tab}`)"
          @click="filter = tab"
        >
          {{ t(`github.inbox.tab.${tab}`) }}
          <span class="ntf-tab-n tnum">
            {{ tab === 'all' ? items.length : watchedItems.length }}
          </span>
        </button>
      </div>

      <div class="ntf-body">
        <p v-if="error" class="ntf-note err">{{ error }}</p>
        <p v-else-if="!enabled" class="ntf-note">{{ t('github.inbox.off') }}</p>
        <p v-else-if="!watchedProjectCount" class="ntf-note">{{ t('github.inbox.noWatched') }}</p>

        <!-- The empty state is a CLAIM ("your inbox is clear") — never make it next
             to an error, where the truth is "we don't know". -->
        <p v-if="loading && !visible.length" class="ntf-note">{{ t('github.inbox.loading') }}</p>
        <p v-else-if="!visible.length && !error" class="ntf-note">
          {{ filter === 'watched' ? t('github.inbox.emptyWatched') : t('github.inbox.empty') }}
        </p>
        <!-- Grouped by repo: one inbox is usually 3 repos deep, so printing the
             owner/repo on every row spent the widest column on the least
             informative text. The header carries it once and sticks while its rows
             scroll; a group whose project isn't watched reads dimmer (it never
             would have interrupted you). -->
        <div v-for="g in groups" :key="g.repo" class="ntf-grp">
          <!-- The whole header is the collapse toggle (bigger target than a lone
               chevron). A collapsed group keeps its unread dot + count visible, so
               folding a noisy repo away never hides that it has something new. -->
          <button
            class="ntf-grp-head"
            type="button"
            :aria-expanded="!isCollapsed(g.repo)"
            :title="isCollapsed(g.repo) ? t('github.inbox.expand') : t('github.inbox.collapse')"
            @click="toggleGroup(g.repo)"
          >
            <Icon name="chev-right" class="ntf-grp-chev" :class="{ open: !isCollapsed(g.repo) }" />
            <span class="ntf-grp-name" :title="g.repo">{{ g.name }}</span>
            <span v-if="g.owner" class="ntf-grp-owner">{{ g.owner }}</span>
            <!-- Names the reason this group is dimmed, instead of leaving the user to
                 infer it from an opacity value. -->
            <span v-if="!g.watched" class="ntf-grp-tag">{{ t('github.inbox.notWatched') }}</span>
            <span v-if="g.unread" class="ntf-grp-dot" />
            <span class="ntf-grp-n tnum">{{ g.items.length }}</span>
          </button>
          <template v-if="!isCollapsed(g.repo)">
            <TopBarNotifyRow
              v-for="n in g.items"
              :key="n.id"
              :item="n"
              :author="authorOf(n)"
              @open="onOpen"
              @external="onExternal"
              @read="onRead"
            />
          </template>
        </div>
      </div>

      <div class="ntf-foot">
        <span class="ntf-foot-when">{{ checkedLabel }}</span>
        <button class="ntf-foot-link" type="button" @click="openOnGithub">
          {{ t('github.inbox.openOnGithub') }}
        </button>
      </div>
    </div>

    <div v-if="open" class="ntf-backdrop" @click="close" />
  </span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useConfirm } from '~/composables/useConfirm'
import {
  markAllGhNotificationsRead,
  markGhNotificationRead,
  refreshGhInbox,
  useGhInbox,
  type GhNotification,
} from '~/composables/useGhInbox'
import {
  isAlerting,
  openNotification,
  useGhNotificationsStatus,
} from '~/composables/useGhNotifications'
import { useSettingsModal } from '~/composables/useSettingsModal'
import { useSidecar } from '~/composables/useSidecar'
import { useSettingsStore } from '~/stores/settings'
import { formatRelativeAgo } from '~/utils/relative-time'

// Top-bar bell: the GitHub notification inbox (docs/features/github-notifications.md).
// The list itself is the app-lifetime singleton in useGhInbox — the poller keeps it
// current, so opening the panel costs nothing. This component owns only the popover
// and routes each row through the poller's own open path.

const TABS = ['all', 'watched'] as const
type InboxTab = (typeof TABS)[number]

const { t } = useI18n()
const now = useNow()
const settings = useSettingsStore()
const { openSettings } = useSettingsModal()
const { confirm } = useConfirm()
const { items, loading, error, lastFetchedAt, unreadCount, authorOf } = useGhInbox()
const { watchedProjectCount } = useGhNotificationsStatus()

const open = ref(false)
const filter = ref<InboxTab>('all')

const enabled = computed(() => settings.githubNotify.enabled)
const watchedItems = computed(() => items.value.filter(isAlerting))
const visible = computed(() => (filter.value === 'watched' ? watchedItems.value : items.value))
const badge = computed(() => (unreadCount.value > 99 ? '99+' : String(unreadCount.value)))
// Is there anything the "watched" filter would actually hide?
const hasUnwatched = computed(() => watchedItems.value.length < items.value.length)
// If the filter stops being offered while it is active, fall back to Everything —
// otherwise the list silently keeps filtering with no control on screen.
watch(hasUnwatched, (has) => {
  if (!has) filter.value = 'all'
})

// Group the visible list by repo, keeping the newest-first order: a group takes the
// position of its newest item, rows inside stay in list order. Map preserves
// insertion order, so no sorting is needed to get that.
type InboxGroup = {
  repo: string
  // owner/name split so the header can lead with the part that identifies the repo.
  owner: string
  name: string
  watched: boolean
  items: GhNotification[]
}
type InboxGroupView = InboxGroup & { unread: number }
const groups = computed<InboxGroupView[]>(() => {
  const byRepo = new Map<string, InboxGroup>()
  for (const n of visible.value) {
    let group = byRepo.get(n.repo)
    if (!group) {
      const slash = n.repo.indexOf('/')
      group = {
        repo: n.repo,
        owner: slash > 0 ? n.repo.slice(0, slash) : '',
        name: slash > 0 ? n.repo.slice(slash + 1) : n.repo,
        watched: isAlerting(n),
        items: [],
      }
      byRepo.set(n.repo, group)
    }
    group.items.push(n)
  }
  return [...byRepo.values()].map((g) => ({
    ...g,
    unread: g.items.filter((n) => n.unread).length,
  }))
})

// Collapsed repos. Component state, NOT persisted: a group folded away in a past
// session would silently hide new notifications on the next launch.
const collapsed = ref<Set<string>>(new Set())
const isCollapsed = (repo: string): boolean => collapsed.value.has(repo)
function toggleGroup(repo: string): void {
  const next = new Set(collapsed.value)
  if (!next.delete(repo)) next.add(repo)
  collapsed.value = next
}
const checkedLabel = computed(() =>
  lastFetchedAt.value
    ? t('github.inbox.checked', { when: formatRelativeAgo(lastFetchedAt.value, t, now.value) })
    : t('github.inbox.neverChecked'),
)

// Opening pulls a fresh list: the panel is a deliberate "what do I have right now?"
// question, and the poll interval can be up to 10 minutes wide.
function toggle(): void {
  open.value = !open.value
  if (open.value) void refreshGhInbox()
}
function close(): void {
  open.value = false
}
useEscToClose(open, close)

const refresh = (): void => void refreshGhInbox()

function onOpen(n: GhNotification): void {
  close()
  openNotification(n)
}

// The row's ↗ hands the thread to the browser and LEAVES THE PANEL OPEN: the app
// itself doesn't change, and closing it forced a re-open for every next row. Only the
// in-app open (onOpen) closes, because it navigates the UI behind the panel.
function onExternal(n: GhNotification): void {
  if (n.url) void useSidecar().openExternal(n.url)
}

const onRead = (id: string): void => void markGhNotificationRead(id)

// Marks the WHOLE GitHub inbox read, including repos AWOG never shows — worth a
// confirm even though GitHub offers the same button.
async function markAll(): Promise<void> {
  const ok = await confirm({
    title: t('github.inbox.markAllConfirm.title'),
    description: t('github.inbox.markAllConfirm.desc', { n: unreadCount.value }),
    confirmLabel: t('github.inbox.markAllRead'),
    kind: 'primary',
  })
  if (ok) await markAllGhNotificationsRead()
}

function goSettings(): void {
  close()
  openSettings('git')
}

function openOnGithub(): void {
  void useSidecar().openExternal('https://github.com/notifications')
}
</script>

<style scoped>
.ntf {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
}
/* Matches the top bar's .kbd height/round so bell + search read as one row. */
.ntf-btn {
  position: relative;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.ntf-btn:hover {
  color: var(--text);
  background: var(--bgHover);
}
.ntf-btn.live {
  color: var(--text);
}
.ntf-btn.on {
  color: var(--accent);
  border-color: var(--borderStrong);
  background: var(--bgHover);
}
.ntf-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.ntf-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: var(--r-pill);
  background: var(--accent);
  color: var(--bg);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  line-height: 15px;
  text-align: center;
}

/* Panel sits under the bell, anchored to its right edge so it never overflows the
   window. z-index rides just above the page bands (≤61) but below modals (≥100),
   with the backdrop one step lower so a click anywhere else closes it. */
.ntf-panel {
  position: absolute;
  top: 34px;
  right: 0;
  z-index: 96;
  width: 420px;
  max-width: calc(100vw - 24px);
  display: flex;
  flex-direction: column;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-btn);
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.ntf-backdrop {
  position: fixed;
  inset: 0;
  z-index: 95;
}
.ntf-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 9px 8px 9px 11px;
  border-bottom: 1px solid var(--border);
}
.ntf-head-title {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ntf-act {
  flex: 0 0 auto;
  padding: 4px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.ntf-act:hover:not(:disabled) {
  background: var(--bgHover);
  color: var(--text);
}
.ntf-act:disabled {
  opacity: 0.4;
  cursor: default;
}
/* Reload feedback. Global `[data-reduced-motion='1'] *` already neutralises this
   for users who asked for less motion, so no separate guard here. */
.ntf-refresh-ic.spinning {
  animation: ntf-spin 0.8s linear infinite;
}
@keyframes ntf-spin {
  to {
    transform: rotate(360deg);
  }
}
.ntf-tabs {
  display: flex;
  gap: 4px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--border);
}
.ntf-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border: 1px solid transparent;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  font: inherit;
}
.ntf-tab:hover {
  color: var(--text);
}
.ntf-tab.on {
  border-color: var(--accent);
  color: var(--accent);
}
.ntf-tab-n {
  font-size: 12px;
  line-height: 1;
  color: var(--textDim);
}
.ntf-tab.on .ntf-tab-n {
  color: var(--accent);
}
.ntf-body {
  max-height: min(520px, 68vh);
  overflow-y: auto;
  /* Hard stop on sideways scroll: rows ellipsize (TopBarNotifyRow), so anything
     wider than the panel is a layout bug, not content the user should pan to. */
  overflow-x: hidden;
  padding: 0 5px 5px;
}
/* Repo group. The header sticks to the top of the scroll box so you always know
   which repo the rows under the cursor belong to. */
.ntf-grp + .ntf-grp {
  margin-top: 2px;
}
/* No opacity dim on a non-watched group: with no project opted in EVERY group is
   "not watched", so the dim landed on the whole list and just made text hard to
   read. The `không theo dõi` chip states it in words instead — an opacity value is
   not something the user can decode anyway. */
.ntf-grp-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  /* Opaque: rows scroll UNDER this. */
  background: var(--bgEl);
  border: 0;
  padding: 7px 8px 5px 4px;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.ntf-grp-head:hover .ntf-grp-name,
.ntf-grp-head:hover .ntf-grp-chev {
  color: var(--text);
}
.ntf-grp-head:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  border-radius: var(--r-xs);
}
.ntf-grp-chev {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  color: var(--textDim);
  transition: transform 0.14s ease;
}
.ntf-grp-chev.open {
  transform: rotate(90deg);
}
/* Same accent dot the rows use — a folded group still says "something in here is
   unread" without spelling out a second number. */
.ntf-grp-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  margin-left: auto;
  border-radius: 50%;
  background: var(--accent);
}
.ntf-grp-name {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--textMuted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ntf-grp-owner {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ntf-grp-tag {
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  color: var(--textDim);
  font-size: 12px;
  line-height: 1.35;
}
.ntf-grp-n {
  flex: 0 0 auto;
  /* Pushes itself right when nothing precedes it; when the unread dot is there the
     dot takes the auto margin instead, so the pair stays glued together. */
  margin-left: auto;
  color: var(--textDim);
}
.ntf-grp-dot + .ntf-grp-n {
  margin-left: 0;
}
.ntf-note {
  margin: 0;
  padding: 8px 7px;
  color: var(--textDim);
}
.ntf-note.err {
  color: var(--danger);
}
.ntf-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  border-top: 1px solid var(--border);
  color: var(--textDim);
  font-size: 12px;
}
.ntf-foot-when {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ntf-foot-link {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
}
.ntf-foot-link:hover {
  text-decoration: underline;
}
</style>
