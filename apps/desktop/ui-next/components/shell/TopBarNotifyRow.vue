<template>
  <!-- GRID, not flex, and deliberately so: `minmax(0, 1fr)` gives the text column a
       track that physically cannot exceed the space left over. The flex version
       wrapped correctly on Chromium 151 and overflowed on the Chromium 130 that
       Electron 33 ships. Grid tracks are computed from the container, so every
       engine lands on the same width.
       Hàng chưa đọc mang tint accent (đậm thêm khi hover, không đổi sang xám); hai
       hàng ĐÃ đọc liền nhau thì ngăn bằng hairline, còn lại ngăn bằng khe 4px —
       hairline giữa hai khối cùng tint thì vô hình. -->
  <div
    data-ntf-row
    :data-read="item.unread ? undefined : ''"
    class="grid grid-cols-[--spacing(1.5)_--spacing(3.5)_minmax(0,1fr)] items-start gap-x-1.5 overflow-hidden rounded-sm py-2 pr-1.5 pl-1 [[data-ntf-row]+&]:mt-1 [[data-ntf-row][data-read]+&[data-read]]:mt-0 [[data-ntf-row][data-read]+&[data-read]]:rounded-none [[data-ntf-row][data-read]+&[data-read]]:border-t"
    :class="item.unread ? 'bg-primary/8 hover:bg-primary/15' : 'hover:bg-accent'"
  >
    <!-- Unread marker. Always occupies its slot so read and unread rows stay aligned
         — the dot appearing/disappearing must not shift the text next to it. -->
    <span class="mt-1.5 size-1.5 rounded-full" :class="item.unread && 'bg-primary'" />
    <Icon
      :name="typeIcon"
      class="mt-0.5 size-3.5"
      :class="actionable ? 'text-primary' : 'text-dim'"
    />
    <div class="min-w-0 overflow-hidden">
      <!-- Title WRAPS (clamped at 3 lines): a truncated GitHub title usually loses
           the part that says what changed. The row lives inside a per-repo group
           (TopBarNotifications), so the repo name is not repeated here. -->
      <!-- raw-ok: vùng bấm cả khối tiêu đề + dòng meta nhiều dòng — Button là inline-flex một dòng -->
      <button
        class="block w-full min-w-0 cursor-pointer overflow-hidden rounded-xs text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        type="button"
        :title="hoverText"
        @click="emit('open', item)"
      >
        <!-- Chưa đọc là trạng thái mặc định (đa số hàng), nên ĐỘ ĐẬM là thứ tách hàng
             còn cần việc khỏi hàng đã xử lý. -->
        <span
          class="line-clamp-3 wrap-anywhere"
          :class="item.unread ? 'font-semibold text-foreground' : 'font-normal text-dim'"
        >
          {{ item.title }}
        </span>
        <!-- KHÔNG text-faint: chữ 12px trên nền trắng của theme sáng chỉ ~3.4:1. -->
        <span
          class="mt-0.5 flex w-full min-w-0 items-baseline gap-1.5 overflow-hidden text-sm text-dim"
        >
          <span v-if="item.number != null" class="shrink-0 tabular-nums">#{{ item.number }}</span>
          <!-- Who opened it. Sits BEFORE the reason so it is never the first thing
               truncated — "whose PR is this" is the question the row gets asked. -->
          <span
            v-if="author"
            class="min-w-0 shrink truncate text-muted-foreground"
            :title="t('github.inbox.author', { login: author })"
          >
            {{ author }}
          </span>
          <span class="min-w-0 truncate" :class="actionable && 'text-primary'">
            {{ reasonLabel(item.reason) }}
          </span>
          <span class="ml-auto shrink-0 whitespace-nowrap">{{ when }}</span>
        </span>
      </button>
      <!-- Actions on their OWN line, with labels: always visible, never competing
           with the title for width, and no icon the user has to decode. -->
      <div class="mt-1.5 flex flex-wrap gap-1">
        <Button
          v-if="item.unread"
          variant="outline"
          size="xs"
          class="h-auto px-2 py-0.5 text-sm font-normal text-dim hover:border-success hover:bg-transparent hover:text-success"
          @click.stop="emit('read', item.id)"
        >
          <Icon name="check" />
          <span>{{ t('github.inbox.markRead') }}</span>
        </Button>
        <Button
          variant="outline"
          size="xs"
          class="h-auto px-2 py-0.5 text-sm font-normal text-dim"
          @click.stop="emit('external', item)"
        >
          <Icon name="external" />
          <span>{{ t('github.inbox.openExternal') }}</span>
        </Button>
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
