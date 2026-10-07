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
    <div
      v-if="open"
      class="bpip"
      :class="{ dragging, min: minimized }"
      :style="cardStyle"
      role="dialog"
      :aria-label="t('browser.pip.title')"
    >
      <header
        class="bpip-bar"
        tabindex="0"
        role="group"
        :aria-label="t('browser.pip.move')"
        :title="t('browser.pip.move')"
        @pointerdown="onDragStart"
        @keydown="onBarKeydown"
        @dblclick="onBarDblclick"
      >
        <div
          class="bpip-lead"
          :class="{ clickable: minimized }"
          :title="minimized ? t('browser.pip.restore') : undefined"
          @click="onLeadClick"
        >
          <Icon
            v-if="activeTab?.loading"
            name="refresh"
            class="bpip-spin"
            style="width: var(--icon-xs); height: var(--icon-xs)"
          />
          <img
            v-else-if="favicon"
            class="bpip-fav"
            :src="favicon"
            alt=""
            draggable="false"
            @error="favBroken = true"
          />
          <Icon
            v-else
            name="globe"
            class="bpip-favicon"
            style="width: var(--icon-xs); height: var(--icon-xs)"
          />
          <span class="bpip-title" :title="activeTab?.url">{{ title }}</span>
        </div>
        <button
          type="button"
          class="bpip-btn"
          :title="t(minimized ? 'browser.pip.restore' : 'browser.pip.minimize')"
          :aria-label="t(minimized ? 'browser.pip.restore' : 'browser.pip.minimize')"
          @pointerdown.stop
          @click="toggleMinimize"
        >
          <Icon
            :name="minimized ? 'maximize' : 'minimize'"
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
        </button>
        <button
          v-if="!minimized"
          type="button"
          class="bpip-btn"
          :title="t('browser.pip.actions')"
          :aria-label="t('browser.pip.actions')"
          @pointerdown.stop
          @click.stop="openMenu"
        >
          <Icon name="dots" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          type="button"
          class="bpip-btn"
          :title="t('browser.pip.close')"
          :aria-label="t('browser.pip.close')"
          @pointerdown.stop
          @click="dismissPip"
        >
          <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </header>
      <div v-if="error && !minimized" class="bpip-err">{{ error }}</div>
      <div v-if="!minimized" ref="viewportEl" class="bpip-view">
        <img v-if="frozen" class="bpip-frozen" :src="frozen" alt="" />
        <div v-if="!available" class="bpip-empty">
          {{ t('sessions.workspace.browser.unavailable') }}
        </div>
        <!-- Tab trắng → empty-state thắng: "hiện ở chỗ khác" vô nghĩa khi tab
             chưa có trang nào. -->
        <div v-else-if="empty" class="bpip-empty">
          <Icon
            name="globe"
            class="bpip-emptyicn"
            style="width: var(--icon-lg); height: var(--icon-lg)"
          />
          <div class="bpip-emptytext">{{ t('browser.pip.empty') }}</div>
        </div>
        <BrowserElsewhere
          v-else-if="elsewhere"
          :where="activeTab?.shownElsewhere ? 'window' : 'dock'"
          @takeover="takeOver"
        />
      </div>
      <!-- Tay resize nằm TRÊN khung DOM 5px của card (padding phải/dưới), không
           chồng lên .bpip-view — view native vẽ trên DOM nên bất kỳ handle nào
           đặt lên rect của nó đều vừa vô hình vừa chết click. Mép phải = ngang,
           mép dưới = dọc, góc = cả hai (giống border-resize của cửa sổ frameless).
           Góc giữ keyboard cho người không kéo được chuột; hai mép là pointer-only
           (aria-hidden) vì lặp chức năng. -->
      <div
        v-if="!minimized"
        class="bpip-rsz e"
        aria-hidden="true"
        @pointerdown="(ev) => onResizeStart(ev, 'e')"
      />
      <div
        v-if="!minimized"
        class="bpip-rsz s"
        aria-hidden="true"
        @pointerdown="(ev) => onResizeStart(ev, 's')"
      />
      <button
        v-if="!minimized"
        type="button"
        class="bpip-rsz se"
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

<style scoped>
.bpip {
  position: fixed;
  z-index: 96;
  display: flex;
  flex-direction: column;
  border-radius: var(--r-card);
  background: var(--bgEl);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  /* Khung DOM 5px ở mép phải + dưới: .bpip-view dừng trước mép card nên dải
     resize đặt ở đó không bao giờ nằm dưới view native (view vẽ trên DOM).
     Bonus: view vuông góc không còn đè lên bo góc dưới của card. */
  padding-right: 5px;
  padding-bottom: 5px;
  /* Kéo/resize sửa style mỗi pointermove — transition trên geometry sẽ làm card
     chạy sau con trỏ, nên chỉ animate màu/bóng. */
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}
.bpip.dragging {
  user-select: none;
  border-color: var(--accentBorder);
}
/* Thu nhỏ = chip neo góc: không còn view nên bỏ luôn khung 5px hai cạnh, header
   khép kín, giới hạn bề ngang để title dài không kéo chip thành thanh. */
.bpip.min {
  padding: 0;
  max-width: 240px;
}
.bpip.min .bpip-bar {
  border-bottom: none;
  cursor: default;
}
.bpip-lead {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.bpip-lead.clickable {
  cursor: pointer;
}
.bpip.min .bpip-title {
  max-width: 130px;
}
.bpip-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  cursor: grab;
  flex-shrink: 0;
  touch-action: none;
}
.bpip.dragging .bpip-bar {
  cursor: grabbing;
}
.bpip-bar:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.bpip-fav {
  width: var(--icon-xs);
  height: var(--icon-xs);
  border-radius: var(--r-xs);
  flex-shrink: 0;
}
.bpip-favicon,
.bpip-spin {
  color: var(--textFaint);
  flex-shrink: 0;
}
.bpip-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.bpip-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  border-radius: var(--r-xs);
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
  flex-shrink: 0;
}
.bpip-btn:hover {
  background: var(--bgHover);
  color: var(--text);
}
.bpip-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.bpip-err {
  padding: 4px 10px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--danger);
  background: var(--dangerBg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.bpip-view {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: var(--bg);
}
/* Frame đông cứng trong lúc một overlay DOM bắt view native ẩn (menu ⋯/⋮ của
   chính card, dialog import…) — cùng cơ chế `frozen` của useEmbeddedBrowser. */
.bpip-frozen {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}
.bpip-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  padding: 16px;
  text-align: center;
  color: var(--textFaint);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.bpip-emptyicn {
  color: var(--textFaint);
}
.bpip-rsz {
  position: absolute;
  padding: 0;
  border: none;
  background: transparent;
  touch-action: none;
}
/* Mép phải bắt đầu DƯỚI thanh tiêu đề để không ăn hit-area của nút ×. */
.bpip-rsz.e {
  top: 30px;
  right: 0;
  bottom: 5px;
  width: 5px;
  cursor: ew-resize;
}
.bpip-rsz.s {
  left: 0;
  right: 5px;
  bottom: 0;
  height: 5px;
  cursor: ns-resize;
}
/* Góc 14px: 9px phía trên-trái chồng lên view (vùng chết), phần "sống" là chữ L
   trong khung 5px — đủ cho kéo chéo, và là chỗ duy nhất vẽ được affordance. */
.bpip-rsz.se {
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
}
/* Hai gạch chéo gợi ý kéo, vẽ bằng border trên pseudo-element hug góc — chỉ
   những pixel nằm trong khung DOM 5px mới hiện, nên gạch phải nằm sát mép. */
.bpip-rsz.se::before,
.bpip-rsz.se::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  border-right: 1.5px solid var(--borderStrong);
  border-bottom: 1.5px solid var(--borderStrong);
}
.bpip-rsz.se::before {
  width: 4px;
  height: 4px;
}
.bpip-rsz.se::after {
  width: 8px;
  height: 8px;
  opacity: 0.55;
}
.bpip-rsz.se:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.bpip-spin {
  animation: bpip-spin 1s linear infinite;
}
@keyframes bpip-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .bpip {
    transition: none;
  }
  .bpip-spin {
    animation: none;
  }
}
</style>
