<template>
  <Teleport to="body">
    <div v-if="reportOpen" class="ovl on ltrp-ovl" @click.self="reportOpen = false">
      <div
        class="ltrp-card"
        role="dialog"
        aria-modal="true"
        :aria-label="t('logtime.report.title')"
      >
        <div class="ltrp-head">
          <div>
            <div class="ltrp-title">{{ t('logtime.report.title') }}</div>
            <div class="ltrp-sub">{{ longDateOf(date) }}</div>
          </div>
          <span class="ltrp-sp" />
          <button class="ltrp-x" :title="t('common.close')" @click="reportOpen = false">
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>

        <div class="ltrp-body">
          <div class="ltrp-opt">
            <span class="ltrp-lbl">{{ t('logtime.report.form') }}</span>
            <div class="seg">
              <span :class="{ on: reportForm === 'brief' }" @click="setReportForm('brief')">
                {{ t('logtime.report.form.brief') }}
              </span>
              <span :class="{ on: reportForm === 'markdown' }" @click="setReportForm('markdown')">
                {{ t('logtime.report.form.markdown') }}
              </span>
              <span :class="{ on: reportForm === 'json' }" @click="setReportForm('json')">
                {{ t('logtime.report.form.json') }}
              </span>
            </div>
          </div>

          <!--
            Dạng JSON chỉ chứa những dòng SẼ gửi đi được, nên nó ngắn hơn ngày.
            Không nói ra thì người dùng chép 5 dòng của một ngày 7 dòng mà tưởng
            đã đủ — đây là lời cảnh báo chứ không phải trang trí.
          -->
          <div v-if="report.excluded.length > 0" class="ltrp-warn bad">
            <Icon name="alert" class="ltrp-warnic" />
            <div class="ltrp-exwrap">
              <span>{{ t('logtime.report.excluded', { n: report.excluded.length }) }}</span>
              <div v-for="(x, i) in report.excluded" :key="i" class="ltrp-exrow">
                <span class="ltrp-exn">{{ x.line.project }} — {{ x.line.note }}</span>
                <span class="ltrp-exr">{{ t(REASON_KEY[x.reason]) }}</span>
              </div>
            </div>
          </div>

          <pre class="ltrp-code">{{ report.text }}</pre>
        </div>

        <div class="ltrp-foot">
          <span class="ltrp-hint">{{ t('logtime.report.hint') }}</span>
          <span class="ltrp-sp" />
          <button class="btn" type="button" @click="reportOpen = false">
            {{ t('common.close') }}
          </button>
          <button class="btn pri" type="button" @click="copyReport">
            <Icon name="copy" />
            {{ t('logtime.report.copy') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Báo cáo ngày — ba dạng (gọn / bảng markdown / payload JSON), ADR 0091.
//
// Cố ý KHÔNG có nút gửi: hộp này chỉ ĐỌC và CHÉP. Ghi lên PMS vẫn là một đường
// duy nhất qua `LogtimePushModal` (hai bước, có ô tích) — thêm một nút gửi thứ hai
// ở đây là nhân đôi cổng xác nhận cho cùng một thao tác.
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager } from '~/composables/useLogtimeManager'
import type { ReportExclusion } from '~/utils/logtime-report'

// Bảng tra TƯỜNG MINH chứ không nối chuỗi `'logtime.report.reason.' + reason`:
// thêm một lý do mới vào `ReportExclusion` mà quên nhãn thì record này thiếu khoá
// và TS báo ngay, còn nối chuỗi sẽ lặng lẽ in ra khoá thô giữa giao diện.
const REASON_KEY: Record<ReportExclusion, string> = {
  unlinked: 'logtime.report.reason.unlinked',
  alreadyOnPms: 'logtime.report.reason.alreadyOnPms',
  noHours: 'logtime.report.reason.noHours',
}

const { t } = useI18n()
const { reportOpen, reportForm, report, date, longDateOf, setReportForm, copyReport } =
  useLogtimeManager()
</script>

<style scoped>
.ltrp-ovl {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.ltrp-card {
  background: var(--bgPanel);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-lg);
  width: 100%;
  max-width: 680px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ltrp-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 16px;
  box-shadow: inset 0 -1px 0 var(--border);
  flex: 0 0 auto;
}
.ltrp-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
}
.ltrp-sub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ltrp-sp {
  flex: 1;
}
.ltrp-x {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: var(--r-xs);
  border: 1px solid transparent;
  background: none;
  color: var(--textDim);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.ltrp-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ltrp-body {
  padding: 14px 16px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ltrp-opt {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ltrp-lbl {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.ltrp-warn {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  border: 1px solid var(--amberBorder);
  background: var(--amberDim);
  border-radius: var(--r-btn);
  padding: 10px 12px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.ltrp-warn.bad {
  border-color: var(--dangerBorder);
  background: var(--dangerBg);
}
.ltrp-warnic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--amber);
}
.ltrp-exwrap {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
/* Một dòng bị loại = một hàng: tên dự án + note co lại, nhãn lý do đứng yên. */
.ltrp-exrow {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.ltrp-exn {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--textDim);
}
.ltrp-exr {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ltrp-code {
  margin: 0;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 11px;
  font-family: var(--code); /* mono-ok: báo cáo để chép ra ngoài (chat/PR/wiki) */
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textMuted);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.ltrp-foot {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  padding: 11px 16px;
  box-shadow: inset 0 1px 0 var(--border);
  flex: 0 0 auto;
}
.ltrp-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
</style>
