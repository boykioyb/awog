<template>
  <aside class="slk-list">
    <div class="flex flex-col gap-2 p-3">
      <Input v-model="ctx.search.value" :placeholder="t('slack.list.search')" />
      <div class="flex items-center gap-2">
        <AppSelect
          v-model="ctx.projectFilter.value"
          :options="ctx.projectOptions.value"
          size="sm"
          class="min-w-0 flex-1"
          width="100%"
          searchable
          :search-placeholder="t('slack.filter.searchProject')"
        />
        <Button size="sm" @click="ctx.addOpen.value = true">
          <Icon name="plus" />
          {{ t('slack.list.add') }}
        </Button>
      </div>
    </div>

    <div class="slk-tree">
      <div v-if="!ctx.tree.value.length" class="px-4 py-8 text-center text-sm text-dim">
        {{ ctx.store.threads.length ? t('slack.list.noMatch') : t('slack.list.empty') }}
      </div>
      <div v-for="team in ctx.tree.value" :key="team.key">
        <div
          class="slk-row slk-team"
          role="button"
          tabindex="0"
          :aria-expanded="!ctx.isCollapsed(team.key)"
          @click="ctx.toggleCollapsed(team.key)"
          @keydown.enter="ctx.toggleCollapsed(team.key)"
        >
          <Icon name="chev" class="slk-chev" :class="{ shut: ctx.isCollapsed(team.key) }" />
          <span class="truncate">{{ team.name }}</span>
        </div>
        <template v-if="!ctx.isCollapsed(team.key)">
          <div v-for="ch in team.channels" :key="ch.key">
            <div
              class="slk-row slk-ch"
              role="button"
              tabindex="0"
              :aria-expanded="!ctx.isCollapsed(ch.key)"
              @click="ctx.toggleCollapsed(ch.key)"
              @keydown.enter="ctx.toggleCollapsed(ch.key)"
            >
              <Icon name="chev" class="slk-chev" :class="{ shut: ctx.isCollapsed(ch.key) }" />
              <span class="truncate"># {{ ch.name }}</span>
            </div>
            <template v-if="!ctx.isCollapsed(ch.key)">
              <div
                v-for="item in ch.threads"
                :key="item.thread.id"
                class="slk-row slk-th"
                :class="{ on: item.thread.id === ctx.selectedId.value, unread: item.unread }"
                role="button"
                tabindex="0"
                :title="item.title"
                @click="ctx.select(item.thread.id)"
                @keydown.enter="ctx.select(item.thread.id)"
              >
                <Icon v-if="item.thread.error" name="alert" class="slk-thwarn" />
                <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
                <span v-if="item.unread" class="slk-dot" :aria-label="t('slack.list.unread')" />
                <span class="slk-when tnum">{{ item.when }}</span>
              </div>
            </template>
          </div>
        </template>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
// Cột trái: tìm, lọc project, thêm thread, và cây Workspace → #kênh → thread. Hàng
// thread đang chọn = accent-tint + thanh accent 2px; chưa đọc = chữ đậm + chấm cam.
import { useSlackCtx } from '~/composables/useSlackManager'

const { t } = useI18n()
const ctx = useSlackCtx()
</script>

<style scoped>
.slk-list {
  display: flex;
  flex-direction: column;
  flex: 0 0 380px;
  min-width: 0;
  background: var(--bgPanel);
  box-shadow: inset -1px 0 0 var(--border);
}
.slk-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 6px 12px;
}
.slk-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px;
  border-radius: var(--r-xs);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
  user-select: none;
}
.slk-row:hover {
  background: var(--bgHover);
}
.slk-row:focus-visible {
  outline: 1px solid var(--accentBorder);
}
.slk-team {
  font-weight: 600;
  color: var(--text);
}
.slk-ch {
  padding-left: 18px;
  color: var(--textDim);
}
.slk-th {
  position: relative;
  padding-left: 40px;
  color: var(--textDim);
}
.slk-th.unread {
  color: var(--text);
  font-weight: 600;
}
.slk-th.on {
  background: var(--accentDim);
  box-shadow: inset 0 0 0 1px var(--accentBorder);
  color: var(--text);
}
.slk-th.on::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: var(--r-pill);
  background: var(--accent);
}
.slk-chev {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex: none;
  transition: transform var(--dur-fast) var(--ease);
}
.slk-chev.shut {
  transform: rotate(-90deg);
}
.slk-thwarn {
  width: var(--icon-xs);
  height: var(--icon-xs);
  color: var(--danger);
  flex: none;
}
.slk-dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: var(--amber);
}
.slk-when {
  flex: none;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 400;
  color: var(--textFaint);
}
</style>
