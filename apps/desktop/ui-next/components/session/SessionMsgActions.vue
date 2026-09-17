<template>
  <div class="hoveract bottom">
    <span
      v-for="a in primary"
      :key="a.icon"
      class="ha"
      :class="{ danger: a.danger, on: a.active, off: a.disabled }"
      :title="a.title"
      @click="a.run"
    >
      <Icon :name="a.icon" style="width: var(--icon-sm); height: var(--icon-sm)" />
    </span>

    <!-- Overflow. Everything rare or destructive lives here (session-ui-refactor §3.3):
         a destructive action must never sit unlabelled next to `copy` at the same
         weight. Anchored to this span, opening UPWARD because the footer is the last
         row of a turn — a downward menu would fall off the transcript. -->
    <span v-if="overflow.length" ref="moreRef" class="hamore">
      <span
        class="ha"
        :class="{ on: open }"
        :title="t('sessions.message.more')"
        @click.stop="open = !open"
      >
        <Icon name="dots" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </span>

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
// Action set below one transcript turn. Three controls stay inline (copy · quote ·
// bookmark for the assistant, copy · fullscreen · bookmark for the user); everything
// rare or transcript-cutting moves behind `⋯`.
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
/* Click-away catcher. Below the menu, above everything else in the transcript. */
.habackdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}
/* Teleported to <body>; `left` + `top`|`bottom` + `max-height` are set inline by
   updatePosition. See the comment in the template for what it is escaping. */
.hamenu {
  position: fixed;
  z-index: 50;
  min-width: 196px;
  overflow-y: auto;
}
.hasep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
</style>
