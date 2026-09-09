<template>
  <div v-if="show" class="btstrip">
    <div class="bthead">
      <Icon name="book" style="width: var(--icon-sm); height: var(--icon-sm)" />
      <span class="bttitle">{{ t('translate.title') }}</span>
      <div class="btlangs">
        <button
          v-for="l in TRANSLATE_LANGS"
          :key="l"
          type="button"
          class="btlang"
          :class="{ on: lang === l }"
          :title="LANG_LABEL[l]"
          @click="setLang(l)"
        >
          {{ l.toUpperCase() }}
        </button>
      </div>
      <button type="button" class="btx" :title="t('common.close')" @click="close">
        <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </div>

    <div class="btbody">
      <div v-if="loading" class="btstatus">{{ t('translate.loading') }}</div>
      <div v-else-if="error" class="btstatus err">
        <span>{{ t('translate.error') }}</span>
        <button type="button" class="btbtn" @click="retry">{{ t('translate.retry') }}</button>
      </div>
      <div v-else class="btresult">{{ result }}</div>
    </div>

    <div v-if="!loading && !error && result" class="btfoot">
      <button type="button" class="btbtn" @click="copyResult">
        <Icon
          :name="copied ? 'check' : 'copy'"
          style="width: var(--icon-xs); height: var(--icon-xs)"
        />
        {{ copied ? t('translate.copied') : t('translate.copy') }}
      </button>
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

<style scoped>
.btstrip {
  flex-shrink: 0;
  box-shadow: inset 0 -1px 0 var(--border);
  background: var(--bgEl);
}
.bthead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.bttitle {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.btlangs {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
}
/* Accent-tint cho bậc đang chọn (không fill xám — quy ước segmented control). */
.btlang {
  padding: 2px 7px;
  border-radius: var(--r-sm);
  background: transparent;
  border: 1px solid transparent;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}
.btlang:hover {
  background: var(--bgHover);
  color: var(--text);
}
.btlang.on {
  background: var(--accentDim);
  border-color: var(--accentBorder);
  color: var(--text);
}
.btx {
  flex: 0 0 auto;
  display: flex;
  padding: 3px;
  border-radius: var(--r-sm);
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
}
.btx:hover {
  background: var(--bgHover);
  color: var(--text);
}
.btbody {
  padding: 0 10px 8px;
  /* Dải, không phải khung đọc: cao vừa vài dòng rồi cuộn. */
  max-height: 132px;
  overflow-y: auto;
}
.btresult {
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  word-break: break-word;
  user-select: text;
  white-space: pre-wrap;
}
.btstatus {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.btstatus.err {
  color: var(--danger);
}
.btfoot {
  display: flex;
  justify-content: flex-end;
  padding: 0 8px 7px;
}
.btbtn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: var(--r-btn);
  background: transparent;
  border: 1px solid var(--border);
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}
.btbtn:hover {
  border-color: var(--accentBorder);
  color: var(--text);
}
</style>
