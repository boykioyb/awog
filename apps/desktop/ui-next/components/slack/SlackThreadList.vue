<template>
  <!-- basis-95 = bề rộng mặc định; SlackWorkspace đè flex-basis inline khi kéo. -->
  <aside class="flex min-w-0 flex-none basis-95 flex-col border-r bg-sidebar">
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

    <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
      <div v-if="!ctx.tree.value.length" class="px-4 py-8 text-center text-sm text-dim">
        {{ ctx.store.threads.length ? t('slack.list.noMatch') : t('slack.list.empty') }}
      </div>
      <div v-for="team in ctx.tree.value" :key="team.key">
        <div
          class="flex h-ctrl-xs cursor-pointer select-none items-center gap-1.5 rounded-sm px-2 text-sm hover:bg-accent focus-visible:outline-1 focus-visible:outline-selected-border font-semibold text-foreground"
          role="button"
          tabindex="0"
          :aria-expanded="!ctx.isCollapsed(team.key)"
          @click="ctx.toggleCollapsed(team.key)"
          @keydown.enter="ctx.toggleCollapsed(team.key)"
        >
          <Icon
            name="chev"
            class="size-3 flex-none transition-transform duration-150"
            :class="{ '-rotate-90': ctx.isCollapsed(team.key) }"
          />
          <span class="truncate">{{ team.name }}</span>
        </div>
        <template v-if="!ctx.isCollapsed(team.key)">
          <div v-for="ch in team.channels" :key="ch.key">
            <div
              class="flex h-ctrl-xs cursor-pointer select-none items-center gap-1.5 rounded-sm px-2 text-sm hover:bg-accent focus-visible:outline-1 focus-visible:outline-selected-border pl-4.5 text-dim"
              role="button"
              tabindex="0"
              :aria-expanded="!ctx.isCollapsed(ch.key)"
              @click="ctx.toggleCollapsed(ch.key)"
              @keydown.enter="ctx.toggleCollapsed(ch.key)"
            >
              <Icon
                name="chev"
                class="size-3 flex-none transition-transform duration-150"
                :class="{ '-rotate-90': ctx.isCollapsed(ch.key) }"
              />
              <span class="truncate"># {{ ch.name }}</span>
            </div>
            <template v-if="!ctx.isCollapsed(ch.key)">
              <div
                v-for="item in ch.threads"
                :key="item.thread.id"
                class="flex h-ctrl-xs cursor-pointer select-none items-center gap-1.5 rounded-sm px-2 text-sm hover:bg-accent focus-visible:outline-1 focus-visible:outline-selected-border relative pl-10"
                :class="[
                  item.thread.id === ctx.selectedId.value ? SELECTED : 'text-dim',
                  { 'font-semibold text-foreground': item.unread },
                ]"
                role="button"
                tabindex="0"
                :title="item.title"
                @click="ctx.select(item.thread.id)"
                @keydown.enter="ctx.select(item.thread.id)"
              >
                <Icon
                  v-if="item.thread.error"
                  name="alert"
                  class="size-3 flex-none text-destructive"
                />
                <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
                <span
                  v-if="item.unread"
                  class="size-2 flex-none rounded-full bg-warning"
                  :aria-label="t('slack.list.unread')"
                />
                <span class="tnum flex-none text-xs font-normal text-faint">{{ item.when }}</span>
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

// Hàng đang chọn: accent-tint + viền + thanh accent 2px bên trái.
const SELECTED =
  "bg-selected text-foreground ring-1 ring-inset ring-selected-border before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary before:content-['']"
</script>
