<template>
  <!-- Empty-state của viewport: tab trắng (about:blank / chưa commit) hoặc chưa
       có tab nào. View native KHÔNG bao giờ gắn vào đây (useEmbeddedBrowser gate
       `hasPage`), nên DOM này thật sự nhìn thấy được — hướng dẫn ngắn + bookmark
       thành card lớn bấm-mở ngay. Panel dock dưới có thể thấp tới 120px — cuộn
       được thay vì bị cắt chữ. -->
  <div
    class="mx-auto flex max-h-full max-w-105 flex-col items-center justify-center gap-1.5 overflow-y-auto p-6 text-center"
  >
    <Icon name="globe" class="mb-0.5 size-6 text-faint" />
    <div class="text-base text-foreground">{{ t('browser.empty.title') }}</div>
    <div class="text-sm text-muted-foreground">{{ t('browser.empty.hint') }}</div>

    <!-- Pin dạng card — to hơn chip của PinStrip vì đây là CTA chính, không phải dải
         phụ. Grid tự xuống dòng theo bề rộng panel (min 130px ⇒ 240px vẫn đủ 1 cột). -->
    <div
      v-if="cards.length"
      class="mt-2.5 grid w-full grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-1.5"
    >
      <Button
        v-for="c in cards"
        :key="c.id"
        variant="outline"
        class="h-auto flex-col items-start gap-1 overflow-hidden rounded-xl px-2.5 py-2 text-left font-normal hover:border-selected-border [&_svg]:size-3.5 [&_svg]:text-faint"
        :title="c.url"
        @click="emit('open', c.url)"
      >
        <Icon name="bookmark" />
        <span class="max-w-full truncate text-sm text-foreground">{{ labelOf(c) }}</span>
        <span class="max-w-full truncate text-xs text-faint">{{ hostOf(c.url) }}</span>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Empty-state "trang trắng" của trình duyệt nhúng — dùng chung cho panel
// (WorkspaceBrowser), main-tab (SessionDetail) và cửa sổ popout (pages/browser.vue).
// Card lấy từ bookmark của HỒ SƠ hiệu lực (ADR 0101) — cùng cây với thanh bookmark
// trong BrowserNavBar. Thư mục được trải phẳng: card là lối tắt nhanh, không phải
// trình quản lý bookmark.
import { useBookmarks } from '~/composables/useBookmarks'
import { useScopeProfile } from '~/composables/useBrowserProfiles'

const props = defineProps<{
  // Scope sở hữu bề mặt (engineId phiên; vắng = pool global) → chọn đúng hồ sơ.
  scope?: string
}>()

const emit = defineEmits<{
  // Bấm card → mở URL đó. Bề mặt quyết định navigate tab trắng hiện tại hay
  // tạo tab mới (WorkspaceBrowser gán vào urlDraft rồi submitUrl).
  open: [url: string]
}>()

const { t } = useI18n()
const { profileId } = useScopeProfile(
  () => props.scope,
  () => undefined,
)
const bm = useBookmarks(() => profileId.value)
const labelOf = bm.labelOf

// Đủ để hữu ích, đủ ít để lưới không tràn khung trống.
const MAX_CARDS = 12
const cards = computed(() => bm.flat.value.map((e) => e.node).slice(0, MAX_CARDS))
// Host nhỏ dưới tên card — đọc nhanh hơn nhìn nguyên URL. Lỗi parse → chuỗi rỗng.
const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
</script>
