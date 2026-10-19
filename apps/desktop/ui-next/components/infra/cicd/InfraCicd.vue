<template>
  <!-- Tab Triển khai của `/infra` (Mốc 4). BỐ CỤC: một thanh lọc (nguồn · nhánh ·
       cửa sổ · ↻) + một bảng lấp hết phần còn lại, kèm cột chi tiết trượt vào bên
       phải khi bấm một dòng.

       Vì sao mọi thứ đi qua ĐÂY chứ không nằm trong chip của phiên: câu hỏi của
       tab là "hôm nay có bản triển khai nào hỏng", không phải "phiên này đang
       dùng tài khoản nào". Ngữ cảnh AWS vẫn là ngữ cảnh chung của `/infra`.

       SFC này chỉ ghép khối + bind. Mọi state/lời gọi RPC nằm ở `useInfraCicd()`
       (khuôn page-controller của .claude/rules/nuxt-vue.md).
       Lề 14px 16px là lề chung của Logs · Giám sát · Bảng · Chi phí · Báo cáo. -->
  <div class="flex h-full min-h-0 flex-col gap-2 px-4 py-3.5">
    <!-- Thanh lọc là một CARD, và ba ô lọc + nút ↻ là hai CỤM, không phải bốn mục
         rời của một hàng `flex-wrap`: hàng phẳng bỏ rơi nút ↻ xuống dòng riêng khi
         hết chỗ. Ô có nhãn-trên-control ⇒ căn theo ĐÁY để các ô không lệch nhau. -->
    <div
      class="flex flex-none flex-wrap items-end gap-2.5 rounded-xl border bg-card px-2.5 py-2 shadow-sm"
    >
      <div class="flex flex-none flex-wrap items-end gap-1.5">
        <div class="flex min-w-35 flex-col gap-1">
          <div class="text-xs text-muted-foreground">{{ t('infra.cicd.filter.source') }}</div>
          <AppSelect
            :model-value="sourceFilter"
            :options="sourceOptions"
            width="100%"
            :disabled="loading"
            @update:model-value="setSource"
          />
        </div>

        <div class="flex min-w-35 flex-col gap-1">
          <div class="text-xs text-muted-foreground">{{ t('infra.cicd.filter.branch') }}</div>
          <Input
            v-model="branchFilter"
            type="text"
            :placeholder="t('infra.cicd.filter.branchAny')"
            :disabled="loading"
            @keydown.enter="refresh()"
          />
        </div>

        <div class="flex min-w-27.5 flex-col gap-1">
          <div class="text-xs text-muted-foreground">{{ t('infra.cicd.filter.window') }}</div>
          <AppSelect
            :model-value="windowKey"
            :options="windowOptions"
            width="100%"
            :disabled="loading"
            @update:model-value="(v: string) => (windowKey = v)"
          />
        </div>

        <Button
          type="button"
          :disabled="loading"
          :aria-busy="loading"
          :title="t('infra.cicd.refresh')"
          variant="outline"
          @click="refresh()"
        >
          <Icon name="refresh" class="size-3.5" :class="{ 'animate-spin': loading }" />
          {{ t('infra.cicd.refresh') }}
        </Button>
      </div>

      <!-- `v-if`: cụm RỖNG vẫn là một mục flex, và với `margin-left: auto` nó vẫn
           chiếm một hàng của thanh — đo được 20px chiều cao chết khi chưa nạp gì
           (2026-09-16). Không có số nào để khoe thì cụm không tồn tại. -->
      <div
        v-if="hasStats"
        class="ml-auto flex flex-none flex-wrap items-center gap-2 text-xs text-muted-foreground"
      >
        <Badge v-if="counts.running" variant="outline" class="border-info font-normal text-info">
          {{ t('infra.cicd.statusCount.running', { n: counts.running }) }}
        </Badge>
        <Badge
          v-if="counts.waiting"
          variant="outline"
          class="border-warning/40 bg-warning/10 font-normal text-warning"
        >
          {{ t('infra.cicd.statusCount.waiting', { n: counts.waiting }) }}
        </Badge>
        <Badge
          v-if="counts.failed"
          variant="outline"
          class="border-destructive/40 bg-destructive/10 font-normal text-destructive"
        >
          {{ t('infra.cicd.statusCount.failed', { n: counts.failed }) }}
        </Badge>
        <span v-if="loadedAt">
          {{ t('infra.cicd.loadedAt', { at: loadedLabel }) }}
        </span>
      </div>
    </div>

    <!-- Nguồn không đọc được PHẢI nhìn thấy được: một bảng thiếu nguồn mà im lặng
         là bảng trả lời sai câu "có gì hỏng không". -->
    <div v-if="sourceIssues.length" class="flex flex-col gap-1">
      <div
        v-for="issue in sourceIssues"
        :key="issue.source"
        class="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-foreground"
      >
        <Icon name="alert" class="size-3 flex-none" />
        <span class="min-w-0 truncate">
          <b>{{ t(`infra.cicd.source.${issue.source}`) }}</b>
          <template v-if="issue.error">— {{ msg(issue.error) }}</template>
          <template v-else-if="issue.blocked">— {{ issue.blocked.reason }}</template>
        </span>
        <Button
          v-if="issue.blocked?.requiresApproval"
          type="button"
          variant="link"
          size="xs"
          class="h-auto p-0 font-normal text-info"
          @click="approveSource(issue.source)"
        >
          {{ t('infra.cicd.approve') }}
        </Button>
        <Button
          v-else-if="issue.blocked"
          type="button"
          variant="link"
          size="xs"
          class="h-auto p-0 font-normal text-info"
          @click="copyCommand(issue.blocked.command)"
        >
          {{ t('infra.cicd.copyCommand') }}
        </Button>
      </div>
    </div>

    <!-- Nguồn bị cắt bớt: nói ra độ phủ, để "bảng không có gì" không bị đọc thành
         "hệ thống không có gì". -->
    <div v-if="sourceNotes.length" class="flex flex-col gap-0.5 text-xs text-faint">
      <span v-for="n in sourceNotes" :key="n.source">
        <b>{{ t(`infra.cicd.source.${n.source}`) }}</b>
        — {{ noteText(n.note) }}
      </span>
    </div>

    <div
      v-if="error"
      class="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-sm text-destructive"
    >
      {{ msg(error) }}
    </div>

    <div class="flex min-h-0 flex-1 gap-2.5">
      <div class="min-w-0 flex-1 overflow-auto rounded-xl border bg-card shadow-sm">
        <div v-if="!rows.length && !loading" class="px-3 py-2.5 text-xs text-muted-foreground">
          {{ results.length ? t('infra.cicd.empty.filtered') : t('infra.cicd.empty') }}
        </div>

        <!-- Dòng đang chọn = accent-tint + thanh accent 2px (inset, không ăn vào đệm
             trái) — luật chọn của cả app, không nền xám. -->
        <!-- raw-ok: hàng list cả dòng là một vùng bấm (mở chi tiết lần chạy) -->
        <button
          v-for="run in rows"
          :key="run.id"
          type="button"
          class="flex w-full cursor-pointer items-center gap-2.5 border-b bg-transparent px-2.5 py-2 text-left text-foreground"
          :class="
            run.id === openId
              ? 'bg-selected shadow-[inset_2px_0_0_var(--color-primary)]'
              : 'hover:bg-accent'
          "
          @click="openRun(run)"
        >
          <span
            class="size-2 flex-none rounded-full"
            :class="statusDot(run.status)"
            :title="t(`infra.cicd.status.${run.status}`)"
          />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="flex min-w-0 items-baseline gap-2">
              <span class="text-sm font-semibold">{{ run.project }}</span>
              <span class="truncate text-sm text-muted-foreground">{{ run.title }}</span>
            </span>
            <span class="truncate text-xs text-faint">{{ subline(run) }}</span>
          </span>
          <span class="flex flex-none items-center gap-2.5 text-xs text-muted-foreground">
            <span v-if="run.branch" class="inline-flex items-center gap-1">
              <Icon name="branch" class="size-3" />
              {{ run.branch }}
            </span>
            <!-- mono-ok: SHA commit — người dùng copy sang git. -->
            <code v-if="run.commit" class="font-mono text-xs">{{ run.commit }}</code>
            <span class="min-w-14 text-right">{{ duration(run.durationMs) }}</span>
            <span class="min-w-14 text-right">{{ t(`infra.cicd.status.${run.status}`) }}</span>
          </span>
          <span class="flex flex-none gap-2" @click.stop>
            <Button
              v-if="run.status === 'failed'"
              type="button"
              variant="link"
              size="xs"
              class="h-auto p-0 font-normal text-info"
              :disabled="busy"
              @click="rerun(run)"
            >
              {{ t('infra.cicd.action.rerun') }}
            </Button>
            <Button
              v-if="run.needsApproval"
              type="button"
              variant="link"
              size="xs"
              class="h-auto p-0 font-normal text-warning"
              :disabled="busy"
              @click="openRun(run)"
            >
              {{ t('infra.cicd.approve') }}
            </Button>
          </span>
        </button>
      </div>

      <!-- Cột chi tiết: bước · log từng bước · artifact · PR · tên biến môi trường. -->
      <aside
        v-if="openId"
        class="flex w-95 min-w-0 flex-none flex-col gap-2 overflow-auto rounded-xl border bg-card p-2.5 shadow-sm"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <span
              class="size-2 flex-none rounded-full"
              :class="statusDot(detail?.run.status ?? 'unknown')"
            />
            <b>{{ detail?.run.project ?? '' }}</b>
            <span class="truncate text-sm text-muted-foreground">
              {{ detail?.run.title ?? '' }}
            </span>
          </div>
          <Button
            type="button"
            :title="t('infra.cicd.close')"
            :aria-label="t('infra.cicd.close')"
            variant="ghost"
            size="iconMd"
            @click="closeDetail()"
          >
            <Icon name="x" class="size-3.5" />
          </Button>
        </div>

        <div v-if="detailLoading" class="px-3 py-2.5 text-xs text-muted-foreground">
          {{ t('infra.cicd.loading') }}
        </div>
        <div
          v-else-if="detailError"
          class="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-sm text-destructive"
        >
          {{ msg(detailError) }}
        </div>

        <template v-else-if="detail">
          <div class="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
            <span v-if="detail.run.branch" class="inline-flex items-center gap-1">
              <Icon name="branch" class="size-3" />
              {{ detail.run.branch }}
            </span>
            <code v-if="detail.run.commit" class="font-mono text-xs">{{ detail.run.commit }}</code>
            <span v-if="detail.run.actor">{{ detail.run.actor }}</span>
            <span>{{ duration(detail.run.durationMs) }}</span>
            <Button
              v-if="detail.run.url"
              type="button"
              variant="link"
              size="xs"
              class="h-auto p-0 font-normal text-info"
              @click="openUrl(detail.run.url)"
            >
              {{ t('infra.cicd.openOnHost') }}
            </Button>
          </div>

          <div v-if="detail.pr" class="flex items-center gap-2">
            <Icon name="git" class="size-3" />
            <Button
              type="button"
              variant="link"
              size="xs"
              class="h-auto p-0 font-normal text-info"
              @click="openPr(detail.pr)"
            >
              {{ t('infra.cicd.pr', { n: detail.pr.number, repo: detail.pr.repo }) }}
            </Button>
          </div>

          <!-- Duyệt bước thủ công: chỉ hiện khi CÓ việc đang chờ người. -->
          <div
            v-if="detail.approvals.length"
            class="flex flex-col gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs"
          >
            <div v-for="ap in detail.approvals" :key="ap.id" class="flex items-center gap-2">
              <span>{{ t('infra.cicd.approvalPending', { label: ap.label }) }}</span>
              <Button
                type="button"
                :disabled="busy"
                variant="outline"
                @click="decide(detail.run, ap.id, true)"
              >
                {{ t('infra.cicd.approve') }}
              </Button>
              <Button
                type="button"
                :disabled="busy"
                variant="outline"
                @click="decide(detail.run, ap.id, false)"
              >
                {{ t('infra.cicd.reject') }}
              </Button>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <Button
              v-if="detail.run.status === 'failed'"
              type="button"
              :disabled="busy"
              variant="outline"
              @click="rerun(detail.run)"
            >
              <Icon name="refresh" class="size-3.5" />
              {{ t('infra.cicd.action.rerun') }}
            </Button>
            <Button
              v-if="isLive(detail.run.status)"
              type="button"
              :disabled="busy"
              variant="outline"
              @click="cancel(detail.run)"
            >
              <Icon name="stop" class="size-3.5" />
              {{ t('infra.cicd.action.cancel') }}
            </Button>
            <Button
              type="button"
              :disabled="busy"
              variant="outline"
              @click="openDispatch(detail.run)"
            >
              <Icon name="play" class="size-3.5" />
              {{ t('infra.cicd.action.dispatch') }}
            </Button>
            <Button type="button" :disabled="busy" variant="outline" @click="askAbout(detail.run)">
              <Icon name="sparkles" class="size-3.5" />
              {{ t('infra.cicd.askAgent') }}
            </Button>
          </div>

          <div class="flex flex-col gap-1 border-t pt-2">
            <div class="text-xs font-medium text-muted-foreground">{{ t('infra.cicd.steps') }}</div>
            <Button
              v-for="step in detail.steps"
              :key="step.id"
              type="button"
              variant="ghost"
              class="h-auto w-full justify-start gap-2 rounded-sm border border-transparent px-1.5 py-1 text-left text-xs font-normal text-foreground"
              :class="{ 'border-selected-border bg-selected': stepLog?.stepId === step.id }"
              @click="onStep(detail.run, step)"
            >
              <span class="size-1.5 flex-none rounded-full" :class="statusDot(step.status)" />
              <span class="min-w-0 flex-1 truncate">
                <template v-if="step.group">{{ step.group }} /</template>
                {{ step.name }}
              </span>
              <span class="text-muted-foreground">{{ duration(step.durationMs) }}</span>
              <Icon
                v-if="step.logRef || step.logUrl || detail.run.source === 'github'"
                :name="step.logUrl ? 'external' : 'file'"
                class="size-3"
              />
            </Button>
            <div v-if="!detail.steps.length" class="px-3 py-2.5 text-xs text-muted-foreground">
              {{ t('infra.cicd.noSteps') }}
            </div>
          </div>

          <!-- Log của ĐÚNG bước vừa bấm: đã redact + clamp ở sidecar. -->
          <div v-if="stepLog || logLoading || logError" class="flex flex-col gap-1 border-t pt-2">
            <div
              class="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground"
            >
              {{ t('infra.cicd.stepLog') }}
              <Button
                type="button"
                variant="link"
                size="xs"
                class="h-auto p-0 font-normal text-info"
                @click="copyCommand(stepLog?.value.command ?? '')"
              >
                {{ t('infra.cicd.copyCommand') }}
              </Button>
            </div>
            <div v-if="logLoading" class="px-3 py-2.5 text-xs text-muted-foreground">
              {{ t('infra.cicd.loadingLog') }}
            </div>
            <!-- Hỏng thì nói TẠI CHỖ, không chỉ một toast đã trôi mất. -->
            <div
              v-else-if="logError"
              class="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-sm text-destructive"
            >
              {{ msg(logError) }}
            </div>
            <template v-else-if="stepLog">
              <!-- mono-ok: log CI nguyên văn — người dùng đọc và copy dòng lỗi. -->
              <pre
                class="m-0 max-h-80 overflow-auto rounded-md border bg-background p-2 font-mono text-xs break-words whitespace-pre-wrap text-foreground"
                >{{ stepLog.value.lines.join('\n') }}</pre
              >
              <div v-if="stepLog.value.truncated" class="px-3 py-2.5 text-xs text-muted-foreground">
                {{
                  t('infra.cicd.logTruncated', {
                    shown: stepLog.value.lines.length,
                    total: stepLog.value.totalLines,
                  })
                }}
              </div>
            </template>
          </div>

          <div v-if="detail.artifacts.length" class="flex flex-col gap-1 border-t pt-2">
            <div class="text-xs font-medium text-muted-foreground">
              {{ t('infra.cicd.artifacts') }}
            </div>
            <Button
              v-for="art in detail.artifacts"
              :key="art.name"
              type="button"
              variant="link"
              size="xs"
              class="h-auto justify-start p-0 font-normal text-info"
              @click="art.url && openUrl(art.url)"
            >
              <Icon name="download" class="size-3" />
              {{ art.name }}
              <template v-if="art.sizeBytes">· {{ bytes(art.sizeBytes) }}</template>
            </Button>
          </div>

          <div v-if="detail.envNames.length" class="flex flex-col gap-1 border-t pt-2">
            <div class="text-xs font-medium text-muted-foreground">
              {{ t('infra.cicd.envNames') }}
            </div>
            <div class="flex flex-wrap gap-1">
              <!-- mono-ok: tên biến môi trường — định danh copy vào cấu hình. -->
              <code
                v-for="name in detail.envNames"
                :key="name"
                class="rounded-sm border bg-muted px-1.5 py-0.5 font-mono text-xs"
              >
                {{ name }}
              </code>
            </div>
            <!-- Nói rõ vì sao chỉ có tên: người dùng không phải đoán đây là thiếu sót. -->
            <div class="px-3 py-2.5 text-xs text-muted-foreground">
              {{ t('infra.cicd.envNamesOnly') }}
            </div>
          </div>
        </template>
      </aside>
    </div>

    <!-- Kích hoạt chạy mới: GitHub cần tên file workflow + git ref; AWS chỉ cần
         bấm (pipeline/build/app đã nằm trong `ref` của dòng). -->
    <Dialog :open="dispatchOpen" @update:open="(v) => !v && closeDispatch()">
      <DialogContent class="gap-2.5 p-3.5 sm:max-w-105">
        <DialogHeader>
          <DialogTitle class="text-base">{{ t('infra.cicd.action.dispatch') }}</DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            {{ t('infra.cicd.consequence.dispatch', { project: dispatchRun?.project ?? '' }) }}
          </DialogDescription>
        </DialogHeader>
        <div v-if="dispatchRun?.source === 'github'" class="flex flex-col gap-2.5">
          <div class="flex flex-col gap-1">
            <div class="text-xs text-muted-foreground">{{ t('infra.cicd.form.workflow') }}</div>
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
          <div class="flex flex-col gap-1">
            <div class="text-xs text-muted-foreground">{{ t('infra.cicd.form.ref') }}</div>
            <Input v-model="dispatchRefValue" type="text" placeholder="main" />
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            :disabled="busy || (dispatchRun?.source === 'github' && !dispatchWorkflow)"
            variant="default"
            @click="submitDispatch()"
          >
            {{ t('infra.cicd.action.dispatch') }}
          </Button>
          <Button type="button" variant="outline" @click="closeDispatch()">
            {{ t('common.cancel') }}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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

/** Màu chấm trạng thái của lần chạy / bước. Không khớp trạng thái nào ⇒ chấm mờ. */
function statusDot(status: string): string {
  if (status === 'success') return 'bg-primary'
  if (status === 'failed') return 'bg-destructive'
  if (status === 'running') return 'bg-info'
  if (status === 'waiting') return 'bg-warning'
  if (status === 'queued' || status === 'cancelled' || status === 'skipped') {
    return 'bg-muted-foreground'
  }
  return 'bg-faint'
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
