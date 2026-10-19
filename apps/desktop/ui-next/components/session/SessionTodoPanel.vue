<template>
  <!-- Biến thể `chip` (session-ui-refactor §3.2): checklist sống trong hàng ngữ cảnh
       dùng chung thay vì một dải riêng chiếm trọn bề ngang. Hành vi giữ nguyên luật
       của ADR 0069 — chip KHÔNG tự ẩn khi xong, và nó không tự bung: danh sách đầy
       đủ vẫn là một cú bấm, y như strip `done/total` trước đây. -->
  <span
    v-if="variant === 'chip' && bannerVisible && !dismissed"
    class="relative inline-flex flex-none"
  >
    <Button
      ref="chipEl"
      type="button"
      variant="outline"
      size="xs"
      class="h-5.5 gap-1.5 rounded-md px-2.5 font-normal text-dim shadow-none hover:text-foreground [&_svg]:size-3"
      :class="{
        'border-selected-border text-primary': allDone || popOpen,
        'bg-selected': popOpen,
      }"
      :title="t('sessions.todo.title')"
      @click.stop="popOpen = !popOpen"
    >
      <Icon :name="allDone ? 'check' : 'tasks'" />
      <span class="tabular-nums">{{ doneCount }}/{{ total }}</span>
      <Icon name="chev" />
    </Button>
    <Teleport to="body">
      <div v-if="popOpen" class="fixed inset-0 z-40" @click="popOpen = false" />
      <!-- Neo `fixed` qua usePopoverAnchor. -->
      <!-- role=dialog + data-state=open: khớp selector `[role="dialog"][data-state="open"]`
           trong OVERLAYS (useEmbeddedBrowser.ts) để trình duyệt nhúng nhường chỗ. -->
      <div
        v-if="popOpen"
        ref="popEl"
        role="dialog"
        data-state="open"
        class="fixed z-130 w-85 overflow-y-auto rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
        :style="popStyle"
        @click.stop
      >
        <div class="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          {{ t('sessions.todo.title') }}
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            class="ml-auto size-5 text-dim [&_svg]:size-3"
            :title="t('sessions.todo.hide')"
            @click="hide"
          >
            <Icon name="x" />
          </Button>
        </div>
        <SessionTodoList :todos="todos" editable @cycle="cycleTodo" />
      </div>
    </Teleport>
  </span>

  <!-- Session-level pinned checklist. Docked above the composer, it shows the LATEST
       TodoWrite and stays available for as long as the session has one — including
       after the turn ends, which is exactly when the user needs to see where work
       stopped. It opens as a one-line `done/total` strip and NEVER expands itself:
       the full list is a click away, or in the Plan & Progress tab / the inline
       transcript step. The × dismisses it for this session.
       Rows are editable — a click cycles a row's status (see useSessionTodo). -->
  <!-- Biến thể bar — khung card: chevron + tiêu đề + đếm done/total + × hiện khi hover. -->
  <div
    v-else-if="variant === 'bar' && bannerVisible && !dismissed"
    class="mx-3.5 mt-3 flex-none rounded-lg border bg-card"
  >
    <div
      class="group flex cursor-pointer items-center gap-2 px-3 py-2 text-base font-medium select-none"
      :title="collapsed ? t('sessions.todo.expand') : t('sessions.todo.collapse')"
      @click="collapsed = !collapsed"
    >
      <Icon
        name="chev"
        class="size-3 text-dim transition-transform motion-reduce:transition-none"
        :class="[collapsed ? '-rotate-90' : '']"
      />
      <Icon :name="allDone ? 'check' : 'tasks'" class="size-3.5 text-dim" />
      <span>{{ t('sessions.todo.title') }}</span>
      <span class="ml-auto text-sm text-dim tabular-nums">{{ doneCount }}/{{ total }}</span>
      <!-- × chỉ hiện khi hover header: header tự nó là vùng bấm, một × luôn nổi sẽ
           tranh chỗ với nó. Trong popover của chip thì × luôn hiện (hàng đó không
           phải công tắc). -->
      <Button
        type="button"
        variant="ghost"
        size="iconSm"
        class="-my-1 -mr-1 ml-0.5 size-5 text-dim opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-3"
        :title="t('sessions.todo.hide')"
        @click.stop="dismissed = true"
      >
        <Icon name="x" />
      </Button>
    </div>
    <SessionTodoList
      v-if="!collapsed"
      class="px-3 pb-2.5"
      :todos="todos"
      editable
      @cycle="cycleTodo"
    />
  </div>
</template>

<script setup lang="ts">
// To-do panel (todoHtml ~1882): collapsible header (chevron) + checklist rows. The
// rows are editable — a click cycles a row's status and persists the whole list — see
// useSessionTodo for the shared source-of-truth and banner/inline rules.
import type { Session } from '~/composables/useSessionsData'
import { usePopoverAnchor } from '~/composables/usePopoverAnchor'

const props = withDefaults(defineProps<{ session: Session; variant?: 'bar' | 'chip' }>(), {
  variant: 'bar',
})
const { t } = useI18n()
const popOpen = ref(false)
// Chip nằm trên hàng header `.dh` và có thể đứng sát mép phải cửa sổ — neo fixed
// kẹp viewport thay vì `absolute` trong wrapper (thò ra ngoài là bị cắt).
// `Button` là component ⇒ template ref trả instance, phần tử thật ở `$el`.
const chipBtn = useTemplateRef<{ $el: HTMLElement }>('chipEl')
const chipEl = computed(() => chipBtn.value?.$el ?? null)
const popEl = useTemplateRef<HTMLElement>('popEl')
const { style: popStyle } = usePopoverAnchor(chipEl, popEl, popOpen, { maxHeight: 360 })
function hide() {
  popOpen.value = false
  dismissed.value = true
}

const { todos, total, doneCount, allDone, bannerVisible, cycleTodo } = useSessionTodo(
  () => props.session,
)

// Always starts collapsed — the banner is a progress strip, not a panel. It used to
// expand itself whenever a turn was live, which meant the tallest thing on screen was
// a list the user had already read, pushing the conversation out of view on every run.
// Nothing re-collapses or re-expands it behind the user's back; only a session switch
// re-applies the default.
const collapsed = ref(true)
const dismissed = ref(false)

// A different session means a different checklist — re-apply both defaults.
watch(
  () => props.session.id,
  () => {
    collapsed.value = true
    dismissed.value = false
  },
)

// Dismissal covers the checklist that was on screen, not the session forever: a brand
// new list (0 → n) brings the strip back — as a strip, collapsed like any first sight
// of a list — so closing it can never hide work the user has not seen. Updates to an
// existing list change nothing: neither the dismissal nor the open/closed state.
watch(total, (n, prev) => {
  if (n > 0 && prev === 0) {
    dismissed.value = false
    collapsed.value = true
  }
})
</script>
