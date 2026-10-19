<template>
  <!-- Khung popover: bề mặt popover + hairline + bóng vừa, item dày p-1. Nhãn đầu +
       gợi ý cuối ghim ngoài vùng cuộn. -->
  <div
    class="mb-2 flex max-h-[min(340px,42vh)] flex-col overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
  >
    <div class="flex-none px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">
      {{ t('sessions.composer.mentionTitle') }}
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div
        v-for="(m, i) in items"
        :key="m.key"
        class="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1 text-sm"
        :class="{ 'bg-accent text-accent-foreground': i === active }"
        @mousedown.prevent="emit('select', i)"
        @mouseenter="emit('hover', i)"
      >
        <!-- mono-ok: `@` là ký tự người dùng gõ nguyên văn -->
        <span class="font-mono" :class="GLYPH_CLASS[m.kind] ?? 'text-primary'">@</span>
        <!-- Tên agent / basename file chiếm hàng; hint path + tag loại ghim phải. -->
        <span class="shrink truncate text-foreground">{{ m.label }}</span>
        <span v-if="m.hint" class="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {{ m.hint }}
        </span>
        <span class="flex-none text-faint">
          {{ t(TAG_KEY[m.kind]) }}
        </span>
      </div>
    </div>
    <div class="mt-0.5 flex-none border-t px-2 pt-1 pb-0.5 text-xs text-faint">
      {{ t('sessions.composer.mentionHint') }}
    </div>
  </div>
</template>

<script setup lang="ts">
// `@`-mention dropdown (§2). Hàng đầu là HÀNH ĐỘNG `@page` (chèn trang đang mở trong
// trình duyệt nhúng — ADR 0086), phần còn lại là thực thể.
// Real sources: enabled session agents (agents.list),
// skills in both tiers (skills.list — ADR 0070), wiki pages in the session's scope
// (wiki.tree, ADR 0073), and the workspace file index (fs.listFiles,
// .gitignore-aware). The composer owns the textarea + arrow-key nav and passes
// `active` down; this renders + emits select(index)/hover only. Insert token =
// `@<insert>` (agent handle / `skill:<id>` / `wiki:<slug>` / file path).
import type { MentionRow } from './session-composer-commands'

defineProps<{ items: MentionRow[]; active: number }>()
const emit = defineEmits<{
  select: [i: number]
  hover: [i: number]
}>()
const { t } = useI18n()

// Kind → right-hand tag label + `@` glyph accent. A map (not a ternary chain) so
// adding a mention kind is one line and the two stay in sync.
const TAG_KEY: Record<MentionRow['kind'], string> = {
  agent: 'sessions.composer.mentionAgent',
  team: 'sessions.composer.mentionTeam',
  skill: 'sessions.composer.mentionSkill',
  wiki: 'sessions.composer.mentionWiki',
  file: 'sessions.composer.mentionFile',
  page: 'sessions.composer.mentionPage',
}
const GLYPH_CLASS: Partial<Record<MentionRow['kind'], string>> = {
  agent: 'text-lavender',
  team: 'text-primary',
  skill: 'text-info',
  wiki: 'text-primary',
  // `@page` là hành động (chèn trang đang mở trong trình duyệt nhúng), không phải một
  // thực thể có tên — dùng chung primary với wiki cho khỏi thêm màu thứ tư.
  page: 'text-primary',
}
</script>
