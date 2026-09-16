<template>
  <!-- Tab Triển khai của `/infra` (Mốc 4). BỐ CỤC: một thanh lọc (nguồn · nhánh ·
       cửa sổ · ↻) + một bảng lấp hết phần còn lại, kèm cột chi tiết trượt vào bên
       phải khi bấm một dòng.

       Vì sao mọi thứ đi qua ĐÂY chứ không nằm trong chip của phiên: câu hỏi của
       tab là "hôm nay có bản triển khai nào hỏng", không phải "phiên này đang
       dùng tài khoản nào". Ngữ cảnh AWS vẫn là ngữ cảnh chung của `/infra`.

       SFC này chỉ ghép khối + bind. Mọi state/lời gọi RPC nằm ở `useInfraCicd()`
       (khuôn page-controller của .claude/rules/nuxt-vue.md). -->
  <div class="icd">
    <!-- Thanh lọc là một CARD (`.itoolbar`), và ba ô lọc + nút ↻ là hai CỤM, không
         phải bốn mục rời của một hàng `flex-wrap`: hàng phẳng bỏ rơi nút ↻ xuống
         dòng riêng khi hết chỗ. Xem ghi chú `.itoolbar` ở app-shell.css. -->
    <div class="itoolbar ifields ictool">
      <div class="itoolgrp ifields">
        <div class="ifield">
          <div class="ilbl">{{ t('infra.cicd.filter.source') }}</div>
          <AppSelect
            :model-value="sourceFilter"
            :options="sourceOptions"
            width="100%"
            :disabled="loading"
            @update:model-value="setSource"
          />
        </div>

        <div class="ifield">
          <div class="ilbl">{{ t('infra.cicd.filter.branch') }}</div>
          <input
            v-model="branchFilter"
            class="icinput"
            type="text"
            :placeholder="t('infra.cicd.filter.branchAny')"
            :disabled="loading"
            @keydown.enter="refresh()"
          />
        </div>

        <div class="ifield narrow">
          <div class="ilbl">{{ t('infra.cicd.filter.window') }}</div>
          <AppSelect
            :model-value="windowKey"
            :options="windowOptions"
            width="100%"
            :disabled="loading"
            @update:model-value="(v: string) => (windowKey = v)"
          />
        </div>

        <button
          type="button"
          class="btn"
          :disabled="loading"
          :aria-busy="loading"
          :title="t('infra.cicd.refresh')"
          @click="refresh()"
        >
          <Icon
            name="refresh"
            :class="{ spin: loading }"
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
          {{ t('infra.cicd.refresh') }}
        </button>
      </div>

      <!-- `v-if`: cụm RỖNG vẫn là một mục flex, và với `margin-left: auto` nó vẫn
           chiếm một hàng của thanh — đo được 20px chiều cao chết khi chưa nạp gì
           (2026-09-16). Không có số nào để khoe thì cụm không tồn tại. -->
      <div v-if="hasStats" class="itoolgrp iend icstats">
        <span v-if="counts.running" class="icstat run">
          {{ t('infra.cicd.statusCount.running', { n: counts.running }) }}
        </span>
        <span v-if="counts.waiting" class="icstat wait">
          {{ t('infra.cicd.statusCount.waiting', { n: counts.waiting }) }}
        </span>
        <span v-if="counts.failed" class="icstat fail">
          {{ t('infra.cicd.statusCount.failed', { n: counts.failed }) }}
        </span>
        <span v-if="loadedAt" class="icwhen">
          {{ t('infra.cicd.loadedAt', { at: loadedLabel }) }}
        </span>
      </div>
    </div>

    <!-- Nguồn không đọc được PHẢI nhìn thấy được: một bảng thiếu nguồn mà im lặng
         là bảng trả lời sai câu "có gì hỏng không". -->
    <div v-if="sourceIssues.length" class="icissues">
      <div v-for="issue in sourceIssues" :key="issue.source" class="icissue">
        <Icon name="alert" style="width: var(--icon-xs); height: var(--icon-xs)" />
        <span class="icissuetxt">
          <b>{{ t(`infra.cicd.source.${issue.source}`) }}</b>
          <template v-if="issue.error">— {{ msg(issue.error) }}</template>
          <template v-else-if="issue.blocked">— {{ issue.blocked.reason }}</template>
        </span>
        <button
          v-if="issue.blocked?.requiresApproval"
          type="button"
          class="linkbtn"
          @click="approveSource(issue.source)"
        >
          {{ t('infra.cicd.approve') }}
        </button>
        <button
          v-else-if="issue.blocked"
          type="button"
          class="linkbtn"
          @click="copyCommand(issue.blocked.command)"
        >
          {{ t('infra.cicd.copyCommand') }}
        </button>
      </div>
    </div>

    <!-- Nguồn bị cắt bớt: nói ra độ phủ, để "bảng không có gì" không bị đọc thành
         "hệ thống không có gì". -->
    <div v-if="sourceNotes.length" class="icnotes">
      <span v-for="n in sourceNotes" :key="n.source">
        <b>{{ t(`infra.cicd.source.${n.source}`) }}</b>
        — {{ noteText(n.note) }}
      </span>
    </div>

    <div v-if="error" class="icerr">{{ msg(error) }}</div>

    <div class="icbody">
      <div class="tblcard iclist" :class="{ narrow: !!openId }">
        <div v-if="!rows.length && !loading" class="icempty">
          {{ results.length ? t('infra.cicd.empty.filtered') : t('infra.cicd.empty') }}
        </div>

        <button
          v-for="run in rows"
          :key="run.id"
          type="button"
          class="icrow"
          :class="[`st-${run.status}`, { on: run.id === openId }]"
          @click="openRun(run)"
        >
          <span
            class="icdot"
            :class="`st-${run.status}`"
            :title="t(`infra.cicd.status.${run.status}`)"
          />
          <span class="icmain">
            <span class="icline1">
              <span class="icproj">{{ run.project }}</span>
              <span class="ictitle">{{ run.title }}</span>
            </span>
            <span class="icsub">{{ subline(run) }}</span>
          </span>
          <span class="icmeta">
            <span v-if="run.branch" class="icbranch">
              <Icon name="branch" style="width: var(--icon-xs); height: var(--icon-xs)" />
              {{ run.branch }}
            </span>
            <code v-if="run.commit" class="iccommit">{{ run.commit }}</code>
            <span class="icdur">{{ duration(run.durationMs) }}</span>
            <span class="icstatus">{{ t(`infra.cicd.status.${run.status}`) }}</span>
          </span>
          <span class="icrowacts" @click.stop>
            <button
              v-if="run.status === 'failed'"
              type="button"
              class="linkbtn"
              :disabled="busy"
              @click="rerun(run)"
            >
              {{ t('infra.cicd.action.rerun') }}
            </button>
            <button
              v-if="run.needsApproval"
              type="button"
              class="linkbtn strong"
              :disabled="busy"
              @click="openRun(run)"
            >
              {{ t('infra.cicd.approve') }}
            </button>
          </span>
        </button>
      </div>

      <!-- Cột chi tiết: bước · log từng bước · artifact · PR · tên biến môi trường. -->
      <aside v-if="openId" class="tblcard icdetail">
        <div class="icdhead">
          <div class="icdtitle">
            <span class="icdot" :class="`st-${detail?.run.status ?? 'unknown'}`" />
            <b>{{ detail?.run.project ?? '' }}</b>
            <span class="icdsub">{{ detail?.run.title ?? '' }}</span>
          </div>
          <button
            type="button"
            class="iconbtn"
            :title="t('infra.cicd.close')"
            @click="closeDetail()"
          >
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>

        <div v-if="detailLoading" class="icdnote">{{ t('infra.cicd.loading') }}</div>
        <div v-else-if="detailError" class="icerr">{{ msg(detailError) }}</div>

        <template v-else-if="detail">
          <div class="icdmeta">
            <span v-if="detail.run.branch" class="icbranch">
              <Icon name="branch" style="width: var(--icon-xs); height: var(--icon-xs)" />
              {{ detail.run.branch }}
            </span>
            <code v-if="detail.run.commit" class="iccommit">{{ detail.run.commit }}</code>
            <span v-if="detail.run.actor">{{ detail.run.actor }}</span>
            <span>{{ duration(detail.run.durationMs) }}</span>
            <button
              v-if="detail.run.url"
              type="button"
              class="linkbtn"
              @click="openUrl(detail.run.url)"
            >
              {{ t('infra.cicd.openOnHost') }}
            </button>
          </div>

          <div v-if="detail.pr" class="icdpr">
            <Icon name="git" style="width: var(--icon-xs); height: var(--icon-xs)" />
            <button type="button" class="linkbtn" @click="openPr(detail.pr)">
              {{ t('infra.cicd.pr', { n: detail.pr.number, repo: detail.pr.repo }) }}
            </button>
          </div>

          <!-- Duyệt bước thủ công: chỉ hiện khi CÓ việc đang chờ người. -->
          <div v-if="detail.approvals.length" class="icdapprove">
            <div v-for="ap in detail.approvals" :key="ap.id" class="icdapv">
              <span>{{ t('infra.cicd.approvalPending', { label: ap.label }) }}</span>
              <button
                type="button"
                class="btn"
                :disabled="busy"
                @click="decide(detail.run, ap.id, true)"
              >
                {{ t('infra.cicd.approve') }}
              </button>
              <button
                type="button"
                class="btn"
                :disabled="busy"
                @click="decide(detail.run, ap.id, false)"
              >
                {{ t('infra.cicd.reject') }}
              </button>
            </div>
          </div>

          <div class="icdacts">
            <button
              v-if="detail.run.status === 'failed'"
              type="button"
              class="btn"
              :disabled="busy"
              @click="rerun(detail.run)"
            >
              <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('infra.cicd.action.rerun') }}
            </button>
            <button
              v-if="isLive(detail.run.status)"
              type="button"
              class="btn"
              :disabled="busy"
              @click="cancel(detail.run)"
            >
              <Icon name="stop" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('infra.cicd.action.cancel') }}
            </button>
            <button type="button" class="btn" :disabled="busy" @click="openDispatch(detail.run)">
              <Icon name="play" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('infra.cicd.action.dispatch') }}
            </button>
            <button type="button" class="btn" :disabled="busy" @click="askAbout(detail.run)">
              <Icon name="sparkles" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('infra.cicd.askAgent') }}
            </button>
          </div>

          <div class="icdsec">
            <div class="icdlbl">{{ t('infra.cicd.steps') }}</div>
            <button
              v-for="step in detail.steps"
              :key="step.id"
              type="button"
              class="icstep"
              :class="[`st-${step.status}`, { on: stepLog?.stepId === step.id }]"
              @click="onStep(detail.run, step)"
            >
              <span class="icdot sm" :class="`st-${step.status}`" />
              <span class="icstepname">
                <template v-if="step.group">{{ step.group }} /</template>
                {{ step.name }}
              </span>
              <span class="icstepmeta">{{ duration(step.durationMs) }}</span>
              <Icon
                v-if="step.logRef || step.logUrl || detail.run.source === 'github'"
                :name="step.logUrl ? 'external' : 'file'"
                style="width: var(--icon-xs); height: var(--icon-xs)"
              />
            </button>
            <div v-if="!detail.steps.length" class="icdnote">{{ t('infra.cicd.noSteps') }}</div>
          </div>

          <!-- Log của ĐÚNG bước vừa bấm: đã redact + clamp ở sidecar. -->
          <div v-if="stepLog || logLoading || logError" class="icdsec">
            <div class="icdlbl">
              {{ t('infra.cicd.stepLog') }}
              <button
                type="button"
                class="linkbtn"
                @click="copyCommand(stepLog?.value.command ?? '')"
              >
                {{ t('infra.cicd.copyCommand') }}
              </button>
            </div>
            <div v-if="logLoading" class="icdnote">{{ t('infra.cicd.loadingLog') }}</div>
            <!-- Hỏng thì nói TẠI CHỖ, không chỉ một toast đã trôi mất. -->
            <div v-else-if="logError" class="icerr">{{ msg(logError) }}</div>
            <template v-else-if="stepLog">
              <pre class="iclog">{{ stepLog.value.lines.join('\n') }}</pre>
              <div v-if="stepLog.value.truncated" class="icdnote">
                {{
                  t('infra.cicd.logTruncated', {
                    shown: stepLog.value.lines.length,
                    total: stepLog.value.totalLines,
                  })
                }}
              </div>
            </template>
          </div>

          <div v-if="detail.artifacts.length" class="icdsec">
            <div class="icdlbl">{{ t('infra.cicd.artifacts') }}</div>
            <button
              v-for="art in detail.artifacts"
              :key="art.name"
              type="button"
              class="linkbtn"
              @click="art.url && openUrl(art.url)"
            >
              <Icon name="download" style="width: var(--icon-xs); height: var(--icon-xs)" />
              {{ art.name }}
              <template v-if="art.sizeBytes">· {{ bytes(art.sizeBytes) }}</template>
            </button>
          </div>

          <div v-if="detail.envNames.length" class="icdsec">
            <div class="icdlbl">{{ t('infra.cicd.envNames') }}</div>
            <div class="icchips">
              <code v-for="name in detail.envNames" :key="name" class="icchip">{{ name }}</code>
            </div>
            <!-- Nói rõ vì sao chỉ có tên: người dùng không phải đoán đây là thiếu sót. -->
            <div class="icdnote">{{ t('infra.cicd.envNamesOnly') }}</div>
          </div>
        </template>
      </aside>
    </div>

    <!-- Kích hoạt chạy mới: GitHub cần tên file workflow + git ref; AWS chỉ cần
         bấm (pipeline/build/app đã nằm trong `ref` của dòng). -->
    <div
      v-if="dispatchOpen"
      class="icmodal"
      role="dialog"
      aria-modal="true"
      @click.self="closeDispatch()"
    >
      <div class="icmodalbox">
        <div class="icdhead">
          <b>{{ t('infra.cicd.action.dispatch') }}</b>
          <button
            type="button"
            class="iconbtn"
            :title="t('infra.cicd.close')"
            @click="closeDispatch()"
          >
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>
        <div class="icdnote">
          {{ t('infra.cicd.consequence.dispatch', { project: dispatchRun?.project ?? '' }) }}
        </div>
        <div v-if="dispatchRun?.source === 'github'" class="icform">
          <div class="ifield">
            <div class="ilbl">{{ t('infra.cicd.form.workflow') }}</div>
            <AppSelect
              :model-value="dispatchWorkflow"
              :options="workflowOptions"
              :placeholder="
                dispatchLoading ? t('infra.cicd.loading') : t('infra.cicd.form.workflowPick')
              "
              width="100%"
              :disabled="dispatchLoading"
              @update:model-value="(v: string) => (dispatchWorkflow = v)"
            />
          </div>
          <div class="ifield">
            <div class="ilbl">{{ t('infra.cicd.form.ref') }}</div>
            <input v-model="dispatchRefValue" class="icinput" type="text" placeholder="main" />
          </div>
        </div>
        <div class="icdacts">
          <button
            type="button"
            class="btn pri"
            :disabled="busy || (dispatchRun?.source === 'github' && !dispatchWorkflow)"
            @click="submitDispatch()"
          >
            {{ t('infra.cicd.action.dispatch') }}
          </button>
          <button type="button" class="btn" @click="closeDispatch()">
            {{ t('common.cancel') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import AppSelect from '~/components/common/AppSelect.vue'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import {
  CICD_SOURCES,
  CICD_WINDOWS,
  cicdMessage,
  noteParts,
  useInfraCicd,
} from '~/composables/useInfraCicd'
import type { CicdRun, CicdSource, CicdStep } from '~/composables/useInfraCicdApi'
import { useLinkOpen } from '~/composables/useLinkOpen'

const { t } = useI18n()

/** Thanh có gì để khoe không — xem `v-if` trên `.icstats` ở template. */
const hasStats = computed(
  () =>
    Boolean(loadedAt.value) ||
    counts.value.running > 0 ||
    counts.value.waiting > 0 ||
    counts.value.failed > 0,
)
const { openExternally } = useLinkOpen()

// Gieo log group của CodeBuild sang tab Logs (log của nó nằm ở CloudWatch và chỗ
// đọc đã có — AWOG không dựng viewer thứ hai).
const emit = defineEmits<{
  (e: 'open-logs', group: string, stream: string): void
}>()

const {
  sourceFilter,
  branchFilter,
  windowKey,
  loading,
  error,
  results,
  loadedAt,
  rows,
  counts,
  sourceIssues,
  sourceNotes,
  detail,
  detailLoading,
  detailError,
  openId,
  stepLog,
  logLoading,
  logError,
  dispatchOpen,
  dispatchRun,
  dispatchWorkflows,
  dispatchWorkflow,
  dispatchRefValue,
  dispatchLoading,
  busy,
  refresh,
  approveSource,
  openRun,
  closeDetail,
  loadStepLog,
  act,
  openDispatch,
  closeDispatch,
  submitDispatch,
  askAbout,
  copyCommand,
} = useInfraCicd()

const sourceOptions = computed<AppSelectOption[]>(() => [
  { value: 'all', label: t('infra.cicd.source.all') },
  ...CICD_SOURCES.map((s) => ({ value: s, label: t(`infra.cicd.source.${s}`) })),
])

const windowOptions = computed<AppSelectOption[]>(() =>
  CICD_WINDOWS.map((w) => ({ value: w.value, label: t(`infra.cicd.window.${w.value}`) })),
)

const workflowOptions = computed<AppSelectOption[]>(() =>
  dispatchWorkflows.value.map((w) => ({ value: w.path, label: `${w.name} (${w.path})` })),
)

const loadedLabel = computed(() => {
  if (!loadedAt.value) return ''
  const d = new Date(loadedAt.value)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})

/** Mã lỗi của sidecar → câu tiếng người; câu của AWS/`gh` giữ nguyên văn. */
function msg(raw: string): string {
  return cicdMessage(raw, t)
}

/** `cicd.note.pipelinesTruncated|8|23` → câu tiếng người, kèm tham số. */
function noteText(note: string): string {
  const { key, params } = noteParts(note)
  return cicdMessage(key, t, params)
}

function setSource(v: string): void {
  sourceFilter.value = v as CicdSource | 'all'
  void refresh()
}

function isLive(status: string): boolean {
  return status === 'queued' || status === 'running' || status === 'waiting'
}

/** Dòng phụ nói bằng tiếng người: nguồn · ai/kích hoạt · hỏng ở bước nào. */
function subline(run: CicdRun): string {
  const parts = [t(`infra.cicd.source.${run.source}`)]
  if (run.actor) parts.push(run.actor)
  if (run.stepName && run.status === 'failed') {
    parts.push(t('infra.cicd.failedAtStep', { step: run.stepName }))
  } else if (run.stepName && isLive(run.status)) {
    parts.push(t('infra.cicd.atStep', { step: run.stepName }))
  }
  return parts.join(' · ')
}

function duration(ms: number | null): string {
  if (ms === null) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m${String(s % 60).padStart(2, '0')}s`
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function rerun(run: CicdRun): void {
  // "Chạy lại bước hỏng" là mặc định: chạy lại CẢ pipeline khi chỉ một bước hỏng
  // là chạy lại cả những thứ đã xanh.
  void act('rerun', run, {
    label: t('infra.cicd.action.rerun'),
    consequence: t('infra.cicd.consequence.rerun', { project: run.project }),
    failedOnly: true,
    after: () => void refresh(),
  })
}

function cancel(run: CicdRun): void {
  void act('cancel', run, {
    label: t('infra.cicd.action.cancel'),
    consequence: t('infra.cicd.consequence.cancel', { project: run.title }),
    after: () => void refresh(),
  })
}

function decide(run: CicdRun, approvalId: string, approve: boolean): void {
  void act('approve', run, {
    label: approve ? t('infra.cicd.approve') : t('infra.cicd.reject'),
    consequence: approve
      ? t('infra.cicd.consequence.approve', { project: run.title })
      : t('infra.cicd.consequence.reject', { project: run.title }),
    approvalId,
    approve,
    after: () => {
      closeDetail()
      void refresh()
    },
  })
}

/**
 * Bấm một bước: GitHub mở log CỦA BƯỚC đó; CodeBuild gieo sang tab Logs (log của
 * nó nằm ở CloudWatch, và chỗ đọc đã có); Amplify mở link log của chính bước.
 */
function onStep(run: CicdRun, step: CicdStep): void {
  if (step.logUrl) {
    openUrl(step.logUrl)
    return
  }
  if (step.logRef) {
    // `open-tab` nối sang tab Logs với câu truy vấn đã gieo — không tự chạy.
    emit('open-logs', step.logRef.group, step.logRef.stream ?? '')
    return
  }
  if (run.source === 'github') void loadStepLog(step.id)
}

function openUrl(url: string | null): void {
  if (url) void openExternally(url)
}

function openPr(pr: { url: string }): void {
  void openExternally(pr.url)
}
</script>

<style scoped>
/* Root là `.icd`, KHÔNG phải `.ic`: `prototype.css` dành `.ic` cho inline code (mono ·
   nền --bgActive). Trước 2026-09-15 màn này mang đúng tên đó nên toàn màn hiện bằng
   monospace 12px trên nền xám. */
.icd {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  gap: 8px;
  /* Lề của riêng màn. Trước khi đổi tên, màn này KHÔNG khai padding và chỉ mượn
     `1px 5px` của rule inline-code toàn cục — một con số không ai chọn cho một màn.
     14px 16px là lề chung của Logs · Giám sát · Bảng · Chi phí · Báo cáo. */
  padding: 14px 16px;
}
/* Bố cục + da của thanh, và khuôn `.ifield`/`.ilbl` bên trong thanh, nay ở
   app-shell.css — đây từng là một trong BA bản khai `.ifield` khác nhau của khu. */
.icinput {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.icinput:focus {
  outline: none;
  border-color: var(--accentBorder);
}
.icstats {
  gap: 8px;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.icstat {
  padding: 2px 8px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
}
.icstat.run {
  color: var(--blue);
  border-color: var(--blue);
}
.icstat.wait {
  color: var(--amber);
  border-color: var(--amberBorder);
  background: var(--amberDim);
}
.icstat.fail {
  color: var(--danger);
  border-color: var(--dangerBorder);
  background: var(--dangerDim);
}
.icnotes {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}
.icissues {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.icissue {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  border: 1px solid var(--amberBorder);
  background: var(--amberDim);
  border-radius: var(--r-sm);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--text);
}
.icissuetxt {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icerr {
  padding: 8px 10px;
  border: 1px solid var(--dangerBorder);
  background: var(--dangerDim);
  border-radius: var(--r-sm);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.icbody {
  display: flex;
  gap: 10px;
  min-height: 0;
  flex: 1;
}
/* Da card (viền · bo · nền · bóng) ở `.tblcard`; đây chỉ còn bố cục. */
.iclist {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.icempty,
.icdnote {
  padding: 10px 12px;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}
.icrow {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.icrow:hover {
  background: var(--bgHover);
}
/* Dòng đang chọn = accent-tint + thanh accent 2px, KHÔNG nền xám `--bgActive` —
   luật chọn của cả app (.claude/rules/nuxt-vue.md §UI patterns; nền xám đã thử và
   bị bác). `box-shadow: inset` vẽ thanh mà không ăn vào đệm trái của dòng. */
.icrow.on {
  background: var(--accentDim);
  box-shadow: inset 2px 0 0 var(--accent);
}
.icdot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--textFaint);
}
.icdot.sm {
  width: 6px;
  height: 6px;
}
.icdot.st-success {
  background: var(--accent);
}
.icdot.st-failed {
  background: var(--danger);
}
.icdot.st-running {
  background: var(--blue);
}
.icdot.st-waiting {
  background: var(--amber);
}
.icdot.st-queued,
.icdot.st-cancelled,
.icdot.st-skipped {
  background: var(--textMuted);
}
.icmain {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.icline1 {
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-width: 0;
}
.icproj {
  font-weight: 600;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ictitle {
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icsub {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icmeta {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  flex: 0 0 auto;
}
.icbranch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.iccommit {
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.icdur,
.icstatus {
  min-width: 56px;
  text-align: right;
}
.icrowacts {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}
.linkbtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: transparent;
  color: var(--blue);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  cursor: pointer;
  padding: 0;
}
.linkbtn:hover {
  text-decoration: underline;
}
.linkbtn.strong {
  color: var(--amber);
}
.iconbtn {
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--textMuted);
  cursor: pointer;
  padding: 4px;
}
.icdetail {
  flex: 0 0 380px;
  min-width: 0;
  overflow: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.icdhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.icdtitle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.icdsub {
  color: var(--textMuted);
  font-size: var(--fs-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icdmeta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}
.icdpr,
.icdapv {
  display: flex;
  align-items: center;
  gap: 8px;
}
.icdapprove {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--amberBorder);
  background: var(--amberDim);
  border-radius: var(--r-sm);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}
.icdacts {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.icdsec {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.icdlbl {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.icstep {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  text-align: left;
  cursor: pointer;
}
.icstep:hover {
  background: var(--bgHover);
}
.icstep.on {
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.icstepname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icstepmeta {
  color: var(--textMuted);
}
.iclog {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgCanvas);
  color: var(--text);
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  white-space: pre-wrap;
  word-break: break-word;
}
.icchips {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.icchip {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: var(--bgSubtle);
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.icmodal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: grid;
  place-items: center;
  z-index: 40;
}
.icmodalbox {
  width: min(420px, 90vw);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--bgPanel);
}
.icform {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.spin {
  animation: ic-spin 900ms linear infinite;
}
@keyframes ic-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
