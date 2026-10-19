<template>
  <!-- "Bookmarked (N)" — the reading index of a long session, docked directly above the
       transcript (spec §6.1). It lives in SessionDetail, NOT inside SessionTranscript,
       so the SSH co-pilot (which mounts the same transcript) does not grow one too.

       With no bookmarks it is ABSENT FROM THE DOM, not hidden: the transcript must not
       lose a single pixel of height to a feature the user isn't using (AC-B7). It also
       waits for `loaded` — excerpts are derived from the messages, so before the
       transcript arrives there is nothing to show. -->
  <!-- Biến thể `chip` (session-ui-refactor §3.2): đánh dấu sống trong hàng ngữ cảnh
       dùng chung. Luật AC-B7 giữ nguyên — không có đánh dấu thì VẮNG MẶT khỏi DOM,
       không phải ẩn. -->
  <span v-if="variant === 'chip' && session.loaded && count" class="relative inline-flex shrink-0">
    <SessionCtxChip
      ref="chipRef"
      icon="bookmark"
      chev
      :on="expanded"
      :title="t('sessions.bookmark.barTitle')"
      @click.stop="expanded = !expanded"
    >
      <!-- Huy hiệu, không phải chữ thân: cỡ cố định để vẫn là viên gọn ở mọi cỡ chữ. -->
      <span
        class="ml-auto min-w-4.5 shrink-0 rounded-sm bg-primary/14 px-1 py-0.5 text-center text-sm leading-3 text-primary tabular-nums"
      >
        {{ count }}
      </span>
    </SessionCtxChip>
    <Teleport to="body">
      <div v-if="expanded" class="fixed inset-0 z-40" @click="expanded = false" />
      <SessionCtxPop v-if="expanded" ref="popRef" class="w-80" :style="popStyle" @click.stop>
        <div class="mb-2 flex justify-between text-sm text-dim">
          {{ t('sessions.bookmark.barTitle') }}
        </div>
        <div class="flex flex-col">
          <div
            v-for="row in rows"
            :key="row.id"
            class="flex min-w-0 items-center gap-1 rounded-sm px-1 py-px hover:bg-accent"
            :class="row.dangling && 'opacity-55'"
          >
            <!-- `disabled` is the whole of AC-B14: a dangling row swallows both the click
                 and Enter, so it can never scroll to some other message. -->
            <Button
              variant="ghost"
              class="h-auto min-w-0 flex-auto justify-start gap-2.5 px-0 py-1 text-left text-base font-normal text-foreground hover:bg-transparent disabled:cursor-default disabled:opacity-100"
              :disabled="row.dangling"
              :title="row.dangling ? t('sessions.bookmark.dangling') : t('sessions.bookmark.jump')"
              @click="onJump(row)"
            >
              <span class="min-w-0 flex-auto truncate" :class="row.dangling && 'italic'">
                {{ row.excerpt }}
              </span>
              <span class="shrink-0 text-sm leading-3 text-muted-foreground tabular-nums">
                {{ formatRelativeAgo(row.at, t, now) }}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="iconSm"
              class="shrink-0 text-muted-foreground hover:bg-destructive/14 hover:text-destructive"
              :title="
                row.dangling ? t('sessions.bookmark.danglingRemove') : t('sessions.bookmark.remove')
              "
              :aria-label="
                row.dangling ? t('sessions.bookmark.danglingRemove') : t('sessions.bookmark.remove')
              "
              @click="remove(row)"
            >
              <Icon name="x" class="size-3.5" />
            </Button>
          </div>
        </div>
      </SessionCtxPop>
    </Teleport>
  </span>

  <div
    v-else-if="variant === 'bar' && session.loaded && count"
    class="mx-3.5 mt-2.5 shrink-0 rounded-lg border bg-card"
  >
    <div class="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
      <Button
        variant="ghost"
        class="h-auto shrink-0 gap-2 p-0 text-base font-semibold text-foreground select-none hover:bg-transparent"
        :title="expanded ? t('sessions.bookmark.collapse') : t('sessions.bookmark.expand')"
        @click="expanded = !expanded"
      >
        <Icon
          name="chev"
          class="size-3 text-muted-foreground transition-transform"
          :class="!expanded && '-rotate-90'"
        />
        <Icon name="bookmark" class="size-3.5 text-primary" />
        <span>{{ t('sessions.bookmark.barTitle') }}</span>
      </Button>
      <!-- Collapsed: the newest bookmark rides in the same row, so the bar costs ONE
           line until the user asks for the list. -->
      <Button
        v-if="!expanded && latest"
        variant="ghost"
        class="h-auto min-w-0 flex-auto justify-start p-0 text-left text-base font-normal text-muted-foreground hover:bg-transparent hover:text-foreground disabled:cursor-default"
        :class="latest.dangling && 'opacity-55 disabled:opacity-55'"
        :disabled="latest.dangling"
        :title="latest.dangling ? t('sessions.bookmark.dangling') : t('sessions.bookmark.jump')"
        @click="onJump(latest)"
      >
        <span class="truncate">{{ latest.excerpt }}</span>
      </Button>
      <span
        class="ml-auto min-w-4.5 shrink-0 rounded-sm bg-primary/14 px-1 py-0.5 text-center text-sm leading-3 text-primary tabular-nums"
      >
        {{ count }}
      </span>
    </div>
    <div v-if="expanded" class="flex flex-col px-1.5 pb-1.5">
      <div
        v-for="row in rows"
        :key="row.id"
        class="flex min-w-0 items-center gap-1 rounded-sm px-1 py-px hover:bg-accent"
        :class="row.dangling && 'opacity-55'"
      >
        <!-- `disabled` is the whole of AC-B14: a dangling row swallows both the click
             and Enter, so it can never scroll to some other message. -->
        <Button
          variant="ghost"
          class="h-auto min-w-0 flex-auto justify-start gap-2.5 px-0 py-1 text-left text-base font-normal text-foreground hover:bg-transparent disabled:cursor-default disabled:opacity-100"
          :disabled="row.dangling"
          :title="row.dangling ? t('sessions.bookmark.dangling') : t('sessions.bookmark.jump')"
          @click="onJump(row)"
        >
          <span class="min-w-0 flex-auto truncate" :class="row.dangling && 'italic'">
            {{ row.excerpt }}
          </span>
          <span class="shrink-0 text-sm leading-3 text-muted-foreground tabular-nums">
            {{ formatRelativeAgo(row.at, t, now) }}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="shrink-0 text-muted-foreground hover:bg-destructive/14 hover:text-destructive"
          :title="
            row.dangling ? t('sessions.bookmark.danglingRemove') : t('sessions.bookmark.remove')
          "
          :aria-label="
            row.dangling ? t('sessions.bookmark.danglingRemove') : t('sessions.bookmark.remove')
          "
          @click="remove(row)"
        >
          <Icon name="x" class="size-3.5" />
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Bookmark bar for the active session. All state (resolve map, sorting, excerpts,
// dangling) lives in useSessionBookmarks; this file is the markup for it.
import type { Session } from '~/composables/useSessionsData'
import type { BookmarkRow } from '~/composables/useSessionBookmarks'
import { usePopoverAnchor } from '~/composables/usePopoverAnchor'
import { formatRelativeAgo } from '~/utils/relative-time'

const props = withDefaults(defineProps<{ session: Session; variant?: 'bar' | 'chip' }>(), {
  variant: 'bar',
})
const { t } = useI18n()
const now = useNow()

const { rows, count, latest, expanded, jump, remove } = useSessionBookmarks(() => props.session)

// Chip nằm trên hàng header `.dh` — neo fixed + kẹp viewport (align 'right' giữ
// thói quen neo mép phải của popover cũ, nhưng giờ sát mép nào cũng không tràn).
// Chip + popover là component (Button / SessionCtxPop) ⇒ template ref là instance,
// phần tử DOM nằm ở `$el`.
const chipRef = useTemplateRef<{ $el: HTMLElement }>('chipRef')
const popRef = useTemplateRef<{ $el: HTMLElement }>('popRef')
const chipEl = computed(() => chipRef.value?.$el ?? null)
const popEl = computed(() => popRef.value?.$el ?? null)
const { style: popStyle } = usePopoverAnchor(chipEl, popEl, expanded, {
  align: 'right',
  maxHeight: 340,
})

// Chọn một mục cũng thu thanh lại (AC-B6): sau khi đã nhảy tới đích thì danh
// sách mở rộng chỉ còn che transcript. Thu NGAY, không chờ `jump` — nó await
// reveal + nextTick, để tới đó mới thu thì thanh giật một nhịp sau cú click.
const onJump = (row: BookmarkRow) => {
  expanded.value = false
  void jump(row)
}
</script>
