<template>
  <!-- Chạy + hồ sơ sau khi chạy (việc 5.5). Hồ sơ là bản GHI BẤT BIẾN: bản nào, ai
       duyệt, chạy lúc nào, bước nào mất bao lâu, bước nào lỗi — nên nó không sửa
       được, chỉ đọc. Chưa chạy lượt nào trong phiên này thì panel nói cách bắt đầu. -->
  <section class="pbr">
    <h3 class="pbr-hd">{{ t('playbooks.run.title') }}</h3>

    <!-- Lượt chạy vừa xong trong phiên này -->
    <div v-if="run" class="pbr-card">
      <div class="pbr-line">
        <span class="pbr-st" :class="`st-${run.status}`">
          {{ t(`playbooks.status.${run.status}`) }}
        </span>
        <span class="pbr-when">{{ when(run.createdAt) }}</span>
        <span class="pbr-done">{{ doneLabel(run) }}</span>
      </div>
      <div class="pbr-line muted">
        <span>{{ approverLabel(run) }}</span>
      </div>
      <!-- Đóng băng vào Wiki là bề mặt PHỤ: hỏng nó không làm lượt chạy hỏng, nên
           đây chỉ là một dòng ghi chú — nhưng phải có, đừng nuốt. -->
      <div v-if="run.frozen || run.freezeError" class="pbr-line muted">
        <span v-if="run.frozen" class="pbr-ok">
          {{ t('playbooks.run.frozen', { page: run.wikiPage ?? '' }) }}
        </span>
        <span v-if="run.freezeError" class="pbr-bad">
          {{ t('playbooks.run.freezeError', { error: run.freezeError }) }}
        </span>
      </div>
      <ol class="pbr-steps">
        <li v-for="res in run.steps" :key="res.stepId" class="pbr-step">
          <span class="pbr-step-no">{{ indexOf(res.stepId) + 1 }}</span>
          <span class="pbr-step-ttl" :title="res.command">{{ titleOf(res.stepId) }}</span>
          <span class="pbr-step-st" :class="`st-${res.status}`">
            {{ t(`playbooks.run.state.${res.status}`) }}
          </span>
          <span class="pbr-step-time">
            {{ t('playbooks.run.duration', { ms: res.durationMs }) }}
          </span>
          <span v-if="res.exitCode !== null" class="pbr-step-exit">
            {{ t('playbooks.run.exit', { code: res.exitCode }) }}
          </span>
        </li>
      </ol>
    </div>

    <!-- Chưa chạy: kết quả kiểm tra trước (nếu đã bấm) hoặc lời mời bắt đầu -->
    <div v-else-if="preflight" class="pbr-card">
      <div class="pbr-line">
        <span class="pbr-hd-sub">{{ t('playbooks.run.preflightTitle') }}</span>
      </div>
      <!-- `PlaybookCheckResult` chỉ có `ok` — nó KHÔNG phải một bước đã chạy, nên
           không có thời lượng. Đừng bịa một con số cho vừa bảng. -->
      <ol class="pbr-steps">
        <li v-for="res in preflight" :key="res.stepId" class="pbr-step">
          <span class="pbr-step-no">{{ indexOf(res.stepId) + 1 }}</span>
          <span class="pbr-step-ttl" :title="res.command">{{ titleOf(res.stepId) }}</span>
          <span class="pbr-step-st" :class="res.ok ? 'st-ok' : 'st-failed'">
            {{ t(`playbooks.run.state.${res.ok ? 'ok' : 'failed'}`) }}
          </span>
          <span v-if="res.reason" class="pbr-step-exit">{{ res.reason }}</span>
        </li>
      </ol>
    </div>

    <p v-else class="pbr-empty">{{ t('playbooks.run.none') }}</p>

    <!-- Hồ sơ các lần chạy trước -->
    <div class="pbr-hist">
      <h4 class="pbr-hd-sub">{{ t('playbooks.run.historyTitle') }}</h4>
      <p v-if="!runs.length" class="pbr-empty">{{ t('playbooks.run.historyNone') }}</p>
      <ul v-else class="pbr-hitems">
        <li v-for="rec in runs" :key="rec.id" class="pbr-hitem">
          <span class="pbr-st" :class="`st-${rec.status}`">
            {{ t(`playbooks.status.${rec.status}`) }}
          </span>
          <span class="pbr-when">{{ when(rec.createdAt) }}</span>
          <span class="pbr-done">{{ doneLabel(rec) }}</span>
          <span class="pbr-approver">{{ approverLabel(rec) }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { PlaybookDiagramColumn } from '~/composables/usePlaybooksManager'
import type { PlaybookCheckResult, PlaybookRun } from '~/composables/usePlaybooksApi'

const props = defineProps<{
  columns: PlaybookDiagramColumn[]
  preflight: readonly PlaybookCheckResult[] | null
  run: PlaybookRun | null
  runs: readonly PlaybookRun[]
}>()

const { t } = useI18n()

function indexOf(stepId: string): number {
  return props.columns.findIndex((c) => c.step.id === stepId)
}

/** Tên bước theo id. Không tra được (bước đã bị sửa khỏi playbook) thì hiện chính id. */
function titleOf(stepId: string): string {
  return props.columns.find((c) => c.step.id === stepId)?.step.title ?? stepId
}

function when(at: string): string {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString()
}

function doneLabel(runRecord: PlaybookRun): string {
  const ok = runRecord.steps.filter((s) => s.status === 'ok').length
  return t('playbooks.run.stepsDone', { ok, total: runRecord.steps.length })
}

/** Chưa qua cửa duyệt (playbook không chạm production) — nói ra, đừng để ô trống. */
function approverLabel(runRecord: PlaybookRun): string {
  return runRecord.approvedBy
    ? t('playbooks.run.approvedBy', { who: runRecord.approvedBy })
    : t('playbooks.run.noApprover')
}
</script>

<style scoped>
.pbr {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pbr-hd {
  margin: 0;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 650;
}

.pbr-hd-sub {
  margin: 0;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 650;
}

.pbr-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgPanel);
}

.pbr-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pbr-line.muted {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.pbr-st {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 550;
}

.pbr-st.st-done,
.pbr-st.st-ok,
.pbr-st.st-approved,
.pbr-st.st-rolled-back {
  color: var(--green);
}

.pbr-st.st-failed {
  color: var(--red);
}

.pbr-st.st-running {
  color: var(--accent);
}

.pbr-st.st-awaiting-approval {
  color: var(--amber);
}

/* Bước bị cổng quyền chặn KHÔNG phải bước hỏng: lượt chạy về lại `approved` và
   chạy tiếp được kèm vé — tô màu cảnh báo, không tô đỏ. */
.pbr-st.st-blocked {
  color: var(--amber);
}

.pbr-when,
.pbr-step-time,
.pbr-step-exit {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}

.pbr-done,
.pbr-approver {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.pbr-ok {
  color: var(--green);
}

.pbr-bad {
  color: var(--amber);
}

.pbr-steps {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.pbr-step {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pbr-step-no {
  flex: 0 0 auto;
  min-width: 16px;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}

.pbr-step-ttl {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.pbr-step-st {
  margin-left: auto;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.pbr-step-st.st-ok {
  color: var(--green);
}

.pbr-step-st.st-failed {
  color: var(--red);
}

.pbr-step-st.st-blocked {
  color: var(--amber);
}

.pbr-empty {
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.pbr-hist {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.pbr-hitems {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.pbr-hitem {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 4px 6px;
  border-radius: var(--r-xs);
  background: var(--bgHover);
}
</style>
