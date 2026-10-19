<template>
  <div class="mt-4 rounded-xl border p-3.5">
    <div v-if="!available" class="text-sm text-dim">{{ t('skillsEval.unavailable') }}</div>

    <template v-else>
      <!-- Chẩn đoán tĩnh: miễn phí nên chạy ngay khi mở bảng. -->
      <div class="flex items-center gap-2">
        <div class="text-xs font-semibold text-dim">{{ t('skillsEval.doctor.title') }}</div>
        <Badge
          v-if="doctorReport"
          variant="outline"
          :class="hasFindings ? 'border-warning/45 text-warning' : 'text-muted-foreground'"
        >
          {{
            t('skillsEval.doctor.counts', {
              error: issueCounts.error,
              warn: issueCounts.warn,
              info: issueCounts.info,
            })
          }}
        </Badge>
        <span class="flex-1" />
        <Button :disabled="doctorBusy" variant="outline" size="sm" @click="runDoctor">
          <Icon name="refresh" />
          {{ t('skillsEval.doctor.rerun') }}
        </Button>
      </div>
      <div class="text-sm text-dim">{{ t('skillsEval.doctor.hint') }}</div>

      <div v-if="doctorBusy" class="mt-2 text-sm text-dim">
        {{ t('skillsEval.doctor.running') }}
      </div>
      <ul v-else-if="issues.length > 0" class="mt-2.5 flex list-none flex-col gap-2 p-0">
        <li v-for="(issue, i) in issues" :key="`${issue.rule}-${i}`" class="flex items-start gap-2">
          <Badge variant="outline" class="flex-none rounded-sm" :class="SEV[issue.severity]">
            {{ t(`skillsEval.sev.${issue.severity}`) }}
          </Badge>
          <div class="min-w-0 text-base text-muted-foreground">
            <div>{{ t(`skillsEval.rule.${issue.rule}.msg`, issue.params ?? {}) }}</div>
            <div class="text-sm text-dim">{{ t(`skillsEval.rule.${issue.rule}.hint`, {}) }}</div>
          </div>
        </li>
      </ul>
      <div v-else-if="doctorReport" class="mt-2 flex items-center gap-1.5 text-base text-success">
        <Icon name="check" />
        {{ t('skillsEval.doctor.clean') }}
      </div>

      <div v-if="doctorReport" class="tnum mt-2 text-sm text-dim">
        {{
          t('skillsEval.doctor.stats', {
            kb: Math.max(1, Math.round(doctorReport.stats.fileBytes / 1024)),
            body: doctorReport.stats.bodyChars,
            assets: doctorReport.stats.assetFiles,
          })
        }}
      </div>

      <!-- Kiểm định kích hoạt: tốn tiền ⇒ chỉ chạy khi người dùng bấm. -->
      <div class="mb-2 mt-5 text-xs font-semibold text-dim">{{ t('skillsEval.eval.title') }}</div>
      <div class="text-sm text-dim">{{ t('skillsEval.eval.desc') }}</div>
      <div v-if="budget" class="tnum mt-2 text-xs text-dim">{{ budgetLine }}</div>

      <div class="mt-3 flex flex-col gap-2">
        <div v-for="c in cases" :key="c.id" class="flex items-center gap-2">
          <Button
            variant="outline"
            size="xs"
            class="flex-none"
            :class="
              c.expect === 'activate'
                ? 'border-selected-border text-primary'
                : 'text-muted-foreground'
            "
            :title="t('skillsEval.eval.toggleExpect')"
            @click="toggleExpect(c.id)"
          >
            {{ t(`skillsEval.eval.expect.${c.expect}`) }}
          </Button>
          <Input
            v-model="c.prompt"
            :placeholder="t('skillsEval.eval.promptPh')"
            :disabled="evalBusy"
          />
          <span
            v-if="verdict(c.id)"
            class="flex-none whitespace-nowrap text-xs font-semibold"
            :class="TONE[verdict(c.id)?.tone ?? 'muted']"
          >
            {{ verdict(c.id)?.label }}
          </span>
          <Button
            :title="t('skillsEval.eval.removeCase')"
            class="flex-none"
            variant="outline"
            size="iconSm"
            @click="removeCase(c.id)"
          >
            <Icon name="x" />
          </Button>
        </div>
      </div>

      <div class="mt-3 flex items-center gap-2">
        <Button variant="outline" size="sm" @click="addCase('activate')">
          <Icon name="plus" />
          {{ t('skillsEval.eval.addActivate') }}
        </Button>
        <Button variant="outline" size="sm" @click="addCase('skip')">
          <Icon name="plus" />
          {{ t('skillsEval.eval.addSkip') }}
        </Button>
        <span class="flex-1" />
        <Button :disabled="!canRunEval" variant="default" size="sm" @click="runEval">
          <Icon name="play" />
          {{ evalBusy ? t('skillsEval.eval.running') : t('skillsEval.eval.run') }}
        </Button>
      </div>
      <div v-if="!canRunEval && !evalBusy" class="text-sm text-dim">
        {{ t('skillsEval.eval.needCases') }}
      </div>

      <div v-if="latestRun" class="mt-3 flex items-center gap-2.5">
        <Badge
          variant="outline"
          :class="
            latestRun.passed === latestRun.total
              ? 'border-primary/45 bg-primary/8 text-primary'
              : 'text-muted-foreground'
          "
        >
          {{ t('skillsEval.eval.score', { passed: latestRun.passed, total: latestRun.total }) }}
        </Badge>
        <span class="tnum text-sm text-dim">
          {{ t('skillsEval.eval.model', { model: latestRun.modelId }) }}
        </span>
        <span class="tnum text-sm text-dim">{{ costLabel(latestRun) }}</span>
      </div>
      <div v-if="latestRun?.stoppedBy" class="mt-2 flex items-center gap-1.5 text-sm text-warning">
        <Icon name="alert" />
        {{ t(`skillsEval.eval.stopped.${latestRun.stoppedBy}`) }}
      </div>
      <ul v-if="latestRun" class="mt-2 flex list-none flex-col gap-1 p-0">
        <li v-for="r in latestRun.results" :key="r.caseId" class="text-sm text-dim">
          {{
            r.chosen
              ? t('skillsEval.eval.chosen', { id: r.chosen })
              : t('skillsEval.eval.chosenNone')
          }}
          <template v-if="r.reason">— {{ r.reason }}</template>
          <template v-else-if="r.errorMessage">— {{ r.errorMessage }}</template>
        </li>
      </ul>

      <div v-if="runs.length > 1" class="mt-3.5 flex flex-col gap-1">
        <div class="text-xs font-semibold text-dim">{{ t('skillsEval.eval.history') }}</div>
        <div v-for="r in runs.slice(1)" :key="r.runId" class="tnum text-sm text-dim">
          {{ formatTime(r.finishedAt) }} ·
          {{ t('skillsEval.eval.score', { passed: r.passed, total: r.total }) }} ·
          {{ costLabel(r) }}
        </div>
      </div>

      <div v-if="lastError" class="mt-2.5 text-sm text-destructive">{{ lastError }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Bảng "Kiểm tra" của một skill: chẩn đoán tĩnh (chạy ngay, miễn phí) + kiểm
// định kích hoạt (chỉ chạy khi bấm, vì mỗi ca là một lượt gọi model).
// State + IPC nằm ở composables/useSkillEval.ts; component chỉ dựng câu chữ.
import { computed, onMounted } from 'vue'
import { useSkillEval, type SkillEvalRun, type SkillTierSource } from '~/composables/useSkillEval'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{
  skill: { id: string; source: SkillTierSource; projectId?: string }
  // Tier project cần quét để bắt trùng id/tên và dựng danh mục cho eval.
  projectIds: string[]
}>()

const { t } = useI18n()

const {
  available,
  doctorReport,
  doctorBusy,
  issueCounts,
  evalBusy,
  cases,
  runs,
  latestRun,
  budget,
  lastError,
  canRunEval,
  runDoctor,
  loadReport,
  runEval,
  addCase,
  removeCase,
  toggleExpect,
  resultFor,
} = useSkillEval(() => ({
  id: props.skill.id,
  source: props.skill.source,
  ...(props.skill.projectId ? { projectId: props.skill.projectId } : {}),
  projectIds: props.projectIds,
}))

const issues = computed(() => doctorReport.value?.issues ?? [])
const hasFindings = computed(() => issueCounts.value.error + issueCounts.value.warn > 0)

const fmtUsd = (n: number): string => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`

const budgetLine = computed(() => {
  const b = budget.value
  if (!b) return ''
  return t('skillsEval.eval.budget', {
    calls: b.maxCalls,
    cost: fmtUsd(b.maxCostUsd),
    minutes: Math.round(b.maxWallclockMs / 60_000),
  })
})

const costLabel = (run: SkillEvalRun): string =>
  run.pricingKnown
    ? t('skillsEval.eval.cost', { cost: fmtUsd(run.estimatedCostUsd) })
    : t('skillsEval.eval.costUnknown')

const formatTime = (ms: number): string => new Date(ms).toLocaleString()

// Nhãn kết quả của một ca trong lần chạy gần nhất.
// Màu theo mức độ (doctor) / kết quả ca kiểm (eval).
const SEV: Record<string, string> = {
  error: 'border-destructive/40 text-destructive',
  warn: 'border-warning/40 text-warning',
  info: 'text-dim',
}
const TONE: Record<string, string> = {
  good: 'text-success',
  bad: 'text-destructive',
  muted: 'text-dim',
}

const verdict = (caseId: string): { label: string; tone: string } | null => {
  const r = resultFor(caseId)
  if (!r) return null
  if (r.status === 'skipped') return { label: t('skillsEval.eval.skipped'), tone: 'muted' }
  if (r.status === 'error') return { label: t('skillsEval.eval.error'), tone: 'bad' }
  return r.pass
    ? { label: t('skillsEval.eval.pass'), tone: 'good' }
    : { label: t('skillsEval.eval.fail'), tone: 'bad' }
}

onMounted(async () => {
  await loadReport()
  await runDoctor()
})
</script>
