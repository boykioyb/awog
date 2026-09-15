<template>
  <div v-if="pins.length" class="bpin-row">
    <Icon name="pin" class="bpin-icn" style="width: var(--icon-xs); height: var(--icon-xs)" />
    <button
      v-for="pin in pins"
      :key="pin.url"
      type="button"
      class="bpin"
      :class="{ on: sameUrl(pin.url, currentUrl) }"
      :title="pin.url"
      @click="emit('open', pin.url)"
    >
      <span class="bpin-label">{{ labelOf(pin) }}</span>
      <span class="x" @click.stop="remove(pin.url)">×</span>
    </button>
  </div>
</template>

<script setup lang="ts">
// Dải trang đã ghim, dưới URL bar (ADR 0086 phần D).
//
// Ghim KHÔNG phải ghim tab: tab thuộc về agent — nó mở giữa lượt, đóng khi xong, và
// `browser.close()` xoá sạch lúc thoát app. Nên bấm một chip là mở tab MỚI trên URL
// đó, chứ không phải "quay lại tab cũ".
import { useBrowserPins } from '~/composables/useBrowserPins'

defineProps<{
  // URL đang TẢI THẬT (để tô accent chip của trang đang xem).
  currentUrl: string
}>()

const emit = defineEmits<{ open: [url: string] }>()

const { pins, remove, labelOf } = useBrowserPins()

// Bỏ dấu '/' cuối như store pin: `wc.getURL()` chuẩn hoá `https://x.com` thành
// `https://x.com/` còn URL gõ tay thì không — thiếu bước này chip không bao giờ sáng.
const sameUrl = (a: string, b: string): boolean =>
  !!a && a.replace(/\/+$/, '') === (b ?? '').replace(/\/+$/, '')
</script>

<style scoped>
.bpin-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  overflow-x: auto;
  flex-shrink: 0;
  box-shadow: inset 0 -1px 0 var(--border);
}
.bpin-icn {
  flex: 0 0 auto;
  color: var(--textFaint);
}
.bpin {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 150px;
  padding: 3px 8px;
  border-radius: var(--r-sm);
  background: transparent;
  border: 1px solid var(--border);
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}
.bpin:hover {
  border-color: var(--accentBorder);
  color: var(--text);
}
/* Trang đang xem = accent-tint, đúng quy ước selection (không fill xám). */
.bpin.on {
  background: var(--accentDim);
  border-color: var(--accentBorder);
  color: var(--text);
}
.bpin-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bpin .x {
  opacity: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.bpin:hover .x {
  opacity: 0.7;
}
</style>
