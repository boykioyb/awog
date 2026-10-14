<template>
  <!-- Empty-state của viewport: tab trắng (about:blank / chưa commit) hoặc chưa
       có tab nào. View native KHÔNG bao giờ gắn vào đây (useEmbeddedBrowser gate
       `hasPage`), nên DOM này thật sự nhìn thấy được — hướng dẫn ngắn + bookmark
       thành card lớn bấm-mở ngay. -->
  <div class="bempty">
    <Icon name="globe" class="bempty-icn" style="width: var(--icon-xl); height: var(--icon-xl)" />
    <div class="bempty-title">{{ t('browser.empty.title') }}</div>
    <div class="bempty-hint">{{ t('browser.empty.hint') }}</div>

    <div v-if="cards.length" class="bempty-pins">
      <button
        v-for="c in cards"
        :key="c.id"
        type="button"
        class="bempty-pin"
        :title="c.url"
        @click="emit('open', c.url)"
      >
        <Icon name="bookmark" style="width: var(--icon-sm); height: var(--icon-sm)" />
        <span class="bempty-pinname">{{ labelOf(c) }}</span>
        <span class="bempty-pinhost">{{ hostOf(c.url) }}</span>
      </button>
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

<style scoped>
.bempty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  max-width: 420px;
  margin: 0 auto;
  text-align: center;
  /* Panel dock dưới có thể thấp tới 120px — cuộn được thay vì bị cắt chữ. */
  max-height: 100%;
  overflow-y: auto;
}
.bempty-icn {
  color: var(--textFaint);
  margin-bottom: 2px;
}
.bempty-title {
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.bempty-hint {
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
/* Pin dạng card — to hơn chip của PinStrip vì đây là CTA chính, không phải dải
   phụ. Grid tự xuống dòng theo bề rộng panel (min 130px ⇒ 240px vẫn đủ 1 cột). */
.bempty-pins {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 6px;
  width: 100%;
  margin-top: 10px;
}
.bempty-pin {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 8px 10px;
  border-radius: var(--r-card);
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  cursor: pointer;
  text-align: left;
  overflow: hidden;
}
.bempty-pin:hover {
  background: var(--bgHover);
  border-color: var(--accentBorder);
}
.bempty-pin:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.bempty-pin .icn {
  color: var(--textFaint);
  flex-shrink: 0;
}
.bempty-pinname {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}
.bempty-pinhost {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
</style>
