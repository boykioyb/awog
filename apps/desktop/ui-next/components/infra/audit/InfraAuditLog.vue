<template>
  <!-- Màn Nhật ký hoạt động (task 3.9). Đây là màn DUY NHẤT của `/infra` được nạp
       khi mở: nó đọc một file cục bộ, không tốn lời gọi AWS nào. -->
  <div class="ixa">
    <header class="ixa-hd">
      <div class="ixa-filters">
        <div class="seg">
          <span
            v-for="r in RANGES"
            :key="r"
            :class="{ on: range === r }"
            role="button"
            tabindex="0"
            @click="onRange(r)"
            @keydown.enter="onRange(r)"
          >
            {{ t(`infra.audit.range.${r}`) }}
          </span>
        </div>
        <label class="srch ixa-srch">
          <Icon name="search" />
          <input
            v-model="contains"
            :placeholder="t('infra.audit.filter.contains')"
            @change="load"
          />
        </label>
        <AppSelect
          v-model="klass"
          :options="classOptions"
          :placeholder="t('infra.audit.filter.class')"
          width="150px"
        />
        <AppSelect
          v-model="decision"
          :options="decisionOptions"
          :placeholder="t('infra.audit.filter.decision')"
          width="150px"
        />
        <label class="srch ixa-srch small">
          <input v-model="actor" :placeholder="t('infra.audit.filter.actor')" @change="load" />
        </label>
        <button class="btn sm" type="button" :disabled="loading" @click="load">
          <Icon name="refresh" />
          {{ t('infra.audit.reload') }}
        </button>
      </div>

      <div class="ixa-acts">
        <button class="btn sm" type="button" @click="exportAs('csv')">
          <Icon name="download" />
          CSV
        </button>
        <button class="btn sm" type="button" @click="exportAs('jsonl')">
          <Icon name="download" />
          JSONL
        </button>
        <button
          class="btn sm danger"
          type="button"
          :disabled="cleaning || !entries.length"
          @click="clean('filtered')"
        >
          <Icon name="trash" />
          {{ t('infra.audit.clean.title') }}
        </button>
        <button
          class="btn sm danger"
          type="button"
          :disabled="cleaning || !summary?.total"
          @click="clean('all')"
        >
          <Icon name="trash" />
          {{ t('infra.audit.clean.allTitle') }}
        </button>
      </div>
    </header>

    <!-- Dòng tổng nằm NGAY TRÊN bảng: "tuần này tôi chạy gì" phải trả lời được mà
         không cần đọc từng dòng. -->
    <p v-if="summary" class="ixa-sum">
      {{
        t('infra.audit.summary', {
          total: summary.total,
          write: summary.byClass['write'] ?? 0,
          destructive: summary.byClass['destructive'] ?? 0,
          denied: summary.byDecision['denied'] ?? 0,
        })
      }}
      <span v-if="loadedAt" class="ixa-when">
        {{ t('infra.audit.loadedAt', { time: hhmm(loadedAt) }) }}
      </span>
    </p>

    <div class="ixa-body" :class="{ 'has-detail': !!selected }">
      <div class="ixa-table-wrap tblcard">
        <p v-if="loading && !entries.length" class="ixa-state">{{ t('infra.audit.loading') }}</p>
        <p v-else-if="error" class="ixa-state err">{{ error }}</p>
        <p v-else-if="!entries.length" class="ixa-state">{{ t('infra.audit.empty') }}</p>
        <table v-else class="kt">
          <thead>
            <tr>
              <th>{{ t('infra.audit.col.at') }}</th>
              <th>{{ t('infra.audit.col.source') }}</th>
              <th>{{ t('infra.audit.col.tool') }}</th>
              <th>{{ t('infra.audit.col.class') }}</th>
              <th>{{ t('infra.audit.col.decision') }}</th>
              <th>{{ t('infra.audit.col.actor') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(e, i) in entries"
              :key="`${e.at}-${i}`"
              class="kt-click"
              :class="{ on: selected === e }"
              tabindex="0"
              @click="selected = e"
              @keydown.enter.prevent="selected = e"
            >
              <td class="ixa-at">{{ hhmm(e.at) }}</td>
              <td>
                <span class="chip">{{ sourceOf(e) }}</span>
              </td>
              <td class="ixa-tool" :title="commandOf(e)">{{ commandOf(e) }}</td>
              <td>
                <span class="chip" :class="`c-${e.class}`">
                  {{ t(`infra.audit.class.${e.class}`) }}
                </span>
              </td>
              <td>
                <span class="chip" :class="`d-${e.decision}`">
                  {{ t(`infra.audit.decision.${e.decision}`) }}
                </span>
              </td>
              <td class="ixa-actor">{{ e.actor || '—' }}</td>
              <td class="ixa-jump">
                <div class="ixa-rowbtns">
                  <!-- "Hỏi agent" cho MỘT dòng: đẩy dòng này (kèm JSON thô) vào hộp
                       chọn đích dùng chung — phiên hiện tại hay phiên mới. Đây là
                       chiều ngược lại của "agent đọc được nhật ký". -->
                  <button
                    class="btn sm"
                    type="button"
                    :title="t('infra.audit.ask.label')"
                    @click.stop="askAbout(e)"
                  >
                    <Icon name="sparkles" />
                  </button>
                  <!-- ↗ nhảy về phiên: chỉ hiện khi dòng THẬT SỰ có phiên + tin để
                       nhảy tới. Một nút dẫn tới hư không còn tệ hơn không có nút. -->
                  <button
                    v-if="e.sessionId && e.messageId"
                    class="btn sm"
                    type="button"
                    :title="t('infra.audit.jump.label')"
                    @click.stop="jumpToSession(e)"
                  >
                    <Icon name="forward" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <aside v-if="selected" class="ixa-detail">
        <header class="ixa-detail-hd">
          <Icon name="info" />
          <span class="ixa-detail-ttl">{{ t('infra.audit.detail.title') }}</span>
          <button class="btn sm" type="button" @click="selected = null">
            <Icon name="x" />
          </button>
        </header>
        <dl class="ixa-dl">
          <dt>{{ t('infra.audit.col.at') }}</dt>
          <dd>{{ selected.at }}</dd>
          <!-- Dòng nhật ký chỉ ghi `tool` + `surface`, và KHÔNG chỗ nào trên màn
               hiện chúng. Đây là chỗ trả lời "dòng này do cái gì chạy": `tool` là
               tên tool AWOG, `surface` là màn hình đã bấm. Cả hai đều là giá trị
               thô của hợp đồng, không dịch — chúng là định danh, không phải nhãn. -->
          <dt>{{ t('infra.audit.col.source') }}</dt>
          <dd>{{ sourceOf(selected) }}</dd>
          <dt>{{ t('infra.audit.detail.toolName') }}</dt>
          <dd>{{ selected.tool }}</dd>
          <dt>{{ t('infra.audit.col.surface') }}</dt>
          <dd>{{ selected.surface }}</dd>
          <dt>{{ t('infra.audit.col.context') }}</dt>
          <dd>{{ contextLine(selected) || '—' }}</dd>
          <dt>{{ t('infra.audit.col.result') }}</dt>
          <dd>{{ resultLine(selected) || '—' }}</dd>
        </dl>
        <pre class="ixa-json">{{ JSON.stringify(selected, null, 2) }}</pre>
      </aside>
    </div>

    <!-- CloudTrail (Mốc 7, 7.6). Sổ ở trên là thứ AWOG chạy; khối này là thứ TÀI KHOẢN
         bị chạm — kể cả do người khác, do Console, hay do một pipeline. Nó đứng DƯỚI,
         đóng sẵn, và có nút riêng: sổ ở trên đọc một file cục bộ, còn nó gọi mạng. -->
    <InfraTrailPanel />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import AppSelect from '~/components/common/AppSelect.vue'
import InfraTrailPanel from '~/components/infra/audit/InfraTrailPanel.vue'
import { useInfraAuditLog } from '~/composables/useInfraAuditLog'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import type { InfraAuditEntry } from '~/composables/useInfraResourcesApi'
import { infraAuditSource } from '~/utils/infra-audit-source'

const { t } = useI18n()
const {
  entries,
  summary,
  loading,
  error,
  loadedAt,
  selected,
  range,
  actor,
  klass,
  decision,
  contains,
  load,
  exportAs,
  clean,
  cleaning,
  jumpToSession,
} = useInfraAuditLog()

const { askAgent } = useInfraAskAgent()

/**
 * "Hỏi agent về dòng này" — dựng một khối có tiêu đề + JSON thô rồi giao cho hộp
 * chọn đích dùng chung (`useInfraAskAgent`): phiên hiện tại hay phiên mới trong
 * `awog-infra`. Ở đây KHÔNG tự gửi, và cũng không tự lọc bí mật — dòng nhật ký đã
 * qua `redactString()` lúc ghi đĩa, nên lọc lại là định nghĩa thứ hai về "bí mật".
 */
function askAbout(e: InfraAuditEntry): void {
  const lines = [
    `[nhật ký hạ tầng] ${e.at} — ${e.argv.join(' ')}`,
    `lớp=${e.class} · phán quyết=${e.decision} · người=${e.actor || '—'}`,
  ]
  const ctx = contextLine(e)
  if (ctx) lines.push(`ngữ cảnh: ${ctx}`)
  const res = resultLine(e)
  if (res) lines.push(`kết quả: ${res}`)
  lines.push('', '```json', JSON.stringify(e, null, 2), '```')
  void askAgent(lines.join('\n'), t('infra.audit.ask.source'))
}

const RANGES = ['24h', '7d', '30d', 'all'] as const

const classOptions = computed(() =>
  (['', 'read', 'write', 'destructive', 'context-switch'] as const).map((c) => ({
    value: c,
    label: c === '' ? t('infra.audit.filter.all') : t(`infra.audit.class.${c}`),
  })),
)
const decisionOptions = computed(() =>
  (['', 'auto', 'approved', 'denied', 'blocked', 'bypass-temp'] as const).map((d) => ({
    value: d,
    label: d === '' ? t('infra.audit.filter.all') : t(`infra.audit.decision.${d}`),
  })),
)

/** Mọi thay đổi bộ lọc đều nạp lại NGAY: nhật ký là file cục bộ, đọc lại là rẻ. */
function onRange(r: (typeof RANGES)[number]): void {
  range.value = r
  void load()
}
watch([klass, decision], () => void load())

onMounted(() => void load())

/** Nhận ISO (từ store nhật ký) HOẶC epoch ms (mốc "nạp lúc") — cả hai đều là thời gian. */
function hhmm(at: string | number): string {
  const d = new Date(at)
  return Number.isNaN(d.getTime())
    ? String(at)
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Nguồn của dòng: tên dịch vụ AWS (`ec2`, `logs`), tên CLI (terraform/kubectl),
 * hay tên tool với thao tác nội bộ AWOG. Luật nằm ở `utils/infra-audit-source.ts`.
 */
function sourceOf(e: InfraAuditEntry): string {
  return infraAuditSource(e)
}

/** Lệnh đã chạy, KHÔNG kèm tên binary — đúng những gì nhật ký ghi xuống đĩa. */
function commandOf(e: InfraAuditEntry): string {
  return e.argv.join(' ')
}

function contextLine(e: InfraAuditEntry): string {
  const c = e.context
  return [c.profile, c.region, c.accountId, c.cluster, c.namespace].filter(Boolean).join(' · ')
}

function resultLine(e: InfraAuditEntry): string {
  const r = e.result
  const parts: string[] = []
  if (r.exitCode !== undefined) parts.push(`exit ${r.exitCode}`)
  if (r.durationMs !== undefined) parts.push(`${r.durationMs}ms`)
  if (r.bytesScanned !== undefined) parts.push(`${r.bytesScanned}B`)
  if (r.summary) parts.push(r.summary)
  return parts.join(' · ')
}
</script>

<style scoped>
.ixa {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 12px 16px 14px;
  gap: 8px;
}

.ixa-hd {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.ixa-filters {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
}

.ixa-srch {
  max-width: 220px;
}

.ixa-srch.small {
  max-width: 140px;
}

.ixa-acts {
  display: flex;
  gap: 6px;
}

.ixa-acts .btn.danger,
.ixa .btn.danger {
  color: var(--red);
}

.ixa-sum {
  margin: 0;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.ixa-when {
  margin-left: 8px;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}

/* Bảng chiếm HẾT bề rộng khi chưa chọn dòng nào. Trước 2026-09-15 khai hai cột vô
   điều kiện, mà `<aside class="ixa-detail">` lại `v-if="selected"` — chưa chọn gì
   thì lưới vẫn giữ trọn cột thứ hai (tới 380px) và để trống, bảng bị dồn vào cột
   một rồi tự cuộn ngang (ảnh chụp: cột "Người chạy" bị cắt). Cột thứ hai chỉ tồn
   tại khi có thứ để đặt vào nó. */
.ixa-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  flex: 1;
  min-height: 0;
}

/* Trần của cột chi tiết bám theo bề rộng khung, không phải hằng số 380px.

   `minmax(260px, 380px)` là track KHÔNG co giãn: grid kéo nó tới đúng trần 380px
   bất kể khung hẹp bao nhiêu, phần còn lại mới chia cho cột bảng. Đo trên Chromium
   (khung 760/980/1240px, một dòng đang chọn): ở 1240 hai công thức cho kết quả Y HỆT
   NHAU (chi tiết 380 · bảng 799 — vì 34% của 1206px = 410 > 380, trần 380 thắng),
   nhưng ở 980 `min(380px, 34%)` nhường cho bảng 58px (cột lệnh 119 → 178px) và ở 760
   nó bớt được 120px tràn ngang (175 → 55px). Tức là: không đổi gì ở cửa sổ rộng,
   chỉ nới chỗ cho bảng khi khung hẹp. */
.ixa-body.has-detail {
  grid-template-columns: minmax(0, 1fr) minmax(260px, min(380px, 34%));
}

/* Skin card (viền · bo góc · nền · bóng) nằm ở `.tblcard` toàn cục — app-shell.css,
   cạnh nhóm elevation. Ở đây chỉ còn phần BỐ CỤC của riêng màn này. */
.ixa-table-wrap {
  overflow: auto;
}

.kt {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

.kt th {
  text-align: left;
  font-weight: 500;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bgSubtle);
}

.kt td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}

.kt-click {
  cursor: pointer;
}

.kt-click:hover td,
.kt-click.on td {
  background: var(--bgHover);
}

.ixa-at {
  font-variant-numeric: tabular-nums;
  color: var(--textMuted);
  white-space: nowrap;
}

/* Cột lệnh là cột DUY NHẤT co giãn, để bảng chạm mép phải: `width: 100%` hút hết
   chỗ còn thừa (mọi cột khác đều nowrap nên tự co theo nội dung) và `max-width: 0`
   chặn chính nội dung của nó quyết định bề rộng cột — một lệnh dài cắt bằng
   ellipsis thay vì đẩy bảng cuộn ngang. Trước đây cột này bị ghim `max-width:
   380px`, nên phần thừa chảy sang các cột chip và thành ô trống. */
.ixa-tool {
  width: 100%;
  max-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ixa-actor,
.ixa-jump {
  white-space: nowrap;
  width: 1%;
}

/* Hai nút của một dòng (hỏi agent · nhảy về phiên) đứng cạnh nhau, canh phải —
   thêm nút thứ ba sau này thì không phải sửa bố cục cột. */
.ixa-rowbtns {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.ixa-state {
  margin: 0;
  padding: 22px 14px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  text-align: center;
}

.ixa-state.err {
  color: var(--red);
}

.ixa-detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--bgPanel);
  overflow: hidden;
}

.ixa-detail-hd {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--textMuted);
}

.ixa-detail-ttl {
  flex: 1;
  color: var(--text);
  font-weight: 550;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.ixa-dl {
  margin: 0;
  padding: 8px 10px;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 8px;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.ixa-dl dt {
  color: var(--textDim);
}

.ixa-dl dd {
  margin: 0;
  color: var(--text);
  word-break: break-word;
}

.ixa-json {
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  flex: 1;
  /* mono-ok: JSON thô của một dòng nhật ký — bằng chứng, đọc và copy nguyên văn */
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textMuted);
  white-space: pre-wrap;
  word-break: break-word;
}

.chip.c-destructive,
.chip.d-denied,
.chip.d-blocked {
  color: var(--red);
  border-color: var(--red);
}

.chip.c-write,
.chip.d-approved {
  color: var(--green);
  border-color: var(--green);
}
</style>
