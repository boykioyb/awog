<template>
  <!-- Chip issue của phiên (docs/features/session-issue-tracking.md) — cùng khuôn chip
       SSH/hạ tầng trong SessionContextStrip: một chip mở popover của chính nó. Phiên
       chưa có issue (chưa gửi tin nào) hoặc không có project thì chip VẮNG MẶT. -->
  <!-- Không co: chip đã ngắn (chấm + một chữ status) — để hàng chật thì chip khác
       (hạ tầng, checklist) cắt chữ của chúng, đừng cắt status ra "Đa…". -->
  <span v-if="item" class="relative inline-flex flex-none">
    <Button
      ref="chipEl"
      type="button"
      variant="outline"
      size="xs"
      class="h-5.5 gap-1.5 rounded-md px-2.5 font-normal text-dim shadow-none hover:text-foreground [&_svg]:size-3"
      :class="{ 'border-selected-border bg-selected text-primary': open }"
      :title="`${statusLabel(item.status)} · ${item.title}`"
      @click.stop="open = !open"
    >
      <!-- Gọn: chỉ chấm màu + status, KHÔNG title issue — issue tự sinh mang đúng
           title của phiên (đã nằm ngay bên trái header), lặp lại chỉ đẩy status
           vào chỗ bị cắt "Đa…". Title đầy đủ ở tooltip + đầu popover. -->
      <!-- Chấm màu status — hình dạng chính là thông tin, không phải chữ. -->
      <span
        class="size-2 flex-none rounded-full"
        :style="{ background: statusColor(item.status) }"
      />
      <span class="whitespace-nowrap">{{ statusLabel(item.status) }}</span>
      <Icon name="chev" />
    </Button>

    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-40" @click="open = false" />
      <!-- role=dialog + data-state=open: khớp selector `[role="dialog"][data-state="open"]`
           trong OVERLAYS (useEmbeddedBrowser.ts) để trình duyệt nhúng nhường chỗ. -->
      <div
        v-if="open"
        ref="popEl"
        role="dialog"
        data-state="open"
        class="fixed z-130 max-h-[min(70vh,560px)] w-80 overflow-y-auto rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
        :style="popStyle"
        @click.stop
      >
        <div class="mb-2.5 flex flex-col gap-0.5">
          <span class="text-base font-semibold">{{ item.title }}</span>
          <span class="text-xs text-muted-foreground">{{ item.id }}</span>
        </div>

        <div class="text-xs font-medium text-muted-foreground">
          {{ t('sessions.issue.status') }}
        </div>
        <div class="mt-1 mb-2.5 grid grid-cols-2 gap-1">
          <Button
            v-for="qs in ISSUE_QUICK_STATUSES"
            :key="qs"
            type="button"
            variant="outline"
            size="xs"
            class="justify-start gap-1.5 font-normal shadow-none"
            :class="{ 'border-selected-border bg-selected': item.status === qs }"
            @click="onStatus(qs)"
          >
            <span class="size-2 flex-none rounded-full" :style="{ background: statusColor(qs) }" />
            {{ statusLabel(qs) }}
          </Button>
        </div>

        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-medium text-muted-foreground">
            {{
              item.recap
                ? t('sessions.issue.recapAt', { when: fmtWhen(item.recap.at) })
                : t('sessions.issue.recap')
            }}
          </span>
          <Button
            type="button"
            variant="link"
            size="xs"
            class="h-auto p-0 font-normal disabled:text-muted-foreground"
            :disabled="recapping"
            @click="recap()"
          >
            {{
              recapping
                ? t('sessions.issue.recapRunning')
                : item.recap
                  ? t('sessions.issue.recapRefresh')
                  : t('sessions.issue.recapRun')
            }}
          </Button>
        </div>
        <div class="mt-1 mb-1.5 rounded-sm border p-2">
          <IssueRecapView v-if="item.recap" :text="item.recap.text" />
          <p v-else class="m-0 text-xs text-muted-foreground">
            {{ t('sessions.issue.recapEmpty') }}
          </p>
        </div>

        <!-- Hàng hành động — cùng nhịp với popover SSH của SessionContextStrip. -->
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="mt-1 w-full justify-start px-2 font-normal [&_svg]:size-3.5"
          @click="onOpenBoard"
        >
          <Icon name="board" />
          {{ t('sessions.issue.openBoard') }}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="mt-1 w-full justify-start px-2 font-normal text-destructive hover:text-destructive [&_svg]:size-3.5"
          @click="onUntrack"
        >
          <Icon name="x" />
          {{ t('sessions.issue.untrack') }}
        </Button>
      </div>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import type { Session } from '~/composables/useSessionsData'
import type { BoardItemStatus } from '~/stores/board'
import { ISSUE_QUICK_STATUSES } from '~/composables/useIssueStatus'
import { usePopoverAnchor } from '~/composables/usePopoverAnchor'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const { statusLabel, statusColor } = useIssueStatus()
const { item, recapping, recap, setStatus, openOnBoard, untrack } = useSessionIssue(
  () => props.session,
)

const open = ref(false)
// `Button` là component ⇒ template ref trả instance, phần tử thật ở `$el`.
const chipBtn = useTemplateRef<{ $el: HTMLElement }>('chipEl')
const chipEl = computed(() => chipBtn.value?.$el ?? null)
const popEl = useTemplateRef<HTMLElement>('popEl')
const { style: popStyle } = usePopoverAnchor(chipEl, popEl, open)

// Popover đóng TRƯỚC khi mở hộp thoại ghi chú / xác nhận — hai lớp phủ chồng nhau
// thì backdrop của chip nuốt click của hộp thoại.
function onStatus(st: BoardItemStatus): void {
  open.value = false
  void setStatus(st)
}
function onOpenBoard(): void {
  open.value = false
  openOnBoard()
}
function onUntrack(): void {
  open.value = false
  void untrack()
}

const fmtWhen = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}
</script>
