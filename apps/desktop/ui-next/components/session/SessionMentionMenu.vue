<template>
  <div class="slashint">
    <div class="silabel">{{ t('sessions.composer.mentionTitle') }}</div>
    <div class="silist">
      <div
        v-for="(m, i) in items"
        :key="m.key"
        class="si2"
        :class="{ on: i === active }"
        @mousedown.prevent="emit('select', i)"
        @mouseenter="emit('hover', i)"
      >
        <span class="sc" :style="glyphStyle(m.kind)">@</span>
        <span class="sd mlabel">{{ m.label }}</span>
        <span v-if="m.hint" class="sd mhint">{{ m.hint }}</span>
        <span class="sd mtag">{{ t(TAG_KEY[m.kind]) }}</span>
      </div>
    </div>
    <div class="sifoot">{{ t('sessions.composer.mentionHint') }}</div>
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
const GLYPH_COLOR: Partial<Record<MentionRow['kind'], string>> = {
  agent: 'var(--violet)',
  team: 'var(--accent)',
  skill: 'var(--info)',
  wiki: 'var(--primary)',
  // `@page` là hành động (chèn trang đang mở trong trình duyệt nhúng), không phải một
  // thực thể có tên — dùng chung primary với wiki cho khỏi thêm màu thứ tư.
  page: 'var(--primary)',
}
const glyphStyle = (kind: MentionRow['kind']) => {
  const color = GLYPH_COLOR[kind]
  return color ? { color } : undefined
}
</script>

<style scoped>
/* Popover chrome — shadcn tokens: popover surface + hairline border + --radius +
   mid shadow, dense p-1 item padding. Label + footer hint pin outside the scroll
   region (proto menu idiom: header label, footer hint). */
.slashint {
  display: flex;
  flex-direction: column;
  max-height: min(340px, 42vh);
  padding: 4px;
  background: var(--popover);
  border-color: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
}
.silist {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
/* Header label (DropdownMenuLabel tone) + footer hint strip. */
.silabel {
  flex: 0 0 auto;
  padding: 5px 8px 4px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 500;
  color: var(--muted-foreground);
}
.sifoot {
  flex: 0 0 auto;
  margin-top: 2px;
  padding: 5px 8px 3px;
  border-top: 1px solid var(--border);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
/* Rows: compact rounded-sm items; active = neutral wash (bg-accent idiom), no
   accent bar. Nested under .silist so scoped rules beat the global
   `.slashint .si2` / `.slashint .sd` (equal specificity otherwise). */
.silist .si2 {
  padding: 5px 8px;
  border-radius: var(--r-xs);
}
.silist .si2.on {
  background: var(--accent-wash);
}
/* The agent name / file basename takes the row; path hint + kind tag pin right. */
.silist .mlabel {
  color: var(--foreground);
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.silist .mhint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted-foreground);
  font-size: 12px;
  line-height: 18px;
}
.silist .mtag {
  flex: 0 0 auto;
  color: var(--textFaint);
}
</style>
