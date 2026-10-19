<template>
  <!-- Hiện/ẩn theo hover do CHA quyết (class truyền xuống root) — component này chỉ
       dựng hàng nút. -->
  <div class="flex items-center gap-0.5">
    <!-- Nút icon ghost 24px + icon 14px. Bật (đã bookmark / vừa copy) = icon primary.
         Destructive (rewind / resend / regen / retry-model): đỏ khi hover — cảnh báo
         trước cú click, không phải sau dialog (session-destructive-action-guard §4.3). -->
    <Button
      v-for="a in primary"
      :key="a.icon"
      type="button"
      variant="ghost"
      size="iconSm"
      class="size-6 rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
      :class="{
        'hover:bg-destructive/10 hover:text-destructive': a.danger,
        'text-primary': a.active,
      }"
      :disabled="a.disabled"
      :title="a.title"
      :aria-label="a.title"
      @click="a.run"
    >
      <Icon :name="a.icon" />
    </Button>

    <!-- Overflow. Everything rare or destructive lives here (session-ui-refactor §3.3):
         a destructive action must never sit unlabelled next to `copy` at the same
         weight. Anchored to this span, opening UPWARD because the footer is the last
         row of a turn — a downward menu would fall off the transcript. -->
    <span v-if="overflow.length" ref="moreRef" class="relative inline-flex">
      <Button
        type="button"
        variant="ghost"
        size="iconSm"
        class="size-6 rounded-sm text-muted-foreground hover:text-foreground"
        :class="{ 'text-primary': open }"
        :title="t('sessions.message.more')"
        :aria-label="t('sessions.message.more')"
        :aria-expanded="open"
        @click.stop="open = !open"
      >
        <Icon name="dots" />
      </Button>

      <!-- Teleport ra <body> + định vị FIXED.
           ⚠ Bản trước là `position: absolute; bottom: 130%`, tức luôn mở LÊN TRÊN từ
           bên trong `.msgs` (`overflow-y: auto`) — nên message nào có footer nằm trong
           khoảng chiều cao menu tính từ mép trên vùng cuộn thì mất phần trên của menu,
           kể cả message ĐẦU TIÊN của phiên. Đo được: 132/184px nằm ngoài, và
           `elementFromPoint` ở đó trả `null`. Không z-index nào cứu được: đây là cắt
           bởi tổ tiên, không phải bị đè. -->
      <Teleport to="body">
        <template v-if="open">
          <!-- Bắt click ra ngoài. Thang z "trên-modal": teleport ra body nên phải vượt
               mọi overlay chứa nó — `.wsed-ovl` 160 (board item), `.apeek.full` 400,
               `.ftovl` 470 — nếu không thì mở `⋯` trong modal/peek full sẽ bị overlay
               đó đè chìm hoàn toàn. -->
          <div class="fixed inset-0 z-560" @click.stop="open = false" />
          <!-- `left` + `top`|`bottom` + `max-height` do updatePosition đặt inline. -->
          <!-- role=dialog + data-state=open: khớp selector `[role="dialog"][data-state="open"]`
               trong OVERLAYS (useEmbeddedBrowser.ts) để trình duyệt nhúng nhường chỗ. -->
          <div
            ref="menuRef"
            role="dialog"
            data-state="open"
            class="fixed z-570 min-w-49 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
            :style="menuStyle"
            @click.stop
          >
            <template v-for="(a, i) in overflow" :key="i">
              <Separator v-if="'sep' in a" class="mx-1.5 my-1 w-auto" />
              <div
                v-else
                class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm [&_svg]:size-3.5"
                :class="
                  a.danger
                    ? 'text-destructive hover:bg-destructive/10'
                    : 'hover:bg-accent hover:text-accent-foreground'
                "
                @click="run(a)"
              >
                <Icon :name="a.icon" />
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
