<template>
  <!-- Card nổi cấp app: Teleport ra body để thoát mọi stacking context của page,
       z 96 — trên page/dock (≤95) nhưng DƯỚI modal/menu (≥100) để overlay thật
       vẫn kích `covered` che view native. Bản thân card KHÔNG nằm trong OVERLAYS:
       nó là host của view, chủ động cho nó vào danh sách là tự che chính mình.

       Kéo = thanh tiêu đề (pointer capture), resize = tay nắm góc dưới-phải; cả
       hai chỉ sửa `rect` (module state, localStorage) → style attribute đổi →
       MutationObserver + ResizeObserver sẵn có của useEmbeddedBrowser nudge →
       sync → setBounds. PiP không cần đường geometry riêng nào. -->
  <Teleport to="body">
    <!-- Khung DOM 5px ở mép phải + dưới (pr-1.25 pb-1.25): vùng view dừng trước mép
         card nên dải resize đặt ở đó không bao giờ nằm dưới view native (view vẽ trên
         DOM). Bonus: view vuông góc không còn đè lên bo góc dưới của card.
         Kéo/resize sửa style mỗi pointermove — transition trên geometry sẽ làm card
         chạy sau con trỏ, nên chỉ animate màu/bóng.
         Thu nhỏ = chip neo góc: không còn view nên bỏ khung 5px, giới hạn bề ngang
         để title dài không kéo chip thành thanh. -->
    <div
      v-if="open"
      class="fixed z-96 flex flex-col overflow-hidden rounded-xl border bg-card shadow-lg transition-[border-color,box-shadow] duration-120 motion-reduce:transition-none"
      :class="[
        dragging && 'border-selected-border select-none',
        minimized ? 'max-w-60 p-0' : 'pr-1.25 pb-1.25',
      ]"
      :style="cardStyle"
      role="dialog"
      :aria-label="t('browser.pip.title')"
    >
      <header
        class="flex shrink-0 touch-none items-center gap-1.5 bg-background px-2 py-1.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        :class="
          minimized ? 'cursor-default' : ['border-b', dragging ? 'cursor-grabbing' : 'cursor-grab']
        "
        tabindex="0"
        role="group"
        :aria-label="t('browser.pip.move')"
        :title="t('browser.pip.move')"
        @pointerdown="onDragStart"
        @keydown="onBarKeydown"
        @dblclick="onBarDblclick"
      >
        <div
          class="flex min-w-0 flex-1 items-center gap-1.5"
          :class="minimized && 'cursor-pointer'"
          :title="minimized ? t('browser.pip.restore') : undefined"
          @click="onLeadClick"
        >
          <Icon
            v-if="activeTab?.loading"
            name="refresh"
            class="size-3 shrink-0 animate-spin text-faint motion-reduce:animate-none"
          />
          <img
            v-else-if="favicon"
            class="size-3 shrink-0 rounded-sm"
            :src="favicon"
            alt=""
            draggable="false"
            @error="favBroken = true"
          />
          <Icon v-else name="globe" class="size-3 shrink-0 text-faint" />
          <span
            class="min-w-0 flex-1 truncate text-xs text-muted-foreground"
            :class="minimized && 'max-w-32.5'"
            :title="activeTab?.url"
          >
            {{ title }}
          </span>
        </div>
        <!-- hook-ok: `.bpip-btn` được onBarDblclick đọc qua closest() để bấm đúp nút
             không bị hiểu là bấm đúp thanh tiêu đề. -->
        <Button
          variant="ghost"
          size="iconSm"
          class="bpip-btn size-6 shrink-0 text-muted-foreground"
          :title="t(minimized ? 'browser.pip.restore' : 'browser.pip.minimize')"
          :aria-label="t(minimized ? 'browser.pip.restore' : 'browser.pip.minimize')"
          @pointerdown.stop
          @click="toggleMinimize"
        >
          <Icon :name="minimized ? 'maximize' : 'minimize'" />
        </Button>
        <!-- hook-ok: closest('.bpip-btn') trong onBarDblclick. -->
        <Button
          v-if="!minimized"
          variant="ghost"
          size="iconSm"
          class="bpip-btn size-6 shrink-0 text-muted-foreground"
          :title="t('browser.pip.actions')"
          :aria-label="t('browser.pip.actions')"
          @pointerdown.stop
          @click.stop="openMenu"
        >
          <Icon name="dots" />
        </Button>
        <!-- hook-ok: closest('.bpip-btn') trong onBarDblclick. -->
        <Button
          variant="ghost"
          size="iconSm"
          class="bpip-btn size-6 shrink-0 text-muted-foreground"
          :title="t('browser.pip.close')"
          :aria-label="t('browser.pip.close')"
          @pointerdown.stop
          @click="dismissPip"
        >
          <Icon name="x" />
        </Button>
      </header>
      <div
        v-if="error && !minimized"
        class="shrink-0 border-b bg-destructive/10 px-2.5 py-1 text-xs text-destructive"
      >
        {{ error }}
      </div>
      <div v-if="!minimized" ref="viewportEl" class="relative flex-1 overflow-hidden bg-background">
        <!-- Frame đông cứng trong lúc một overlay DOM bắt view native ẩn (menu ⋯/⋮ của
             chính card, dialog import…) — cùng cơ chế `frozen` của useEmbeddedBrowser. -->
        <img
          v-if="frozen"
          class="pointer-events-none absolute inset-0 size-full object-fill"
          :src="frozen"
          alt=""
        />
        <div
          v-if="!available"
          class="flex h-full flex-col items-center justify-center gap-1.5 p-4 text-center text-sm text-faint"
        >
          {{ t('sessions.workspace.browser.unavailable') }}
        </div>
        <!-- Tab trắng → empty-state thắng: "hiện ở chỗ khác" vô nghĩa khi tab
             chưa có trang nào. -->
        <div
          v-else-if="empty"
          class="flex h-full flex-col items-center justify-center gap-1.5 p-4 text-center text-sm text-faint"
        >
          <Icon name="globe" class="size-5" />
          <div>{{ t('browser.pip.empty') }}</div>
        </div>
        <BrowserElsewhere
          v-else-if="elsewhere"
          :where="activeTab?.shownElsewhere ? 'window' : 'dock'"
          @takeover="takeOver"
        />
      </div>
      <!-- Tay resize nằm TRÊN khung DOM 5px của card (padding phải/dưới), không
           chồng lên vùng view — view native vẽ trên DOM nên bất kỳ handle nào
           đặt lên rect của nó đều vừa vô hình vừa chết click. Mép phải = ngang,
           mép dưới = dọc, góc = cả hai (giống border-resize của cửa sổ frameless).
           Góc giữ keyboard cho người không kéo được chuột; hai mép là pointer-only
           (aria-hidden) vì lặp chức năng.
           Mép phải bắt đầu DƯỚI thanh tiêu đề (cao ~37px: py-1.5 + nút 24px + hairline) để
           không ăn hit-area của thanh / nút ×. -->
      <div
        v-if="!minimized"
        class="absolute top-9.5 right-0 bottom-1.25 w-1.25 cursor-ew-resize touch-none"
        aria-hidden="true"
        @pointerdown="(ev) => onResizeStart(ev, 'e')"
      />
      <div
        v-if="!minimized"
        class="absolute right-1.25 bottom-0 left-0 h-1.25 cursor-ns-resize touch-none"
        aria-hidden="true"
        @pointerdown="(ev) => onResizeStart(ev, 's')"
      />
      <!-- Grip góc 14px: 9px trên-trái chồng lên view là vùng chết, phần "sống" là chữ L
           trong khung 5px. Hai gạch chéo gợi ý kéo vẽ bằng viền của before/after hug
           góc — chỉ pixel trong khung 5px mới hiện. -->
      <!-- raw-ok: grip kéo resize góc -->
      <button
        v-if="!minimized"
        type="button"
        class="absolute right-0 bottom-0 size-3.5 cursor-nwse-resize touch-none border-0 bg-transparent p-0 before:absolute before:right-0 before:bottom-0 before:size-1 before:border-r-[1.5px] before:border-b-[1.5px] before:border-input after:absolute after:right-0 after:bottom-0 after:size-2 after:border-r-[1.5px] after:border-b-[1.5px] after:border-input after:opacity-55 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        :aria-label="t('browser.pip.resize')"
        :title="t('browser.pip.resize')"
        @pointerdown="(ev) => onResizeStart(ev, 'se')"
        @keydown="onResizeKeydown"
      />
      <!-- ⋮ menu — reload (view trắng/kẹt tự cứu được) + trả về panel + popout,
           fixed-position theo nút nên không lệ thuộc overflow của card. -->
      <AppContextMenu
        :open="menuOpen"
        :position="menuPos"
        :items="menuItems"
        @close="menuOpen = false"
        @select="onMenuSelect"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Browser Picture-in-Picture — bề mặt thứ ba của trình duyệt nhúng. Khác với
// PiP của Codex (preview), view ở đây là `WebContentsView` SỐNG: gõ/click/cuộn
// trực tiếp trang agent đang dùng. Toàn bộ quyền sở hữu view do `owner` cấp
// module của useEmbeddedBrowser phân xử — PiP chỉ là một instance nữa giành chỗ:
// mở ⇒ `takeOver` giật view về card (panel/popout tự chuyển "elsewhere"), đóng ⇒
// v-if gỡ viewport el → sync → `detach()` → panel nhận lại không reload.
import BrowserElsewhere from '~/components/browser/BrowserElsewhere.vue'
import type { MenuItem } from '~/composables/useContextMenu'
import { useSessionsStore } from '~/stores/sessions'

const { t } = useI18n()
const {
  open,
  minimized,
  rect,
  setPos,
  setSize,
  persistGeometry,
  dismissPip,
  closePip,
  toggleMinimize,
} = useBrowserPip()
const workspace = useWorkspacePanel()
const sessions = useSessionsStore()

const viewportEl = useTemplateRef<HTMLElement>('viewportEl')
const { available, activeTab, error, empty, elsewhere, holding, frozen, popout, reload, takeOver } =
  useEmbeddedBrowser({
    viewport: viewportEl,
    // Card chỉ giữ view khi mở VÀ không thu nhỏ — v-if gỡ viewport el khỏi DOM
    // là đủ để sync nhả view về holder (trang chạy nền, không reload).
    visible: () => open.value && !minimized.value,
    // Card theo phiên ĐANG XEM (khác panel — panel có scope cố định của session
    // chủ): đổi session là đổi scope, watcher của composable detach tab phiên cũ
    // rồi re-sync cho phiên mới.
    scope: () => sessions.active?.engineId,
  })

// Mở card (hoặc bung ra sau khi thu nhỏ) = CHỦ ĐỘNG giật view về đây (khác với
// reclaim thụ động của panel). Phải đợi v-if mount xong viewport — sync thấy
// el=null sẽ nhả luôn claim vừa nhận, và lần sync sau (khi view ở popout) lại
// dừng ở nhánh shownElsewhere.
const armed = ref(false)
watch([open, minimized], async () => {
  armed.value = false
  if (!open.value || minimized.value) return
  await nextTick()
  void takeOver()
})

// Mất quyền sở hữu SAU KHI đã từng giữ view = một bề mặt khác đã giật (nút
// "Hiện ở đây" của panel, cửa sổ popout) → card tự đóng. `armed` chặn nhịp
// transient lúc mount: trước khi attach kịp chạy `elsewhere` vẫn có thể bật.
// Đang THU NHỎ thì không đóng: user chỉ xếp card lại, restore sẽ giành view về.
watch(holding, (v) => {
  if (v) armed.value = true
})
watch(elsewhere, (v) => {
  if (v && armed.value && !minimized.value) closePip()
})

// ── Header ─────────────────────────────────────────────────────────────────

const favBroken = ref(false)
// Favicon do trang khai (L1) — chỉ http(s)/data:image, chỉ vào src của <img>;
// icon chết thì fallback globe thay vì vẽ khung ảnh hỏng mãi. Cùng phán đoán
// với `faviconOf` của BrowserTabs.
const favicon = computed(() => {
  const f = activeTab.value?.favicon?.trim() ?? ''
  if (!/^(https?:\/\/|data:image\/)/i.test(f) || favBroken.value) return ''
  return f
})
watch(
  () => activeTab.value?.favicon,
  () => {
    favBroken.value = false
  },
)

const title = computed(
  () => activeTab.value?.title || activeTab.value?.url || t('browser.pip.title'),
)

const cardStyle = computed(() => {
  // Thu nhỏ = chip neo góc phải-dưới (trên status bar — cùng vị trí "đậu" mặc
  // định của card: STATUSBAR 26 + MARGIN 16). rect giữ nguyên nên restore bung
  // đúng chỗ cũ.
  if (minimized.value) {
    return { left: 'auto', top: 'auto', right: '16px', bottom: '42px' }
  }
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
  }
})

// ── Actions ────────────────────────────────────────────────────────────────

// Bấm vào favicon/title của chip đang thu nhỏ = bung ra (titlebar thu nhỏ là
// affordance duy nhất còn lại). Khi bung thì vùng này chỉ để kéo, click thường
// không làm gì — drag đã chiếm pointerdown.
const onLeadClick = (): void => {
  if (minimized.value) toggleMinimize()
}

// Dblclick thanh = "về panel" (thói quen title-bar) — trừ khi đang thu nhỏ, lúc
// đó nó là chip neo góc và dblclick phải bung ra. Event bubble lên từ cả các
// nút con — bấm đúp × mà nhảy về panel thì nút đó tự huỷ hành vi của mình, nên
// phải lọc theo target.
const onBarDblclick = (ev: MouseEvent): void => {
  if ((ev.target as HTMLElement).closest('.bpip-btn')) return
  if (minimized.value) {
    toggleMinimize()
    return
  }
  returnToPanel()
}

// "Trả về panel" = đóng card + mở lại view Browser trong dock: người dùng chuyển
// chỗ hiển thị chứ không bỏ trang. toggleView là TOGGLE nên phải kiểm openViews
// trước — view đang mở sẵn thì gọi toggle là đóng nó đi.
const returnToPanel = (): void => {
  closePip()
  if (!workspace.openViews.value.includes('Browser')) workspace.toggleView('Browser')
}

// Popout sẽ giật view (same-window detach + host chuyển cửa sổ) — đóng card
// ngay cho sạch thay vì chờ broadcast elsewhere đóng sau.
const toPopout = (): void => {
  void popout()
  closePip()
}

// ── ⋮ menu ─────────────────────────────────────────────────────────────────
// Gom các action phụ khỏi thanh tiêu đề cho gọn (trước đây mỗi cái một nút).
// `reload` là đường tự cứu khi view native trắng/kẹt — panel đã có nút này trên
// chrome, PiP thiếu nên view lỗi chỉ còn cách đóng/mở lại card.
const menuOpen = ref(false)
const menuPos = ref({ x: 0, y: 0 })

const openMenu = (ev: MouseEvent): void => {
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  // Căn mép phải menu theo nút; ContextMenu tự kẹp trong viewport.
  menuPos.value = { x: r.right - 200, y: r.bottom + 4 }
  menuOpen.value = true
}

const menuItems = computed<MenuItem[]>(() => [
  { id: 'reload', label: t('common.reload'), icon: 'refresh' },
  { id: 'panel', label: t('browser.pip.toPanel'), icon: 'panel' },
  { id: 'popout', label: t('sessions.workspace.browser.popout'), icon: 'external' },
])

const onMenuSelect = (id: string): void => {
  if (id === 'reload') void reload()
  else if (id === 'panel') returnToPanel()
  else if (id === 'popout') toPopout()
}

// ── Drag / resize ──────────────────────────────────────────────────────────

const dragging = ref(false)

const onDragStart = (ev: PointerEvent): void => {
  // Chip đang neo góc thì không kéo: style của nó không dùng rect nữa, kéo chỉ
  // đổi rect ngầm mà mắt không thấy.
  if (ev.button !== 0 || minimized.value) return
  const bar = ev.currentTarget as HTMLElement
  bar.setPointerCapture(ev.pointerId)
  dragging.value = true
  const dx = ev.clientX - rect.x
  const dy = ev.clientY - rect.y
  const move = (e: PointerEvent): void => setPos(e.clientX - dx, e.clientY - dy)
  const up = (): void => {
    dragging.value = false
    bar.removeEventListener('pointermove', move)
    bar.removeEventListener('pointerup', up)
    persistGeometry()
  }
  bar.addEventListener('pointermove', move)
  bar.addEventListener('pointerup', up)
}

// Phím mũi tên trên thanh tiêu đề nudge card 16px (Shift = 64px) — tay nắm kéo
// bằng chuột không dùng được cho người chỉ gõ phím.
const onBarKeydown = (ev: KeyboardEvent): void => {
  if (minimized.value) {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault()
      toggleMinimize()
    }
    return
  }
  const step = ev.shiftKey ? 64 : 16
  const delta: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }
  const d = delta[ev.key]
  if (!d) return
  ev.preventDefault()
  setPos(rect.x + d[0], rect.y + d[1])
  persistGeometry()
}

const onResizeStart = (ev: PointerEvent, dir: 'e' | 's' | 'se'): void => {
  if (ev.button !== 0) return
  ev.preventDefault()
  const handle = ev.currentTarget as HTMLElement
  handle.setPointerCapture(ev.pointerId)
  const startX = ev.clientX
  const startY = ev.clientY
  const startW = rect.w
  const startH = rect.h
  const move = (e: PointerEvent): void =>
    setSize(
      dir === 's' ? startW : startW + (e.clientX - startX),
      dir === 'e' ? startH : startH + (e.clientY - startY),
    )
  const up = (): void => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
    persistGeometry()
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
}

const onResizeKeydown = (ev: KeyboardEvent): void => {
  const step = ev.shiftKey ? 64 : 16
  if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
    ev.preventDefault()
    setSize(rect.w + step, rect.h + step)
    persistGeometry()
  } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
    ev.preventDefault()
    setSize(rect.w - step, rect.h - step)
    persistGeometry()
  }
}
</script>
