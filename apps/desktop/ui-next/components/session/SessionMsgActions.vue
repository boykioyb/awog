<template>
  <div class="hoveract bottom">
    <button
      v-for="a in primary"
      :key="a.icon"
      type="button"
      class="ha"
      :class="{ danger: a.danger, on: a.active, off: a.disabled }"
      :disabled="a.disabled"
      :title="a.title"
      :aria-label="a.title"
      @click="a.run"
    >
      <Icon :name="a.icon" style="width: var(--icon-sm); height: var(--icon-sm)" />
    </button>

    <!-- Overflow. Everything rare or destructive lives here (session-ui-refactor §3.3):
         a destructive action must never sit unlabelled next to `copy` at the same
         weight. Anchored to this span, opening UPWARD because the footer is the last
         row of a turn — a downward menu would fall off the transcript. -->
    <span v-if="overflow.length" ref="moreRef" class="hamore">
      <button
        type="button"
        class="ha"
        :class="{ on: open }"
        :title="t('sessions.message.more')"
        :aria-label="t('sessions.message.more')"
        :aria-expanded="open"
        @click.stop="open = !open"
      >
        <Icon name="dots" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>

      <!-- Teleport ra <body> + định vị FIXED.
           ⚠ Bản trước là `position: absolute; bottom: 130%`, tức luôn mở LÊN TRÊN từ
           bên trong `.msgs` (`overflow-y: auto`) — nên message nào có footer nằm trong
           khoảng chiều cao menu tính từ mép trên vùng cuộn thì mất phần trên của menu,
           kể cả message ĐẦU TIÊN của phiên. Đo được: 132/184px nằm ngoài, và
           `elementFromPoint` ở đó trả `null`. Không z-index nào cứu được: đây là cắt
           bởi tổ tiên, không phải bị đè. -->
      <Teleport to="body">
        <template v-if="open">
          <div class="habackdrop" @click.stop="open = false" />
          <div ref="menuRef" class="smenu hamenu" :style="menuStyle" @click.stop>
            <template v-for="(a, i) in overflow" :key="i">
              <div v-if="'sep' in a" class="hasep" />
              <div v-else class="mi" :class="{ dmi: a.danger }" @click="run(a)">
                <Icon :name="a.icon" style="width: var(--icon-sm); height: var(--icon-sm)" />
                {{ a.title }}
              </div>
            </template>
          </div>
        </template>
      </Teleport>
    </span>
  </div>
</template>

<script setup lang="ts">
// Action set below one transcript turn. Frequent controls stay inline (assistant:
// copy · quote · bookmark · fullscreen · fullscreen-turn; user: copy · fullscreen ·
// bookmark); everything rare or transcript-cutting moves behind `⋯`.
//
// Owning this as a component (rather than two hard-coded rows in SessionMessageItem)
// keeps the user and assistant footers identical by construction — they drifted apart
// before, one carrying 7 controls and the other 10.
import { nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'

export type MsgAction = {
  icon: string
  title: string
  run: () => void
  danger?: boolean
  active?: boolean
  disabled?: boolean
}
/** A hairline rule inside the overflow menu — separates the transcript-cutting group. */
export type MsgSep = { sep: true }

defineProps<{ primary: MsgAction[]; overflow: (MsgAction | MsgSep)[] }>()

const { t } = useI18n()
const open = ref(false)

function run(a: MsgAction) {
  open.value = false
  a.run()
}

// ── Định vị menu (teleported, fixed) ────────────────────────────────────────
//
// Cùng phép của `AppSelect` và `InfraTimeRange`: neo theo nút, ưu tiên mở LÊN (footer
// là hàng cuối của một lượt nên phía dưới thường hết chỗ), lật XUỐNG khi trên không
// đủ, và kẹp trong viewport theo cả hai trục.
const moreRef = useTemplateRef<HTMLElement>('moreRef')
const menuRef = useTemplateRef<HTMLElement>('menuRef')
const menuStyle = ref<Record<string, string>>({})

const GAP = 6
const MARGIN = 8
const MIN_W = 196

function updatePosition(): void {
  const trigger = moreRef.value
  if (!trigger) return
  const r = trigger.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const h = menuRef.value?.scrollHeight ?? 0
  const w = Math.max(menuRef.value?.scrollWidth ?? 0, MIN_W)

  const spaceAbove = r.top - GAP - MARGIN
  const spaceBelow = vh - r.bottom - GAP - MARGIN
  // Mở lên là MẶC ĐỊNH; chỉ lật xuống khi trên không đủ mà dưới thì đủ hơn.
  const up = spaceAbove >= Math.min(h || 200, spaceBelow) || spaceAbove >= spaceBelow

  // Neo mép PHẢI theo nút (menu cũ dùng `right: 0`), nhưng không cho lọt khỏi mép trái.
  const left = Math.max(MARGIN, Math.min(r.right - w, vw - w - MARGIN))

  menuStyle.value = {
    left: `${String(Math.round(left))}px`,
    maxHeight: `${String(Math.round(Math.max(140, up ? spaceAbove : spaceBelow)))}px`,
    ...(up
      ? { bottom: `${String(Math.round(vh - r.top + GAP))}px` }
      : { top: `${String(Math.round(r.bottom + GAP))}px` }),
  }
}

function onReposition(): void {
  if (open.value) updatePosition()
}

// `scroll` ở pha CAPTURE: nút nằm trong `.msgs`, và sự kiện cuộn của một phần tử
// KHÔNG nổi bọt lên window — bắt ở pha bubble thì menu đứng yên khi transcript trôi.
watch(open, async (isOpen) => {
  if (isOpen) {
    updatePosition()
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    await nextTick()
    updatePosition()
  } else {
    window.removeEventListener('resize', onReposition)
    window.removeEventListener('scroll', onReposition, true)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onReposition)
  window.removeEventListener('scroll', onReposition, true)
})
</script>

<style scoped>
.hamore {
  position: relative;
  display: inline-flex;
}
/* Ghost icon button — proto `size-6` hit box (24px) + icon `size-3.5` (14px).
   Global `.ha` vẫn là hộp có viền 26px của skin cũ; scoped này override thành
   ghost: borderless, hover = accent-wash trung tính (shadcn ghost). */
.ha {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  flex: 0 0 auto;
}
.ha:hover {
  background: var(--accent-wash);
  color: var(--foreground);
}
.ha:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
/* Bật (bookmarked / menu đang mở / vừa copy xong): icon mang primary thay vì
   muted — cùng quy ước `.stab-btn.on`. */
.ha.on {
  color: var(--primary);
}
.ha:disabled,
.ha.off {
  opacity: 0.4;
  cursor: default;
}
.ha:disabled:hover,
.ha.off:hover {
  background: transparent;
  color: var(--muted-foreground);
}
/* Destructive (rewind / resend / regen / retry-model): đỏ khi hover — cảnh báo
   trước cú click, không phải sau dialog (session-destructive-action-guard §4.3). */
.ha.danger:hover {
  background: color-mix(in srgb, var(--destructive) 12%, transparent);
  color: var(--destructive);
}
/* Click-away catcher. Below the menu, above everything else in the transcript.
   Thang z "trên-modal": teleported ra body nên phải vượt mọi overlay chứa nó —
   `.wsed-ovl` 160 (board item), `.apeek.full` 400, `.ftovl` 470 — nếu không thì
   mở `⋯` trong modal/peek full sẽ bị overlay đó đè chìm hoàn toàn. */
.habackdrop {
  position: fixed;
  inset: 0;
  z-index: 560;
}
/* Teleported to <body>; `left` + `top`|`bottom` + `max-height` are set inline by
   updatePosition. See the comment in the template for what it is escaping.
   Skin = popover chuẩn (bg-popover + hairline border + radius) thay vì .smenu
   global vốn viền borderStrong. */
.hamenu {
  position: fixed;
  z-index: 570;
  min-width: 196px;
  overflow-y: auto;
  background: var(--popover);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 4px;
  box-shadow: var(--shadow-md);
}
/* Item trong popover này siết nhịp hơn .smenu global: text popover-foreground,
   radius kế thừa menu, hover accent-wash. */
.hamenu .mi {
  padding: 6px 8px;
  border-radius: var(--r-xs);
  color: var(--popover-foreground);
}
.hamenu .mi:hover {
  background: var(--accent-wash);
  color: var(--popover-foreground);
}
.hamenu .mi .ck {
  color: var(--primary);
}
.hamenu .mi.dmi {
  color: var(--destructive);
}
.hamenu .mi.dmi:hover {
  background: color-mix(in srgb, var(--destructive) 12%, transparent);
  color: var(--destructive);
}
.hasep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
</style>
