<template>
  <!-- "Hôm nay bạn đã làm" — CỘT PHẢI của màn Ngày (theo artifact), chứa việc AWOG TỰ
       ĐO được trong ngày: phiên chat có hoạt động + task tạo trong ngày, CHỈ của dự án
       đã nối PMS (sidecar lọc sẵn). Bấm một thẻ là đổ dự án + việc vào form nhanh bên
       trái, người dùng chốt giờ bằng nút ± rồi bấm "Thêm dòng". Nguồn cố ý KHÔNG mang
       `hours` (xem `LogtimeSuggestion`) nên KHÔNG có "→ 2.5h" hay "+ Thêm 2.5h" như bản
       phác tĩnh — bịa một con số ở đây là đẩy phỏng đoán lên PMS như giờ công thật. -->
  <aside v-if="hasSuggestions" class="ltrail">
    <div class="ltrailh">
      <Icon name="sparkles" class="ltrailic" />
      <span class="ltrt">{{ t('logtime.suggest.title') }}</span>
      <span v-if="pendingSuggestions > 0" class="tag warn">
        {{ t('logtime.suggest.pending', { n: pendingSuggestions }) }}
      </span>
      <span v-else-if="suggestionRows.length > 0" class="tag acc">
        {{ t('logtime.suggest.allLogged') }}
      </span>
      <span class="ltsp" />
      <button
        type="button"
        class="ltrailre"
        :disabled="store.busy"
        :title="t('logtime.suggest.reload')"
        @click="loadSuggestions"
      >
        <Icon name="refresh" />
      </button>
    </div>

    <div class="ltrailscroll">
      <!-- Nạp hỏng thì phải NÓI RA. Nuốt lỗi ở đây thì một lần RPC hỏng trông y hệt một
           ngày không làm gì — đúng cái người dùng không thể phân biệt được. -->
      <p v-if="store.suggestionsError" class="ltsugerr">
        <Icon name="alert" />
        <span>{{ t('logtime.suggest.failed') }}</span>
      </p>

      <div
        v-for="row in suggestionRows"
        :key="`${row.suggestion.kind}:${row.suggestion.refId}`"
        class="ltsugc"
        :class="{ done: row.logged, on: row.staged }"
      >
        <div class="ltsugc-top">
          <span class="chip">
            <span>{{ row.kindLabel }}</span>
          </span>
          <i class="ltdot" :style="{ background: row.color }" />
          <span class="ltsugc-proj">{{ row.project }}</span>
          <span class="ltsp" />
          <span v-if="row.clock" class="ltsugc-clock tnum">{{ row.clock }}</span>
          <!-- Mở phiên nguồn (chỉ gợi ý từ phiên; gợi ý từ task không có phiên). -->
          <button
            v-if="row.suggestion.kind === 'session'"
            type="button"
            class="ltsugc-open"
            :title="t('logtime.suggest.openSession')"
            :aria-label="t('logtime.suggest.openSession')"
            @click="openSession(row.suggestion)"
          >
            <Icon name="external" />
          </button>
        </div>

        <div class="ltsugc-title">{{ row.suggestion.title }}</div>

        <div class="ltsugc-foot">
          <!-- Đã khai / đang ở form: giữ thẻ nằm đó (biến mất thì không phân biệt được
               "đã ăn" với "panel hỏng"), chỉ đổi trạng thái nút thành nhãn. -->
          <span v-if="row.logged" class="ltsugc-state">
            <Icon name="check" />
            <span>{{ t('logtime.suggest.logged') }}</span>
          </span>
          <span v-else-if="row.composing" class="ltsugc-state on">
            <Icon name="refresh" class="ltsugc-spin" />
            <span>{{ t('logtime.suggest.composing') }}</span>
          </span>
          <span v-else-if="row.staged" class="ltsugc-state on">
            {{ t('logtime.suggest.staged') }}
          </span>
          <button v-else type="button" class="ltsugc-add" @click="useSuggestion(row.suggestion)">
            <Icon name="plus" />
            <span>{{ t('logtime.suggest.add') }}</span>
          </button>

          <a
            v-if="row.issueUrl"
            class="chip"
            :href="row.issueUrl"
            target="_blank"
            rel="noopener"
            :title="t('logtime.row.openIssue', { n: row.suggestion.issue ?? 0 })"
          >
            <Icon name="link" />
            <span>#{{ row.suggestion.issue }}</span>
          </a>
          <span v-else-if="row.suggestion.issue !== undefined" class="chip">
            <span>#{{ row.suggestion.issue }}</span>
          </span>
        </div>
      </div>

      <!-- Việc ở dự án CHƯA nối PMS: sidecar không dựng thành thẻ (dòng thêm ra không
           đẩy được), nhưng phải nói ra — giấu đi thì người dùng tưởng hôm đó không làm
           gì. Nối dự án ở tab Thiết lập là hết. -->
      <p v-if="store.suggestionsUntracked > 0" class="ltsugnote">
        {{ t('logtime.suggest.untracked', { n: store.suggestionsUntracked }) }}
      </p>
      <!-- Việc CÓ thật nhưng không thuộc dự án nào nên không dựng nổi dòng công. -->
      <p v-if="store.suggestionsSkipped > 0" class="ltsugnote">
        {{ t('logtime.suggest.skipped', { n: store.suggestionsSkipped }) }}
      </p>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager } from '~/composables/useLogtimeManager'

// Không prop, không emit: state sống ở singleton cấp module (xem `useLogtimeManager`),
// nên component con tự gọi thay vì nhận prop từ `LogtimeDay` — cùng lối với `LogtimeRow`.
const { t } = useI18n()
const {
  store,
  suggestionRows,
  pendingSuggestions,
  hasSuggestions,
  useSuggestion,
  openSession,
  loadSuggestions,
} = useLogtimeManager()
</script>

<style scoped>
/* Cột phải, dán liền khung ngày bằng đường kẻ dọc — cùng ngôn ngữ với cột tháng bên
   trái. `flex: 0 0 272px` khớp bản phác; hẹp hơn thì tiêu đề việc bị cắt sớm. */
.ltrail {
  flex: 0 0 272px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--border);
  background: var(--bgPanel);
}
.ltrailh {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 11px 13px;
  /* `inset` chứ không `border-bottom`: thanh không cao cố định nhưng giữ cùng quy ước
     hairline với các thanh khác của trang. */
  box-shadow: inset 0 -1px 0 var(--border);
}
.ltrailic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--textDim);
  flex: 0 0 auto;
}
.ltrt {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  min-width: 0;
}
.ltsp {
  flex: 1;
}
/* Nút nạp lại: hộp cố định nên `padding: 0` phải khai tường minh — `.ltop` của
   prototype.css đã từng lọt qua đúng chỗ này ở `LogtimeRow` và đẩy icon vào góc. */
.ltrailre {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: var(--r-xs);
  border: 1px solid transparent;
  background: none;
  color: var(--textFaint);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex: 0 0 auto;
}
.ltrailre:hover:not(:disabled) {
  background: var(--bgHover);
  color: var(--text);
}
.ltrailre:disabled {
  opacity: 0.5;
  cursor: default;
}
.ltrailscroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 11px 13px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Thẻ gợi ý ── */
.ltsugc {
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgSubtle);
  padding: 10px 11px;
  min-width: 0;
}
/* Đang ở form = accent-tint, cùng ngôn ngữ với hàng đang chọn `.ltrow.editing`. */
.ltsugc.on {
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
/* Đã khai rồi thì vẫn nằm đó, chỉ mờ đi. */
.ltsugc.done {
  opacity: 0.55;
}
.ltsugc-top {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 6px;
  min-width: 0;
}
.ltdot {
  width: 8px; /* design-token-ok: chấm màu dự án là hình tròn nhỏ cố định */
  height: 8px; /* design-token-ok: như trên */
  border-radius: 50%;
  flex: 0 0 auto;
}
.ltsugc-proj {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltsugc-clock {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  flex: 0 0 auto;
}
/* Mở phiên: nút icon nhỏ, hộp cố định nên `padding: 0` khai tường minh (bài học `.ltop`). */
.ltsugc-open {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: var(--r-xs);
  border: 1px solid transparent;
  background: none;
  color: var(--textFaint);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex: 0 0 auto;
}
.ltsugc-open:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ltsugc-open > .icn {
  width: var(--icon-xs);
  height: var(--icon-xs);
}
.ltsugc-title {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 550;
  margin-bottom: 9px;
  word-break: break-word;
}
.ltsugc-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.ltsugc-add {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: none;
  color: var(--textDim);
  font-family: inherit;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
}
.ltsugc-add:hover {
  background: var(--accentDim);
  border-color: var(--accentBorder);
  color: var(--accent);
}
.ltsugc-add > .icn {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex: 0 0 auto;
}
.ltsugc-state {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.ltsugc-state.on {
  color: var(--accent);
}
.ltsugc-state > .icn {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex: 0 0 auto;
}
.ltsugc-spin {
  animation: ltsugc-rot 0.9s linear infinite;
}
@keyframes ltsugc-rot {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ltsugc-spin {
    animation: none;
  }
}
.ltsugerr {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--danger);
}
.ltsugerr > .icn {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
}
.ltsugnote {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}

/* Hẹp thì rail thôi làm cột: xuống dưới nội dung ngày, viền trái đổi thành hairline
   trên, và thôi cuộn riêng — `.ltdwrap` (cha) lúc này cuộn cả khối. Ngưỡng khớp cha. */
@media (max-width: 1120px) {
  .ltrail {
    flex: 0 0 auto;
    border-left: 0;
    box-shadow: inset 0 1px 0 var(--border);
    overflow: visible;
  }
  .ltrailscroll {
    flex: 0 0 auto;
    overflow: visible;
  }
}
</style>
