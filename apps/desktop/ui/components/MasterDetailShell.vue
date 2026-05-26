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
  <div class="md-shell flex flex-1 overflow-hidden" :style="{ '--list-width': listWidth }">
    <div
      class="md-shell-list flex flex-col flex-shrink-0"
      :class="listPaneClass"
      :style="{ borderRight: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <slot name="list" />
    </div>
    <div
      class="flex-1 overflow-hidden flex flex-col"
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
import { computed } from 'vue'

type MobilePane = 'list' | 'detail'

type Props = {
  selectedId: string | null
  mobilePane?: MobilePane
  listWidth?: string
  disableMobile?: boolean
  backLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  mobilePane: 'list',
  listWidth: '20rem',
  disableMobile: false,
  backLabel: 'Back',
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
</script>

<style scoped>
@media (min-width: 768px) {
  .md-shell-list {
    width: var(--list-width);
  }
}
</style>
