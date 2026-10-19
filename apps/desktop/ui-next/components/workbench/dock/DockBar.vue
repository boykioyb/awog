<template>
  <!-- Dock bar: view tabs trái (Terminal·Tasks·+Team khi channel đa-agent;
       view 'Diff' đã gỡ — SCM trên explorer + doc diff cover) + hành động
       phải (thu / mở rộng / đóng). -->
  <div
    ref="rootEl"
    class="flex h-8.5 flex-none items-center gap-0.5 px-2.5 shadow-[inset_0_-1px_0_var(--border)]"
  >
    <!-- View tabs — shadcn Tabs (reka): model trên `wb.dockView`, trigger per
         view; chrome thu nhỏ cho thanh dock 34px (list h-6, trigger px 9). -->
    <Tabs :model-value="wb.dockView" class="flex-none" @update:model-value="onDockView">
      <TabsList class="h-6 gap-0.5 rounded-sm bg-transparent p-0">
        <TabsTrigger
          v-for="v in viewDefs"
          :key="v.id"
          :value="v.id"
          class="h-6 gap-1 rounded-sm px-2 text-xs font-normal text-dim hover:bg-accent hover:text-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none [&_svg]:size-3"
          :title="v.id"
        >
          <component :is="v.icon" class="shrink-0" :size="12" />
          <span>{{ v.id }}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
    <span class="flex-1" />
    <!-- Snippets của terminal — chỉ có nghĩa ở view Terminal. Bật = accent-tint. -->
    <Button
      v-if="wb.dockView === 'Terminal'"
      class="size-5.5 rounded-sm [&_svg]:size-3"
      :class="
        snippetsOpen
          ? 'bg-selected text-primary hover:bg-selected hover:text-primary'
          : 'text-dim hover:bg-accent hover:text-foreground'
      "
      variant="ghost"
      size="iconSm"
      type="button"
      :title="t('terminalSnippet.toggle')"
      :aria-label="t('terminalSnippet.toggle')"
      :aria-pressed="snippetsOpen"
      @click="toggleSnippets()"
    >
      <ScrollText :size="12" />
    </Button>
    <Button
      class="size-5.5 rounded-sm text-dim hover:bg-accent hover:text-foreground [&_svg]:size-3"
      variant="ghost"
      size="iconSm"
      type="button"
      title="Thu dock"
      @click="dock.collapseDock()"
    >
      <ChevronDown :size="12" />
    </Button>
    <Button
      class="size-5.5 rounded-sm text-dim hover:bg-accent hover:text-foreground [&_svg]:size-3"
      variant="ghost"
      size="iconSm"
      type="button"
      title="Mở rộng tối đa"
      @click="expand()"
    >
      <ChevronUp :size="12" />
    </Button>
    <Button
      class="size-5.5 rounded-sm text-dim hover:bg-accent hover:text-foreground [&_svg]:size-3"
      variant="ghost"
      size="iconSm"
      type="button"
      title="Đóng dock ⌘J"
      @click="wb.toggleDock(false)"
    >
      <X :size="12" />
    </Button>
    <Kbd class="ml-1.5 border bg-transparent text-faint">⌘J</Kbd>
  </div>
</template>

<script setup lang="ts">
// Slice D — dock chrome. Layout state ở `stores/workbench`; danh sách view
// (điều kiện Team) + expand/collapse ở `useWorkbenchDock`.
import type { Component } from 'vue'
import {
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Info,
  ListTodo,
  ScrollText,
  SquareTerminal,
  Users,
  X,
} from 'lucide-vue-next'
import { useWorkbenchDock } from '~/composables/useWorkbenchDock'
import { useGlobalTerminal } from '~/composables/useGlobalTerminal'
import { useGitStore } from '~/stores/git'
import { useSessionsStore } from '~/stores/sessions'
import { useWorkbenchStore } from '~/stores/workbench'
import type { DockView } from '~/types/workbench'

const wb = useWorkbenchStore()
const { t } = useI18n()
const { snippetsOpen, toggleSnippets } = useGlobalTerminal()
const dock = useWorkbenchDock()
const sessions = useSessionsStore()
const git = useGitStore()

const ICONS: Record<DockView, Component> = {
  Terminal: SquareTerminal,
  Tasks: ListTodo,
  Cost: CircleDollarSign,
  Info: Info,
  Team: Users,
}

const viewDefs = computed(() =>
  dock.dockViews.value.map((id: DockView) => ({
    id,
    icon: ICONS[id],
  })),
)

// Khi danh sách view mất Team (đổi session) mà đang chọn nó → về Terminal.
watch(dock.dockViews, (list) => {
  if (!list.includes(wb.dockView)) wb.dockView = 'Terminal'
})

// Scope git store theo project đang chọn để badge đếm đúng repo (idempotent;
// kẻ tiêu thụ ngoài Git page này chính là lý do `ensureScoped` tồn tại).
watch(
  () => sessions.activeTab,
  (tab) => {
    if (tab) void git.ensureScoped(tab)
  },
  { immediate: true },
)

// Stage = hộp flex chứa dock; trần mở rộng = min(480, 60% stage). Đo hộp CHA của
// `<section data-wb-dock>`, KHÔNG phải cha trực tiếp của bar: cha trực tiếp chính là
// section dock (cao = dockH) ⇒ mỗi lần bấm dock co còn 60% của chính nó, rơi về 34
// rồi kẹt ở đó (60% × 34 < 34) — nút "mở rộng" lại thu dock và không mở ra được nữa.
const rootEl = useTemplateRef<HTMLElement>('rootEl')
function expand(): void {
  dock.expandDock(rootEl.value?.closest('[data-wb-dock]')?.parentElement?.clientHeight)
}

// reka Tabs emits AcceptableValue (string|number) — v-model value lại là
// DockView, nên cast ở đây thay vì `as` trong template.
function onDockView(v: string | number): void {
  wb.dockView = v as DockView
}
</script>
