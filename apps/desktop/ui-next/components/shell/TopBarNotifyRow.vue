<template>
  <div class="ntf-row" :class="{ read: !item.unread }">
    <!-- Unread marker. Always occupies its slot so read and unread rows stay aligned
         — the dot appearing/disappearing must not shift the text next to it. -->
    <span class="ntf-row-dot" :class="{ on: item.unread }" />
    <Icon :name="typeIcon" class="ntf-row-ic" :class="{ act: actionable }" />
    <div class="ntf-row-body">
      <!-- Title WRAPS (clamped at 3 lines): a truncated GitHub title usually loses
           the part that says what changed. The row lives inside a per-repo group
           (TopBarNotifications), so the repo name is not repeated here. -->
      <button class="ntf-row-main" type="button" :title="hoverText" @click="emit('open', item)">
        <span class="ntf-row-title">{{ item.title }}</span>
        <span class="ntf-row-meta">
          <span v-if="item.number != null" class="ntf-row-num mono">#{{ item.number }}</span>
          <!-- Who opened it. Sits BEFORE the reason so it is never the first thing
               truncated — "whose PR is this" is the question the row gets asked. -->
          <span
            v-if="author"
            class="ntf-row-author"
            :title="t('github.inbox.author', { login: author })"
          >
            {{ author }}
          </span>
          <span class="ntf-row-reason" :class="{ act: actionable }">
            {{ reasonLabel(item.reason) }}
          </span>
          <span class="ntf-row-time">{{ when }}</span>
        </span>
      </button>
      <!-- Actions on their OWN line, with labels: always visible, never competing
           with the title for width, and no icon the user has to decode. -->
      <div class="ntf-row-acts">
        <button
          v-if="item.unread"
          class="ntf-row-act read"
          type="button"
          @click.stop="emit('read', item.id)"
        >
          <Icon name="check" style="width: 12px; height: 12px" />
          <span>{{ t('github.inbox.markRead') }}</span>
        </button>
        <button class="ntf-row-act" type="button" @click.stop="emit('external', item)">
          <Icon name="external" style="width: 11px; height: 11px" />
          <span>{{ t('github.inbox.openExternal') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { GhNotification } from '~/composables/useGhInbox'
import { reasonLabel } from '~/composables/useGhNotifications'
import { formatRelativeAgo } from '~/utils/relative-time'

// One inbox row. Presentation only: routing + the mark-read RPC belong to the
// parent panel, so this component stays reusable and testable by eye.

// Reasons that ask something OF THE USER get the accent; the rest (CI, plain
// subscriptions, state changes) stay quiet. An inbox where every row is coloured
// is an inbox with no signal — CI noise outnumbers review requests most days.
const ACTIONABLE_REASONS = new Set(['review_requested', 'mention', 'assign', 'team_mention'])

const props = defineProps<{ item: GhNotification; author?: string }>()
const emit = defineEmits<{
  (e: 'open', item: GhNotification): void
  (e: 'external', item: GhNotification): void
  (e: 'read', id: string): void
}>()

const { t } = useI18n()
const now = useNow()

const typeIcon = computed(() =>
  props.item.type === 'PullRequest' ? 'fork' : props.item.type === 'Issue' ? 'info' : 'tag',
)
const actionable = computed(() => props.item.unread && ACTIONABLE_REASONS.has(props.item.reason))
const when = computed(() => formatRelativeAgo(props.item.updatedAt, t, now.value))
const author = computed(() => (props.author ? `@${props.author}` : ''))
// Full repo + title for the hover, since the clamp can still bite a very long one.
const hoverText = computed(() => {
  const ref = props.item.number != null ? ` #${props.item.number}` : ''
  return `${props.item.repo}${ref}\n${props.item.title}`
})
</script>

<style scoped>
.ntf-row {
  /* GRID, not flex, and deliberately so: `minmax(0, 1fr)` gives the text column a
     track that physically cannot exceed the space left over. The flex version
     wrapped correctly on Chromium 151 and overflowed on the Chromium 130 that
     Electron 33 ships (form controls keep an intrinsic min size, so `min-width: 0`
     never took). Grid tracks are computed from the container, so every engine lands
     on the same width. */
  display: grid;
  grid-template-columns: 6px 13px minmax(0, 1fr);
  column-gap: 6px;
  align-items: start;
  padding: 7px 6px 7px 4px;
  border-radius: 8px;
  overflow: hidden;
}
/* Rows are multi-line now, so they need a seam to read as separate items. With the
   unread tint that seam is the GAP, not a border: a hairline between two identically
   tinted blocks is invisible, and adjacent unread rows would merge into one slab.
   The hairline stays only where both neighbours are transparent (two read rows). */
.ntf-row + .ntf-row {
  margin-top: 4px;
}
.ntf-row.read + .ntf-row.read {
  margin-top: 0;
  border-top: 1px solid var(--border);
}
/* Unread rows carry an accent tint — the state you can see without reading a word.
   `color-mix` on the theme accent keeps it a derived value (no hardcoded colour) and
   lets hover deepen the SAME tint instead of replacing it with grey, which would
   have made a hovered unread row look less unread than its neighbours. */
.ntf-row:not(.read) {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.ntf-row:not(.read):hover {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
}
.ntf-row.read:hover {
  background: var(--bgHover);
}
.ntf-row-dot {
  width: 6px;
  height: 6px;
  margin-top: 6px;
  border-radius: 50%;
  background: transparent;
}
.ntf-row-dot.on {
  background: var(--accent);
}
.ntf-row-ic {
  width: 13px;
  height: 13px;
  margin-top: 2px;
  color: var(--textDim);
}
.ntf-row-ic.act {
  color: var(--accent);
}
.ntf-row-body {
  min-width: 0;
  overflow: hidden;
}
.ntf-row-main {
  display: block;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
}
/* Wrap, capped at 3 lines. `-webkit-box` + line-clamp is the recipe that works on
   Chromium 130 (the modern `line-clamp` property landed later). `anywhere` breaks
   the odd unbroken branch name instead of widening the row. */
.ntf-row-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  color: var(--text);
  /* Unread is the default state here (most rows), so weight is what separates a
     row that still wants something from one already handled. */
  font-weight: 600;
  overflow-wrap: anywhere;
}
/* Read rows stay in the list (that IS the read/unread distinction) but stop
   competing for attention. */
.ntf-row.read .ntf-row-title {
  color: var(--textDim);
  font-weight: 400;
}
.ntf-row-meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  min-width: 0;
  margin-top: 2px;
  overflow: hidden;
  font-size: 12px;
  /* NOT --textFaint: at 12px on the light theme's white that lands around 3.4:1,
     which is what read as "washed out" for the number/author/timestamp. */
  color: var(--textDim);
}
.ntf-row-num {
  flex: 0 0 auto;
}
.ntf-row-author {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--textMuted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ntf-row-reason {
  min-width: 0;
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ntf-row-reason.act {
  color: var(--accent);
}
.ntf-row-time {
  flex: 0 0 auto;
  margin-left: auto;
  white-space: nowrap;
}
.ntf-row-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.ntf-row-act {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
}
.ntf-row-act:hover {
  border-color: var(--borderStrong);
  background: var(--bgActive);
  color: var(--text);
}
.ntf-row-act.read:hover {
  border-color: var(--green);
  color: var(--green);
}
.ntf-row-act:focus-visible,
.ntf-row-main:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
