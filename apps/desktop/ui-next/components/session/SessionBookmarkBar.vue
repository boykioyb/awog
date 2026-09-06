<template>
  <!-- "Bookmarked (N)" — the reading index of a long session, docked directly above the
       transcript (spec §6.1). It lives in SessionDetail, NOT inside SessionTranscript,
       so the SSH co-pilot (which mounts the same transcript) does not grow one too.

       With no bookmarks it is ABSENT FROM THE DOM, not hidden: the transcript must not
       lose a single pixel of height to a feature the user isn't using (AC-B7). It also
       waits for `loaded` — excerpts are derived from the messages, so before the
       transcript arrives there is nothing to show. -->
  <div v-if="session.loaded && count" class="bmb">
    <div class="bmb-head">
      <button
        type="button"
        class="bmb-toggle"
        :title="expanded ? t('sessions.bookmark.collapse') : t('sessions.bookmark.expand')"
        @click="expanded = !expanded"
      >
        <Icon name="chev" class="bmb-chev" :class="{ open: expanded }" />
        <Icon name="bookmark" class="bmb-ic" />
        <span class="bmb-title">{{ t('sessions.bookmark.barTitle') }}</span>
      </button>
      <!-- Collapsed: the newest bookmark rides in the same row, so the bar costs ONE
           line until the user asks for the list. -->
      <button
        v-if="!expanded && latest"
        type="button"
        class="bmb-peek"
        :class="{ dead: latest.dangling }"
        :disabled="latest.dangling"
        :title="latest.dangling ? t('sessions.bookmark.dangling') : t('sessions.bookmark.jump')"
        @click="onJump(latest)"
      >
        {{ latest.excerpt }}
      </button>
      <span class="bmb-n">{{ count }}</span>
    </div>
    <div v-if="expanded" class="bmb-list">
      <div v-for="row in rows" :key="row.id" class="bmb-row" :class="{ dead: row.dangling }">
        <!-- `disabled` is the whole of AC-B14: a dangling row swallows both the click
             and Enter, so it can never scroll to some other message. -->
        <button
          type="button"
          class="bmb-jump"
          :disabled="row.dangling"
          :title="row.dangling ? t('sessions.bookmark.dangling') : t('sessions.bookmark.jump')"
          @click="onJump(row)"
        >
          <span class="bmb-ex">{{ row.excerpt }}</span>
          <span class="bmb-when">{{ formatRelativeAgo(row.at, t, now) }}</span>
        </button>
        <button
          type="button"
          class="bmb-act dgr"
          :title="
            row.dangling ? t('sessions.bookmark.danglingRemove') : t('sessions.bookmark.remove')
          "
          @click="remove(row)"
        >
          <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Bookmark bar for the active session. All state (resolve map, sorting, excerpts,
// dangling) lives in useSessionBookmarks; this file is the markup for it.
import type { Session } from '~/composables/useSessionsData'
import type { BookmarkRow } from '~/composables/useSessionBookmarks'
import { formatRelativeAgo } from '~/utils/relative-time'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const now = useNow()

const { rows, count, latest, expanded, jump, remove } = useSessionBookmarks(() => props.session)

// Chọn một mục cũng thu thanh lại (AC-B6): sau khi đã nhảy tới đích thì danh
// sách mở rộng chỉ còn che transcript. Thu NGAY, không chờ `jump` — nó await
// reveal + nextTick, để tới đó mới thu thì thanh giật một nhịp sau cú click.
const onJump = (row: BookmarkRow) => {
  expanded.value = false
  void jump(row)
}
</script>

<style scoped>
.bmb {
  flex: 0 0 auto;
  margin: 10px 14px 0;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgEl);
}
.bmb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  min-width: 0;
}
.bmb-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  color: var(--text);
  font-size: 1em;
  font-weight: 600;
  user-select: none;
}
.bmb-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--accent);
}
.bmb-chev {
  width: var(--icon-xs);
  height: var(--icon-xs);
  color: var(--textDim);
  transform: rotate(-90deg);
  transition: transform 0.15s var(--ease, ease);
}
.bmb-chev.open {
  transform: none;
}
.bmb-peek {
  flex: 1 1 auto;
  min-width: 0;
  text-align: left;
  font-size: 1em;
  color: var(--textDim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bmb-peek:hover:not(:disabled) {
  color: var(--text);
}
/* Badge, not body text: fixed 12px so it stays a compact pill at any base font size. */
.bmb-n {
  margin-left: auto;
  flex: 0 0 auto;
  min-width: 18px;
  padding: 2px 4px;
  border-radius: var(--r-xs);
  background: var(--accentDim, var(--bgHover));
  color: var(--accent);
  font-family: var(--code, monospace);
  font-size: 12px;
  line-height: 1;
  text-align: center;
}
.bmb-list {
  display: flex;
  flex-direction: column;
  padding: 0 6px 6px;
}
.bmb-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 4px;
  border-radius: var(--r-xs);
  min-width: 0;
}
.bmb-row:hover {
  background: var(--bgHover);
}
.bmb-jump {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 0;
  text-align: left;
  color: var(--text);
  font-size: 1em;
}
.bmb-ex {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bmb-when {
  flex: 0 0 auto;
  color: var(--textDim);
  font-size: 12px;
  line-height: 1;
  font-family: var(--code, monospace);
}
/* Dangling: dimmed and inert — the anchor stays on disk, only the jump is gone. */
.bmb-row.dead,
.bmb-peek.dead {
  opacity: 0.55;
}
.bmb-jump:disabled,
.bmb-peek:disabled {
  cursor: default;
}
.bmb-row.dead .bmb-ex {
  font-style: italic;
}
.bmb-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding: 6px;
  border-radius: var(--r-xs);
  color: var(--textDim);
  transition:
    color 0.12s var(--ease, ease),
    background 0.12s var(--ease, ease);
}
.bmb-act.dgr:hover {
  background: var(--dangerBg, var(--bgHover));
  color: var(--danger);
}
</style>
