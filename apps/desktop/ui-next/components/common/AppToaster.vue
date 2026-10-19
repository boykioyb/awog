<template>
  <!-- The app's ONE toast surface (useToast). Mounted in AppGlobalHosts so both the
       main window and a session popout get it, and so a toast is never rendered
       inside a transformed ancestor — the reason the old code needed a second,
       separate toast system for the composer.

       Built on Reka UI's Toast primitives: ToastRoot owns the dismiss timer, which
       is what buys pause-on-hover, pause-on-window-blur, swipe-to-dismiss and the
       F8 "jump to notifications" landmark. -->
  <ToastProvider :duration="DEFAULT_DURATION" :swipe-direction="swipeDirection">
    <!-- `tst` là hook JS: OVERLAYS (useEmbeddedBrowser.ts) dò `.tst` để trình duyệt nhúng
         nhường chỗ khi toast bay qua. Không mang style. -->
    <ToastRoot
      v-for="tt in toasts"
      :key="tt.id"
      v-model:open="tt.open"
      :duration="tt.duration"
      :type="tt.type ?? 'foreground'"
      class="tst pointer-events-auto relative flex w-max max-w-full items-start gap-2.5 overflow-hidden rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-md data-[state=closed]:animate-out data-[state=closed]:duration-120 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-1.5 data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:translate-y-0 data-[swipe=cancel]:transition-transform data-[swipe=move]:translate-x-(--reka-toast-swipe-move-x) data-[swipe=move]:translate-y-(--reka-toast-swipe-move-y) motion-reduce:animate-none motion-reduce:transition-none"
      :class="{ 'cursor-pointer hover:border-input': !!tt.onClick }"
      @update:open="(open: boolean) => !open && retire(tt.id)"
      @click="onRootClick(tt)"
    >
      <template #default="{ remaining, duration }">
        <!-- Màu ngữ nghĩa nằm ở ICON (và thanh thời gian), không ở viền: một vòng viền
             sáng quanh cả thẻ là thứ ồn nhất màn hình cho một thông báo thường chỉ là
             xác nhận. Optical: mt-px để icon thẳng hàng chữ hoa của tiêu đề. -->
        <Icon
          :name="tt.icon ?? iconFor(tt.color)"
          class="mt-px size-4 shrink-0"
          :class="ACCENT[tt.color ?? 'neutral'].icon"
        />

        <div class="flex min-w-0 flex-auto flex-col gap-0.5">
          <!-- Một dòng, cắt bớt — tiêu đề giữ dễ lướt; chi tiết ở description. -->
          <ToastTitle class="truncate font-medium">{{ tt.title }}</ToastTitle>
          <!-- Wraps, unlike the title: a git error is several lines and the old
               single-line ellipsis cut it off mid-message. `pre-wrap` giữ xuống dòng
               gốc (stderr git là từng dòng "error: …" / "hint: …"), `anywhere` bẻ token
               dài (path, SHA); trần chiều cao để chi tiết dài không phình toast. -->
          <ToastDescription
            v-if="tt.description"
            class="max-h-30 overflow-y-auto text-xs whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]"
          >
            {{ tt.description }}
          </ToastDescription>

          <div v-if="tt.actions?.length" class="mt-1 flex flex-wrap gap-1.5">
            <ToastAction v-for="(act, i) in tt.actions" :key="i" :alt-text="act.label" as-child>
              <Button
                variant="outline"
                size="xs"
                class="font-normal shadow-none [&_svg]:size-3"
                @click.stop="act.onClick?.($event)"
              >
                <Icon v-if="act.icon" :name="act.icon" />
                {{ act.label }}
              </Button>
            </ToastAction>
          </div>
        </div>

        <!-- Affordance for the whole-toast click-through (GitHub notification). -->
        <Icon
          v-if="tt.onClick"
          name="chev-right"
          class="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
        />

        <!-- Copy: lỗi / cảnh báo / toast có phần chi tiết — thứ người dùng hay cần dán
             đi đâu đó (issue, chat). Chép cả tiêu đề lẫn chi tiết. `.stop` để không
             kích hoạt click-through của cả toast. -->
        <Button
          v-if="copyable(tt)"
          variant="ghost"
          size="iconSm"
          class="size-6 shrink-0 text-muted-foreground"
          :title="copyFb.labelFor(tt.id, t('common.copy'))"
          :aria-label="copyFb.labelFor(tt.id, t('common.copy'))"
          @click.stop="copyFb.copy(tt.id, copyTextOf(tt))"
        >
          <Icon :name="copyFb.iconFor(tt.id)" />
        </Button>
        <!-- Đóng: MỌI toast (người dùng chốt 2026-10-15) — không phải chờ hết giờ hay
             vuốt mới tắt được một toast đang che chỗ cần bấm. -->
        <ToastClose as-child>
          <Button
            variant="ghost"
            size="iconSm"
            class="size-6 shrink-0 text-muted-foreground"
            :aria-label="t('common.close')"
            @click.stop
          >
            <Icon name="x" />
          </Button>
        </ToastClose>

        <!-- Time left, in the semantic colour. ToastRoot computes `remaining` and
             freezes it while the timer is paused (hover / window blur), so the bar
             stops with it. A toast with no timer (duration 0) has no bar. -->
        <div
          v-if="duration > 0"
          class="absolute inset-x-0 bottom-0 h-0.5 origin-left opacity-70"
          :class="ACCENT[tt.color ?? 'neutral'].bar"
          :style="{ transform: `scaleX(${remaining / duration})` }"
        />
      </template>
    </ToastRoot>

    <!-- Viewport luôn mount và rộng bằng toast rộng nhất có thể ⇒ không được nuốt click
         ở góc đó khi trống (pointer-events-none; chỉ thẻ toast nhận click). z-141: trên
         overlay (.ovl 100) và menu cũ (.smenu/.pop 130), như `.toast` cũ. Góc neo + chiều
         xếp đến từ viewportStyle (cài đặt của người dùng). -->
    <ToastViewport
      class="pointer-events-none fixed z-141 m-0 flex w-[min(28.75rem,90vw)] list-none gap-2.5 p-0 outline-none"
      :style="viewportStyle"
      :label="t('common.toast.landmark')"
    />
  </ToastProvider>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
} from 'reka-ui'
import { useToast, type ToastColor } from '~/composables/useToast'
import { useSettingsStore } from '~/stores/settings'

const { t } = useI18n()
const { toasts, remove } = useToast()
const copyFb = useCopyFeedback()

type CopyableToast = { title: string; description?: string; color?: ToastColor }
const copyable = (tt: CopyableToast): boolean =>
  tt.color === 'error' || tt.color === 'warning' || !!tt.description
const copyTextOf = (tt: CopyableToast): string =>
  tt.description ? `${tt.title}\n\n${tt.description}` : tt.title
const settings = useSettingsStore()

const DEFAULT_DURATION = 5000

// Màu ngữ nghĩa → class của icon + thanh thời gian. Thẻ toast giữ nền trung tính.
const ACCENT: Record<ToastColor, { icon: string; bar: string }> = {
  success: { icon: 'text-success', bar: 'bg-success' },
  error: { icon: 'text-destructive', bar: 'bg-destructive' },
  warning: { icon: 'text-warning', bar: 'bg-warning' },
  primary: { icon: 'text-primary', bar: 'bg-primary' },
  info: { icon: 'text-info', bar: 'bg-info' },
  neutral: { icon: 'text-input', bar: 'bg-input' },
}

// Default glyph per semantic color. Callers override with `icon`.
function iconFor(color: ToastColor | undefined): string {
  if (color === 'success') return 'check'
  if (color === 'error' || color === 'warning') return 'alert'
  return 'info'
}

// Anchor + stacking direction per corner (Settings → Notifications → toast
// position). Bottom anchors stack upward so the newest toast stays nearest the
// edge; top anchors stack downward. Top clears the 44px app top bar so a toast
// never lands on the window chrome.
const EDGE = '28px'
const TOP_EDGE = '56px'

const corner = computed(() => {
  const [vertical, horizontal] = settings.notifications.toastPosition.split('-') as [
    'top' | 'bottom',
    'left' | 'center' | 'right',
  ]
  return { vertical, horizontal }
})

// Swipe away from the screen centre, so the gesture matches where the stack sits.
const swipeDirection = computed(() => {
  const { horizontal, vertical } = corner.value
  if (horizontal === 'left') return 'left' as const
  if (horizontal === 'right') return 'right' as const
  return vertical === 'top' ? ('up' as const) : ('down' as const)
})

const viewportStyle = computed(() => {
  const { vertical, horizontal } = corner.value
  const style: Record<string, string> = {
    flexDirection: vertical === 'bottom' ? 'column-reverse' : 'column',
    alignItems:
      horizontal === 'right' ? 'flex-end' : horizontal === 'left' ? 'flex-start' : 'center',
  }
  style[vertical] = vertical === 'top' ? TOP_EDGE : EDGE
  if (horizontal === 'center') {
    style.left = '50%'
    style.transform = 'translateX(-50%)'
  } else {
    style[horizontal] = EDGE
  }
  return style
})

// Whole-toast click-through: run, then dismiss. Actions and the close button stop
// propagation, so this only fires on the toast body.
function onRootClick(tt: { id: string; onClick?: () => void }): void {
  if (!tt.onClick) return
  tt.onClick()
  retire(tt.id)
}

// `open` is already false by the time we get here (v-model wrote it), so ToastRoot
// is playing its exit. Dropping the row from the queue NOW would unmount the
// v-for item mid-animation, so hold it for the length of the exit animation (`duration-120`) first.
const EXIT_MS = 140
function retire(id: string): void {
  setTimeout(() => remove(id), EXIT_MS)
}
</script>
