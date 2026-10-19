<template>
  <!-- View "Issues" của Explorer — mọi việc trên board theo status (đang làm · bị chặn ·
       tạm dừng · chờ review…), phiên lẫn team chỉ là người thực thi
       (docs/features/session-issue-tracking.md). Bấm issue = mở phiên gần nhất làm
       nó; chuột phải = phiên mới / recap / mở trên board. -->
  <div class="relative flex min-h-0 flex-1 flex-col">
    <div class="flex h-11 flex-none items-center gap-1 px-2 shadow-[inset_0_-1px_0_var(--border)]">
      <span
        class="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-sm border border-border bg-muted px-2.5 text-faint"
      >
        <Icon name="search" class="size-4 flex-none" />
        <Input
          v-model="query"
          class="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          type="search"
          :placeholder="t('wb.issues.search')"
        />
      </span>
      <ScmIconBtn
        class="size-6"
        type="button"
        :active="allProjects"
        :title="allProjects ? t('wb.issues.scopeAll') : t('wb.issues.scopeProject')"
        @click="allProjects = !allProjects"
      >
        <Icon name="layers" class="size-4" />
      </ScmIconBtn>
      <ScmIconBtn class="size-6" type="button" :title="t('wb.issues.refresh')" @click="reload()">
        <Icon name="refresh" class="size-4" />
      </ScmIconBtn>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-1">
      <div v-if="!groups.length" class="px-2 py-2.5 text-sm text-faint">
        {{ query.trim() ? t('sessions.list.noMatch') : t('wb.issues.empty') }}
      </div>
      <section v-for="g in groups" :key="g.status" class="mb-1">
        <!-- Header nhóm = hàng bấm thu/mở (không phải control form) — row raw được
             phép theo workbench-ui.md. -->
        <div
          class="flex h-6.5 cursor-pointer select-none items-center gap-1.5 rounded-sm px-1.5 text-xs text-dim hover:bg-accent"
          role="button"
          tabindex="0"
          :aria-expanded="!collapsed.has(g.status)"
          @click="toggleGroup(g.status)"
          @keydown.enter.prevent="toggleGroup(g.status)"
        >
          <Icon
            name="chev"
            class="size-3 flex-none transition-transform"
            :class="{ '-rotate-90': collapsed.has(g.status) }"
          />
          <!-- Chấm màu status — màu theo status do statusColor() trả (dữ liệu). -->
          <span
            class="size-2 flex-none rounded-full"
            :style="{ background: statusColor(g.status) }"
          />
          <span class="font-medium">{{ statusLabel(g.status) }}</span>
          <span class="tabular-nums text-faint">{{ g.items.length }}</span>
        </div>
        <template v-if="!collapsed.has(g.status)">
          <div
            v-for="it in g.items"
            :key="`${it.projectId}:${it.id}`"
            class="flex h-7.5 cursor-pointer items-center gap-2 rounded-sm pl-6 pr-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            :title="it.recap?.text ?? it.title"
            role="button"
            tabindex="0"
            @click="openIssue(it)"
            @keydown.enter.prevent="openIssue(it)"
            @contextmenu.prevent="ctx.open($event, it)"
          >
            <span class="min-w-0 flex-1 truncate">{{ it.title }}</span>
            <span
              v-if="isStale(it)"
              class="flex-none text-xs text-warning"
              :title="t('wb.issues.staleTitle')"
            >
              {{ t('wb.issues.stale', { n: ageDays(it) }) }}
            </span>
            <span v-if="allProjects" class="max-w-[40%] flex-none truncate text-xs text-faint">
              {{ projectName(it.projectId) }}
            </span>
          </div>
        </template>
      </section>
    </div>

    <Teleport to="body">
      <AppContextMenu
        :open="ctx.pos.value !== null"
        :position="ctx.pos.value ?? { x: 0, y: 0 }"
        :items="menuItems"
        @close="ctx.close()"
        @select="onMenuSelect"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import Input from '~/components/ui/input/Input.vue'
import AppContextMenu from '~/components/common/AppContextMenu.vue'
import ScmIconBtn from './ScmIconBtn.vue'

const { t } = useI18n()
const { statusLabel, statusColor } = useIssueStatus()
const {
  query,
  allProjects,
  collapsed,
  groups,
  isStale,
  ageDays,
  toggleGroup,
  projectName,
  openIssue,
  ctx,
  menuItems,
  onMenuSelect,
  reload,
} = useIssuesView()
</script>
