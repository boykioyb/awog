<template>
  <div class="skc">
    <div v-if="!available" class="skc-muted">{{ t('skillsEval.unavailable') }}</div>

    <template v-else>
      <!-- Chẩn đoán tĩnh: miễn phí nên chạy ngay khi mở bảng. -->
      <div class="skc-head">
        <div class="sech skc-sech">{{ t('skillsEval.doctor.title') }}</div>
        <span v-if="doctorReport" class="tag" :class="{ warn: hasFindings }">
          {{
            t('skillsEval.doctor.counts', {
              error: issueCounts.error,
              warn: issueCounts.warn,
              info: issueCounts.info,
            })
          }}
        </span>
        <span style="flex: 1" />
        <button class="btn sm" :disabled="doctorBusy" @click="runDoctor">
          <Icon name="refresh" />
          {{ t('skillsEval.doctor.rerun') }}
        </button>
      </div>
      <div class="skc-muted">{{ t('skillsEval.doctor.hint') }}</div>

      <div v-if="doctorBusy" class="skc-muted skc-gap">{{ t('skillsEval.doctor.running') }}</div>
      <ul v-else-if="issues.length > 0" class="skc-issues">
        <li v-for="(issue, i) in issues" :key="`${issue.rule}-${i}`" class="skc-issue">
          <span class="skc-sev" :class="issue.severity">
            {{ t(`skillsEval.sev.${issue.severity}`) }}
          </span>
          <div class="skc-issue-text">
            <div>{{ t(`skillsEval.rule.${issue.rule}.msg`, issue.params ?? {}) }}</div>
            <div class="skc-muted">{{ t(`skillsEval.rule.${issue.rule}.hint`, {}) }}</div>
          </div>
        </li>
      </ul>
      <div v-else-if="doctorReport" class="skc-ok skc-gap">
        <Icon name="check" />
        {{ t('skillsEval.doctor.clean') }}
      </div>

      <div v-if="doctorReport" class="skc-muted skc-gap tnum">
        {{
          t('skillsEval.doctor.stats', {
            kb: Math.max(1, Math.round(doctorReport.stats.fileBytes / 1024)),
            body: doctorReport.stats.bodyChars,
            assets: doctorReport.stats.assetFiles,
          })
        }}
      </div>

      <!-- Kiểm định kích hoạt: tốn tiền ⇒ chỉ chạy khi người dùng bấm. -->
      <div class="sech">{{ t('skillsEval.eval.title') }}</div>
      <div class="skc-muted">{{ t('skillsEval.eval.desc') }}</div>
      <div v-if="budget" class="skc-budget tnum">{{ budgetLine }}</div>

      <div class="skc-cases">
        <div v-for="c in cases" :key="c.id" class="skc-case">
          <button
            class="chip skc-expect"
            :class="c.expect"
            :title="t('skillsEval.eval.toggleExpect')"
            @click="toggleExpect(c.id)"
          >
            {{ t(`skillsEval.eval.expect.${c.expect}`) }}
          </button>
          <input
            v-model="c.prompt"
            class="skc-input"
            :placeholder="t('skillsEval.eval.promptPh')"
            :disabled="evalBusy"
          />
          <span v-if="verdict(c.id)" class="skc-verdict" :class="verdict(c.id)?.tone">
            {{ verdict(c.id)?.label }}
          </span>
          <button
            class="iconbtn skc-del"
            :title="t('skillsEval.eval.removeCase')"
            @click="removeCase(c.id)"
          >
            <Icon name="x" />
          </button>
        </div>
      </div>

      <div class="skc-actions">
        <button class="btn sm" @click="addCase('activate')">
          <Icon name="plus" />
          {{ t('skillsEval.eval.addActivate') }}
        </button>
        <button class="btn sm" @click="addCase('skip')">
          <Icon name="plus" />
          {{ t('skillsEval.eval.addSkip') }}
        </button>
        <span style="flex: 1" />
        <button class="btn pri sm" :disabled="!canRunEval" @click="runEval">
          <Icon name="play" />
          {{ evalBusy ? t('skillsEval.eval.running') : t('skillsEval.eval.run') }}
        </button>
      </div>
      <div v-if="!canRunEval && !evalBusy" class="skc-muted">
        {{ t('skillsEval.eval.needCases') }}
      </div>

      <div v-if="latestRun" class="skc-run">
        <span class="tag" :class="{ acc: latestRun.passed === latestRun.total }">
          {{ t('skillsEval.eval.score', { passed: latestRun.passed, total: latestRun.total }) }}
        </span>
        <span class="skc-muted tnum">
          {{ t('skillsEval.eval.model', { model: latestRun.modelId }) }}
        </span>
        <span class="skc-muted tnum">{{ costLabel(latestRun) }}</span>
      </div>
      <div v-if="latestRun?.stoppedBy" class="skc-stopped">
        <Icon name="alert" />
        {{ t(`skillsEval.eval.stopped.${latestRun.stoppedBy}`) }}
      </div>
      <ul v-if="latestRun" class="skc-detail">
        <li v-for="r in latestRun.results" :key="r.caseId" class="skc-muted">
          {{
            r.chosen
              ? t('skillsEval.eval.chosen', { id: r.chosen })
              : t('skillsEval.eval.chosenNone')
          }}
          <template v-if="r.reason">— {{ r.reason }}</template>
          <template v-else-if="r.errorMessage">— {{ r.errorMessage }}</template>
        </li>
      </ul>

      <div v-if="runs.length > 1" class="skc-history">
        <div class="sech skc-sech">{{ t('skillsEval.eval.history') }}</div>
        <div v-for="r in runs.slice(1)" :key="r.runId" class="skc-muted tnum">
          {{ formatTime(r.finishedAt) }} ·
          {{ t('skillsEval.eval.score', { passed: r.passed, total: r.total }) }} ·
          {{ costLabel(r) }}
        </div>
      </div>

      <div v-if="lastError" class="skc-err">{{ lastError }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Bảng "Kiểm tra" của một skill: chẩn đoán tĩnh (chạy ngay, miễn phí) + kiểm
// định kích hoạt (chỉ chạy khi bấm, vì mỗi ca là một lượt gọi model).
// State + IPC nằm ở composables/useSkillEval.ts; component chỉ dựng câu chữ.
import { computed, onMounted } from 'vue'
import { useSkillEval, type SkillEvalRun, type SkillTierSource } from '~/composables/useSkillEval'

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

<style scoped>
.skc {
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  padding: 14px;
  margin-top: 16px;
}
.skc-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.skc-sech {
  margin: 0;
}
.skc-muted {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.skc-gap {
  margin-top: 8px;
}
.skc-issues {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.skc-issue {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.skc-issue-text {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--textMuted);
  min-width: 0;
}
.skc-sev {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  padding: 2px 7px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  color: var(--textDim);
  white-space: nowrap;
  flex: 0 0 auto;
}
.skc-sev.error {
  color: var(--danger);
  border-color: var(--dangerBorder);
}
.skc-sev.warn {
  color: var(--amber);
  border-color: var(--amberBorder);
}
.skc-ok {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--green);
}
.skc-budget {
  margin-top: 8px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.skc-cases {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.skc-case {
  display: flex;
  align-items: center;
  gap: 8px;
}
.skc-expect {
  cursor: pointer;
  flex: 0 0 auto;
}
.skc-expect.activate {
  color: var(--accent);
  border-color: var(--accentBorder);
}
.skc-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-family: var(--sans);
  outline: none;
}
.skc-input:focus {
  border-color: var(--accent);
}
.skc-verdict {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  white-space: nowrap;
  flex: 0 0 auto;
}
.skc-verdict.good {
  color: var(--green);
}
.skc-verdict.bad {
  color: var(--danger);
}
.skc-verdict.muted {
  color: var(--textDim);
}
.skc-del {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
}
.skc-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.skc-run {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.skc-stopped {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--amber);
}
.skc-detail {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.skc-history {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.skc-err {
  margin-top: 10px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--danger);
}
</style>
