<template>
  <div v-if="show" class="shrink-0 bg-card shadow-[inset_0_-1px_0_var(--color-border)]">
    <div class="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
      <Icon name="book" class="size-3.5" />
      <span class="min-w-0 flex-1 truncate">{{ t('translate.title') }}</span>
      <!-- Accent-tint cho bậc đang chọn (không fill xám — quy ước segmented control).
           Đổi ngôn ngữ đi qua @click của từng mục: `setLang` là nguồn duy nhất của
           `lang`, ToggleGroup chỉ phản chiếu (bấm lại mục đang chọn không bỏ chọn). -->
      <ToggleGroup type="single" :model-value="lang" :spacing="0.5" class="flex-none">
        <ToggleGroupItem
          v-for="l in TRANSLATE_LANGS"
          :key="l"
          :value="l"
          class="h-auto min-w-0 border border-transparent px-1.5 py-0.5 text-xs font-normal text-muted-foreground hover:bg-accent hover:text-foreground data-[state=on]:border-selected-border data-[state=on]:bg-selected data-[state=on]:text-foreground"
          :title="LANG_LABEL[l]"
          @click="setLang(l)"
        >
          {{ l.toUpperCase() }}
        </ToggleGroupItem>
      </ToggleGroup>
      <Button
        variant="ghost"
        size="iconSm"
        class="size-6 flex-none text-muted-foreground"
        :title="t('common.close')"
        :aria-label="t('common.close')"
        @click="close"
      >
        <Icon name="x" />
      </Button>
    </div>

    <!-- Dải, không phải khung đọc: cao vừa vài dòng rồi cuộn. -->
    <div class="max-h-33 overflow-y-auto px-2.5 pb-2">
      <div v-if="loading" class="flex items-center gap-2 text-sm text-muted-foreground">
        {{ t('translate.loading') }}
      </div>
      <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive">
        <span>{{ t('translate.error') }}</span>
        <Button variant="outline" size="xs" @click="retry">{{ t('translate.retry') }}</Button>
      </div>
      <div
        v-else
        class="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground select-text"
      >
        {{ result }}
      </div>
    </div>

    <div v-if="!loading && !error && result" class="flex justify-end px-2 pb-2">
      <Button
        variant="outline"
        size="xs"
        class="gap-1 text-muted-foreground [&_svg]:size-3"
        @click="copyResult"
      >
        <Icon :name="copied ? 'check' : 'copy'" />
        {{ copied ? t('translate.copied') : t('translate.copy') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Kết quả dịch cho selection nằm TRONG TRANG của trình duyệt nhúng.
//
// VÌ SAO KHÔNG DÙNG POPOVER DÙNG CHUNG. Trang là một `WebContentsView` native,
// vẽ trên toàn bộ DOM: một popover đặt lên nó thì vô hình, và cách duy nhất để
// thấy popover là gỡ trang khỏi màn hình — đúng thứ phá việc người dùng đang làm
// (bôi đen để đối chiếu bản dịch VỚI trang; lỗi thật 2026-09-09: người dùng thấy
// "Hidden while a dialog is open" thay cho trang). Strip này nằm trong CHROME,
// tức vùng DOM ở ngoài rect của view, nên không ai phải ẩn đi.
//
// Dùng lại nguyên `useSelectionTranslate`: cùng state, cùng cache theo
// (lang, text), cùng RPC `text.translate`, cùng bộ chọn ngôn ngữ. Chỉ CHỖ RENDER
// là khác — đó là toàn bộ lý do file này tồn tại, và cũng là lý do nó không được
// giữ state dịch của riêng mình.
//
// Khác popover một điểm có chủ ý: in `result` dạng text thuần, không render
// markdown. Đây là một dải cao 3–4 dòng trong thanh công cụ, không phải khung đọc;
// và `result` ở đây luôn là văn bản người dùng vừa bôi đen trên một trang web
// (L1) — càng ít đường biến nó thành HTML càng tốt.
import { useSelectionTranslate } from '~/composables/useSelectionTranslate'

const { t } = useI18n()
const {
  active,
  lang,
  loading,
  result,
  error,
  copied,
  TRANSLATE_LANGS,
  LANG_LABEL,
  setLang,
  retry,
  close,
  copyResult,
} = useSelectionTranslate()

// Chỉ hiện cho nguồn 'browser' — selection trong DOM vẫn là việc của popover.
const show = computed(() => active.value?.surface === 'browser')
</script>
