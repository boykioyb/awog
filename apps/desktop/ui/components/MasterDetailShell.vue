<!--
  MasterDetailShell.vue — Khung 2 pane list-trái + detail-phải tái sử dụng cho page pattern
  "danh sách rồi chọn 1 item để xem/edit chi tiết".

  Slots:
    - list           Toolbar + danh sách (left pane). Bắt buộc.
    - detail         Detail panel của item đang chọn (right pane). Optional, fallback empty-detail.
    - empty-detail   Render khi `selectedId == null` (right pane). Optional, fallback "Select an item".

  Props:
    - selectedId      ID item đang chọn (null = chưa chọn). Quyết định render `detail` vs `empty-detail`.
    - mobilePane      'list' | 'detail' — pane hiện ở mobile (< md). v-model:mobilePane.
    - listWidth       CSS width cho list pane từ md trở lên. Default '20rem' (w-80).
                      Truyền '18rem' (w-72), '14rem' (w-56), '15rem' (w-60), '24rem' (w-96)...
    - disableMobile   Bỏ logic single-pane mobile, cả 2 pane luôn hiển thị. Dùng cho /git
                      (đang fixed-width, không responsive collapse).
    - backLabel       Label nút Back ở mobile. Default 'Back'.

  Emits:
    - update:mobilePane   Khi user nhấn back button mobile → emit 'list'.

  Note:
    - State `mobilePane` do parent quản lý local (set 'detail' khi user select item).
      Component không tự đổi state khi `selectedId` đổi.
    - `listWidth` chỉ áp dụng tại breakpoint md trở lên (qua CSS var + @media). Ở mobile, list
      pane chiếm full width.
    - Edge case: page có 3 pane (workflows: list + canvas + inspector) thì wrap list+canvas
      trong shell và để inspector ngoài shell ở root.
-->
<template>
  <div class="md-shell flex flex-1 overflow-hidden" :style="{ '--list-width': effectiveListWidth }">
    <div
      class="md-shell-list flex flex-col flex-shrink-0"
      :class="listPaneClass"
      :style="{
        borderRight: resizable ? 'none' : `1px solid ${t.border}`,
        background: t.bgPanel,
      }"
    >
      <slot name="list" />
    </div>
    <div
      v-if="resizable"
      class="md-shell-resizer hidden md:block flex-shrink-0 group cursor-col-resize"
      :class="{ 'is-dragging': dragging }"
      :style="{
        width: '6px',
        background: dragging ? t.accent : t.border,
        marginLeft: '-1px',
        marginRight: '-1px',
        zIndex: 5,
      }"
      @mousedown="onDragStart"
      @dblclick="resetWidth"
    />
    <div
      class="flex-1 overflow-hidden flex flex-col min-w-0"
      :class="detailPaneClass"
      :style="{ background: t.bg }"
    >
      <button
        v-if="showBackButton"
        class="md:hidden flex items-center gap-1 px-3 py-2 text-xs transition flex-shrink-0"
        :style="{ color: t.textMuted, borderBottom: `1px solid ${t.border}` }"
        @click="onBack"
      >
        <ChevronLeft :size="14" />
        {{ backLabel }}
      </button>
      <template v-if="selectedId !== null">
        <slot name="detail" />
      </template>
      <template v-else>
        <slot name="empty-detail">
          <div
            class="flex-1 flex items-center justify-center text-sm"
            :style="{ color: t.textDim }"
          >
            Select an item
          </div>
        </slot>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ChevronLeft } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref } from 'vue'

type MobilePane = 'list' | 'detail'

type Props = {
  selectedId: string | null
  mobilePane?: MobilePane
  listWidth?: string
  disableMobile?: boolean
  backLabel?: string
  /** Enable drag-to-resize divider between list and detail panes (desktop only). */
  resizable?: boolean
  /** localStorage key to persist user-resized width. Falls back to in-memory. */
  storageKey?: string
  minListWidth?: number
  maxListWidth?: number
}

const props = withDefaults(defineProps<Props>(), {
  mobilePane: 'list',
  listWidth: '20rem',
  disableMobile: false,
  backLabel: 'Back',
  resizable: false,
  storageKey: '',
  minListWidth: 200,
  maxListWidth: 640,
})

const emit = defineEmits<{
  'update:mobilePane': [pane: MobilePane]
}>()

const { t } = useTheme()

const listPaneClass = computed(() => {
  if (props.disableMobile) return 'flex'
  return props.mobilePane === 'detail' ? 'hidden md:flex w-full' : 'flex w-full'
})

const detailPaneClass = computed(() => {
  if (props.disableMobile) return ''
  return props.mobilePane === 'list' ? 'hidden md:flex' : 'flex'
})

const showBackButton = computed(() => !props.disableMobile && props.mobilePane === 'detail')

const onBack = () => emit('update:mobilePane', 'list')

// ── Resize support ────────────────────────────────────────────────────────
const readStoredWidth = (): number | null => {
  if (!props.storageKey || typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(props.storageKey)
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

const currentWidthPx = ref<number | null>(readStoredWidth())
const dragging = ref(false)

const effectiveListWidth = computed(() => {
  if (props.resizable && currentWidthPx.value !== null) return `${currentWidthPx.value}px`
  return props.listWidth
})

const clamp = (n: number) => Math.max(props.minListWidth, Math.min(props.maxListWidth, n))

let dragStartX = 0
let dragStartWidth = 0

const onDragMove = (e: MouseEvent) => {
  const next = clamp(dragStartWidth + (e.clientX - dragStartX))
  currentWidthPx.value = next
}

const onDragEnd = () => {
  if (!dragging.value) return
  dragging.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  if (props.storageKey && currentWidthPx.value !== null) {
    try {
      window.localStorage.setItem(props.storageKey, String(currentWidthPx.value))
    } catch {
      // ignore quota / privacy errors
    }
  }
}

const onDragStart = (e: MouseEvent) => {
  if (!props.resizable) return
  e.preventDefault()
  // Read current rendered width so drag is relative to whatever the user sees now,
  // not whatever the initial prop said.
  const listEl = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null
  dragStartWidth = listEl?.getBoundingClientRect().width ?? props.minListWidth
  dragStartX = e.clientX
  dragging.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}

const resetWidth = () => {
  currentWidthPx.value = null
  if (props.storageKey) {
    try {
      window.localStorage.removeItem(props.storageKey)
    } catch {
      // ignore
    }
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
})
</script>

<style scoped>
@media (min-width: 768px) {
  .md-shell-list {
    width: var(--list-width);
  }
}

.md-shell-resizer {
  transition: background 120ms ease;
}
.md-shell-resizer:hover,
.md-shell-resizer.is-dragging {
  background-color: var(--md-shell-resizer-hover, currentColor);
}
</style>
