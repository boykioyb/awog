<template>
  <!-- Chạy + hồ sơ sau khi chạy (việc 5.5). Hồ sơ là bản GHI BẤT BIẾN: bản nào, ai
       duyệt, chạy lúc nào, bước nào mất bao lâu, bước nào lỗi — nên nó không sửa
       được, chỉ đọc. Chưa chạy lượt nào trong phiên này thì panel nói cách bắt đầu. -->
  <section class="flex flex-col gap-2">
    <h3 class="text-sm font-semibold text-muted-foreground">{{ t('playbooks.run.title') }}</h3>

    <!-- Lượt chạy vừa xong trong phiên này -->
    <div v-if="run" class="flex flex-col gap-1.5 rounded-md border bg-card px-2.5 py-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-medium" :class="STATUS_CLASS[run.status] ?? 'text-dim'">
          {{ t(`playbooks.status.${run.status}`) }}
        </span>
        <span class="text-xs text-dim tabular-nums">{{ when(run.createdAt) }}</span>
        <span class="text-xs text-dim">{{ doneLabel(run) }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-2 text-xs text-dim">
        <span>{{ approverLabel(run) }}</span>
      </div>
      <!-- Đóng băng vào Wiki là bề mặt PHỤ: hỏng nó không làm lượt chạy hỏng, nên
           đây chỉ là một dòng ghi chú — nhưng phải có, đừng nuốt. -->
      <div
        v-if="run.frozen || run.freezeError"
        class="flex flex-wrap items-center gap-2 text-xs text-dim"
      >
        <span v-if="run.frozen" class="text-success">
          {{ t('playbooks.run.frozen', { page: run.wikiPage ?? '' }) }}
        </span>
        <span v-if="run.freezeError" class="text-warning">
          {{ t('playbooks.run.freezeError', { error: run.freezeError }) }}
        </span>
      </div>
      <ol class="m-0 flex list-none flex-col gap-0.5 p-0">
        <li v-for="res in run.steps" :key="res.stepId" class="flex min-w-0 items-center gap-2">
          <span class="min-w-4 shrink-0 text-xs text-faint tabular-nums">
            {{ indexOf(res.stepId) + 1 }}
          </span>
          <span
            class="min-w-0 truncate text-xs leading-(--lh-sm) text-foreground"
            :title="res.command"
          >
            {{ titleOf(res.stepId) }}
          </span>
          <span class="ml-auto text-xs" :class="STEP_CLASS[res.status] ?? 'text-dim'">
            {{ t(`playbooks.run.state.${res.status}`) }}
          </span>
          <span class="text-xs text-dim tabular-nums">
            {{ t('playbooks.run.duration', { ms: res.durationMs }) }}
          </span>
          <span v-if="res.exitCode !== null" class="text-xs text-dim tabular-nums">
            {{ t('playbooks.run.exit', { code: res.exitCode }) }}
          </span>
        </li>
      </ol>
    </div>

    <!-- Chưa chạy: kết quả kiểm tra trước (nếu đã bấm) hoặc lời mời bắt đầu -->
    <div v-else-if="preflight" class="flex flex-col gap-1.5 rounded-md border bg-card px-2.5 py-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-semibold text-muted-foreground">
          {{ t('playbooks.run.preflightTitle') }}
        </span>
      </div>
      <!-- `PlaybookCheckResult` chỉ có `ok` — nó KHÔNG phải một bước đã chạy, nên
           không có thời lượng. Đừng bịa một con số cho vừa bảng. -->
      <ol class="m-0 flex list-none flex-col gap-0.5 p-0">
        <li v-for="res in preflight" :key="res.stepId" class="flex min-w-0 items-center gap-2">
          <span class="min-w-4 shrink-0 text-xs text-faint tabular-nums">
            {{ indexOf(res.stepId) + 1 }}
          </span>
          <span
            class="min-w-0 truncate text-xs leading-(--lh-sm) text-foreground"
            :title="res.command"
          >
            {{ titleOf(res.stepId) }}
          </span>
          <span class="ml-auto text-xs" :class="res.ok ? 'text-success' : 'text-destructive'">
            {{ t(`playbooks.run.state.${res.ok ? 'ok' : 'failed'}`) }}
          </span>
          <span v-if="res.reason" class="text-xs text-dim tabular-nums">{{ res.reason }}</span>
        </li>
      </ol>
    </div>

    <p v-else class="text-xs leading-(--lh-sm) text-dim">{{ t('playbooks.run.none') }}</p>

    <!-- Hồ sơ các lần chạy trước -->
    <div class="flex flex-col gap-1">
      <h4 class="text-xs font-semibold text-muted-foreground">
        {{ t('playbooks.run.historyTitle') }}
      </h4>
      <p v-if="!runs.length" class="text-xs leading-(--lh-sm) text-dim">
        {{ t('playbooks.run.historyNone') }}
      </p>
      <ul v-else class="m-0 flex list-none flex-col gap-0.5 p-0">
        <li
          v-for="rec in runs"
          :key="rec.id"
          class="flex flex-wrap items-center gap-2 rounded-sm bg-muted px-1.5 py-1"
        >
          <span class="text-xs font-medium" :class="STATUS_CLASS[rec.status] ?? 'text-dim'">
            {{ t(`playbooks.status.${rec.status}`) }}
          </span>
          <span class="text-xs text-dim tabular-nums">{{ when(rec.createdAt) }}</span>
          <span class="text-xs text-dim">{{ doneLabel(rec) }}</span>
          <span class="text-xs text-dim">{{ approverLabel(rec) }}</span>
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

/** Màu trạng thái của LƯỢT CHẠY. Bị cổng quyền chặn KHÔNG phải hỏng: lượt chạy về
 *  lại `approved` và chạy tiếp được kèm vé — tô màu cảnh báo, không tô đỏ. */
const STATUS_CLASS: Record<string, string> = {
  done: 'text-success',
  ok: 'text-success',
  approved: 'text-success',
  'rolled-back': 'text-success',
  failed: 'text-destructive',
  running: 'text-primary',
  'awaiting-approval': 'text-warning',
  blocked: 'text-warning',
}

/** Màu trạng thái của TỪNG BƯỚC (cùng luật: chặn ≠ hỏng). */
const STEP_CLASS: Record<string, string> = {
  ok: 'text-success',
  failed: 'text-destructive',
  blocked: 'text-warning',
}

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
